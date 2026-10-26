// The AI review's guidelines library: Confluence pages managed centrally by admins (testing standards, the flows
// of the code bases, module maps). A page marked "general" is used in every project's reviews; any other page is
// used only in the projects that selected it. The text is cached in the database: a run reads the cache
// (refreshing pages older than KNOWLEDGE_TTL_MS first, and falling back to the cached copy if Confluence is down),
// so the model never fetches anything and a review never waits on Confluence.

import { createHash } from "node:crypto";
import { and, asc, count, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects, tcAiKnowledgePages, tcAiProjectGuidelines } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { ConfluenceError, fetchPage, listDescendants, resolvePageRef } from "@/lib/confluence/page";
import type { KnowledgeDoc } from "./prompt";

export const KNOWLEDGE_TTL_MS = 6 * 60 * 60 * 1000;
export const MAX_KNOWLEDGE_TOTAL_CHARS = 200_000;
export const MAX_LIBRARY_PAGES = 50;

export type GuidelineView = {
  id: string;
  url: string;
  title: string;
  version: number;
  chars: number;
  truncated: boolean;
  enabled: boolean;
  /** Used in every project's reviews. */
  isGeneral: boolean;
  /** How many projects selected it (general pages apply to all and are not counted here). */
  projectCount: number;
  /** Whom the page is read with (the project's Jira account); null if that project was deleted. */
  readWith: { id: string; name: string } | null;
  fetchedAt: string | null;
  lastError: string | null;
};

export type UsedKnowledge = { id: string; title: string; version: number; hash: string; stale: boolean };

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

async function projectSite(projectId: string) {
  const [p] = await db
    .select({ name: jiraProjects.name, baseUrl: jiraProjects.jiraBaseUrl, email: jiraProjects.jiraEmail, apiToken: jiraProjects.jiraApiToken })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId))
    .limit(1);
  return p ? { ...p, apiToken: decrypt(p.apiToken) } : null;
}

type Row = typeof tcAiKnowledgePages.$inferSelect;

async function toViews(rows: Row[]): Promise<GuidelineView[]> {
  const ids = [...new Set(rows.map((r) => r.credentialsProjectId).filter((x): x is string => !!x))];
  const names = ids.length ? await db.select({ id: jiraProjects.id, name: jiraProjects.name }).from(jiraProjects).where(inArray(jiraProjects.id, ids)) : [];
  const byId = new Map(names.map((n) => [n.id, n.name]));
  const counts = rows.length
    ? await db
        .select({ id: tcAiProjectGuidelines.guidelineId, n: count() })
        .from(tcAiProjectGuidelines)
        .where(inArray(tcAiProjectGuidelines.guidelineId, rows.map((r) => r.id)))
        .groupBy(tcAiProjectGuidelines.guidelineId)
    : [];
  const countOf = new Map(counts.map((c) => [c.id, Number(c.n)]));
  return rows.map((r) => ({
    id: r.id,
    projectCount: countOf.get(r.id) ?? 0,
    url: r.url,
    title: r.title,
    version: r.version,
    chars: r.bodyText.length,
    truncated: r.truncated,
    enabled: r.enabled,
    isGeneral: r.isGeneral,
    readWith: r.credentialsProjectId && byId.has(r.credentialsProjectId) ? { id: r.credentialsProjectId, name: byId.get(r.credentialsProjectId)! } : null,
    fetchedAt: r.fetchedAt ? r.fetchedAt.toISOString() : null,
    lastError: r.lastError,
  }));
}

export type KnowledgeFailure = { ok: false; status: number; error: string };

/** The whole library, general pages first. */
export async function listLibrary(): Promise<GuidelineView[]> {
  const rows = await db.select().from(tcAiKnowledgePages).orderBy(asc(tcAiKnowledgePages.createdAt));
  const views = await toViews(rows);
  return views.sort((a, b) => Number(b.isGeneral) - Number(a.isGeneral));
}

/** The library with, for one project, which non-general pages it has selected. */
export async function listForProject(projectId: string): Promise<{ pages: GuidelineView[]; selected: string[] }> {
  const [pages, picks] = await Promise.all([
    listLibrary(),
    db.select({ id: tcAiProjectGuidelines.guidelineId }).from(tcAiProjectGuidelines).where(eq(tcAiProjectGuidelines.projectId, projectId)),
  ]);
  return { pages, selected: picks.map((p) => p.id) };
}

export type AddResult = {
  ok: true;
  added: GuidelineView[];
  /** Pages that were already in the library. */
  alreadyThere: string[];
  /** Pages that could not be read (title or id, and why). */
  failed: { title: string; error: string }[];
};

/**
 * Adds a page to the library, and with `includeChildren` the pages below it too (a Confluence section). Each page is
 * fetched right away, so the person sees its title or why it can't be read. `readWithProjectId` is the project whose
 * Jira account reads them (the pages must be on that project's site). Short share links are followed.
 */
export async function addGuideline(args: {
  url: string;
  readWithProjectId: string;
  isGeneral: boolean;
  addedBy: string;
  includeChildren?: boolean;
}): Promise<AddResult | KnowledgeFailure> {
  const site = await projectSite(args.readWithProjectId);
  if (!site) return { ok: false, status: 404, error: "Choose which project's Jira account should read the page." };
  const room = MAX_LIBRARY_PAGES - (await db.select({ id: tcAiKnowledgePages.id }).from(tcAiKnowledgePages)).length;
  if (room <= 0) return { ok: false, status: 400, error: `The library holds at most ${MAX_LIBRARY_PAGES} pages.` };

  const statusFor = (err: ConfluenceError) => (err.code === "no_access" ? 403 : err.code === "not_found" ? 404 : err.code === "failed" ? 502 : 400);
  let rootId: string;
  let children: { id: string; title: string }[] = [];
  try {
    rootId = (await resolvePageRef(args.url, site)).pageId;
    if (args.includeChildren) children = await listDescendants(site, rootId);
  } catch (err) {
    if (err instanceof ConfluenceError) return { ok: false, status: statusFor(err), error: err.message };
    throw err;
  }

  const wanted = [{ id: rootId, title: "" }, ...children];
  const result: Extract<AddResult, { ok: true }> = { ok: true, added: [], alreadyThere: [], failed: [] };
  const base = site.baseUrl.replace(/\/+$/, "");
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, wanted.length) }, async () => {
      while (next < wanted.length) {
        const w = wanted[next++];
        if (result.added.length >= room) {
          result.failed.push({ title: w.title || w.id, error: `The library is full (${MAX_LIBRARY_PAGES} pages).` });
          continue;
        }
        try {
          const page = await fetchPage({ baseUrl: site.baseUrl, email: site.email, apiToken: site.apiToken, pageId: w.id });
          const [row] = await db
            .insert(tcAiKnowledgePages)
            .values({
              credentialsProjectId: args.readWithProjectId,
              isGeneral: args.isGeneral,
              url: (w.id === rootId ? args.url.trim() : `${base}/wiki/pages/viewpage.action?pageId=${w.id}`).slice(0, 1000),
              pageId: w.id,
              title: page.title,
              bodyText: page.text,
              version: page.version,
              contentHash: sha(page.text),
              truncated: page.truncated,
              fetchedAt: new Date(),
              addedBy: args.addedBy,
            })
            .onConflictDoNothing({ target: tcAiKnowledgePages.pageId })
            .returning();
          if (!row) result.alreadyThere.push(page.title);
          else result.added.push((await toViews([row]))[0]);
        } catch (err) {
          result.failed.push({ title: w.title || w.id, error: err instanceof ConfluenceError ? err.message : "Could not read the page." });
        }
      }
    }),
  );
  // Reading order = the order Confluence listed them in.
  const order = new Map(wanted.map((w, i) => [w.id, i]));
  result.added.sort((a, b) => (order.get(a.url.match(/pageId=(\d+)/)?.[1] ?? rootId) ?? 0) - (order.get(b.url.match(/pageId=(\d+)/)?.[1] ?? rootId) ?? 0));
  if (result.added.length === 0 && result.alreadyThere.length === 0 && result.failed.length > 0) {
    return { ok: false, status: 400, error: result.failed[0].error };
  }
  if (result.added.length === 0 && result.alreadyThere.length > 0 && result.failed.length === 0) {
    return { ok: false, status: 409, error: result.alreadyThere.length === 1 ? "That page is already in the library." : "Those pages are already in the library." };
  }
  return result;
}

/** Re-reads one page. On failure the cached text stays and the error is recorded (shown, and flagged to the run). */
export async function refreshGuideline(id: string): Promise<{ ok: true; page: GuidelineView } | KnowledgeFailure> {
  const [row] = await db.select().from(tcAiKnowledgePages).where(eq(tcAiKnowledgePages.id, id)).limit(1);
  if (!row) return { ok: false, status: 404, error: "Page not found." };
  const site = row.credentialsProjectId ? await projectSite(row.credentialsProjectId) : null;
  if (!site) {
    const message = "The project whose Jira account read this page is gone, so it can't be refreshed. Remove the page and add it again.";
    await db.update(tcAiKnowledgePages).set({ lastError: message }).where(eq(tcAiKnowledgePages.id, id));
    return { ok: false, status: 409, error: message };
  }
  try {
    const page = await fetchPage({ baseUrl: site.baseUrl, email: site.email, apiToken: site.apiToken, pageId: row.pageId });
    const [updated] = await db
      .update(tcAiKnowledgePages)
      .set({ title: page.title, bodyText: page.text, version: page.version, contentHash: sha(page.text), truncated: page.truncated, fetchedAt: new Date(), lastError: null })
      .where(eq(tcAiKnowledgePages.id, id))
      .returning();
    return { ok: true, page: (await toViews([updated]))[0] };
  } catch (err) {
    const message = err instanceof ConfluenceError ? err.message : "Could not refresh the page.";
    await db.update(tcAiKnowledgePages).set({ lastError: message }).where(eq(tcAiKnowledgePages.id, id));
    return { ok: false, status: err instanceof ConfluenceError && err.code === "no_access" ? 403 : 502, error: message };
  }
}

export async function updateGuideline(id: string, patch: { enabled?: boolean; isGeneral?: boolean }): Promise<boolean> {
  const set: Partial<Pick<Row, "enabled" | "isGeneral">> = {};
  if (typeof patch.enabled === "boolean") set.enabled = patch.enabled;
  if (typeof patch.isGeneral === "boolean") set.isGeneral = patch.isGeneral;
  if (Object.keys(set).length === 0) return true;
  const rows = await db.update(tcAiKnowledgePages).set(set).where(eq(tcAiKnowledgePages.id, id)).returning({ id: tcAiKnowledgePages.id });
  return rows.length > 0;
}

/** Removes a page from the library (and from every project that selected it). */
export async function removeGuideline(id: string): Promise<boolean> {
  const rows = await db.delete(tcAiKnowledgePages).where(eq(tcAiKnowledgePages.id, id)).returning({ id: tcAiKnowledgePages.id });
  return rows.length > 0;
}

/** Replaces the set of non-general pages a project's reviews use. Unknown ids are refused. */
export async function setProjectGuidelines(args: { projectId: string; guidelineIds: string[]; selectedBy: string }): Promise<{ ok: true } | KnowledgeFailure> {
  const ids = [...new Set(args.guidelineIds)];
  const [project] = await db.select({ id: jiraProjects.id }).from(jiraProjects).where(eq(jiraProjects.id, args.projectId)).limit(1);
  if (!project) return { ok: false, status: 404, error: "Project not found." };
  if (ids.length > 0) {
    const found = await db.select({ id: tcAiKnowledgePages.id }).from(tcAiKnowledgePages).where(inArray(tcAiKnowledgePages.id, ids));
    if (found.length !== ids.length) return { ok: false, status: 400, error: "One of the selected pages is no longer in the library. Reload and try again." };
  }
  await db.transaction(async (tx) => {
    await tx.delete(tcAiProjectGuidelines).where(eq(tcAiProjectGuidelines.projectId, args.projectId));
    if (ids.length > 0) {
      await tx.insert(tcAiProjectGuidelines).values(ids.map((guidelineId) => ({ projectId: args.projectId, guidelineId, selectedBy: args.selectedBy })));
    }
  });
  return { ok: true };
}

/**
 * The guidelines for a project's review: every enabled general page, plus the enabled pages this project selected.
 * Stale pages are refreshed first; if a refresh fails the cached copy is used and flagged stale. Total size is
 * capped; pages that don't fit are shortened or left out. General pages come first.
 */
export async function loadKnowledgeForRun(projectId: string): Promise<{ docs: KnowledgeDoc[]; used: UsedKnowledge[] }> {
  const picks = await db.select({ id: tcAiProjectGuidelines.guidelineId }).from(tcAiProjectGuidelines).where(eq(tcAiProjectGuidelines.projectId, projectId));
  const pickIds = picks.map((p) => p.id);
  const rows = await db
    .select()
    .from(tcAiKnowledgePages)
    .where(and(eq(tcAiKnowledgePages.enabled, true), pickIds.length > 0 ? or(eq(tcAiKnowledgePages.isGeneral, true), inArray(tcAiKnowledgePages.id, pickIds)) : eq(tcAiKnowledgePages.isGeneral, true)))
    .orderBy(asc(tcAiKnowledgePages.createdAt));
  rows.sort((a, b) => Number(b.isGeneral) - Number(a.isGeneral));

  const now = Date.now();
  const fresh = await Promise.all(
    rows.map(async (r) => {
      const age = r.fetchedAt ? now - r.fetchedAt.getTime() : Infinity;
      if (age < KNOWLEDGE_TTL_MS) return { row: r, stale: r.lastError !== null };
      const refreshed = await refreshGuideline(r.id);
      if (refreshed.ok) {
        const [latest] = await db.select().from(tcAiKnowledgePages).where(eq(tcAiKnowledgePages.id, r.id)).limit(1);
        return { row: latest ?? r, stale: false };
      }
      return { row: r, stale: true };
    }),
  );

  const docs: KnowledgeDoc[] = [];
  const used: UsedKnowledge[] = [];
  let budget = MAX_KNOWLEDGE_TOTAL_CHARS;
  for (const { row, stale } of fresh) {
    if (!row.bodyText || budget <= 0) continue;
    const text = row.bodyText.length > budget ? `${row.bodyText.slice(0, budget).trimEnd()}\n[…shortened]` : row.bodyText;
    budget -= text.length;
    docs.push({ title: row.title, scope: row.isGeneral ? "general" : "selected", text, truncated: row.truncated || text !== row.bodyText });
    used.push({ id: row.id, title: row.title, version: row.version, hash: row.contentHash, stale });
  }
  return { docs, used };
}

/** Active projects, for choosing whose Jira account reads a page. */
export async function listReadableProjects(): Promise<{ id: string; name: string; key: string }[]> {
  return db
    .select({ id: jiraProjects.id, name: jiraProjects.name, key: jiraProjects.jiraProjectKey })
    .from(jiraProjects)
    .where(eq(jiraProjects.isActive, true))
    .orderBy(asc(jiraProjects.name));
}

// The AI review's guidelines library: Confluence pages managed centrally by admins (testing standards, the flows
// of the code bases, module maps). A page marked "general" is used in every project's reviews; any other page is
// used only in the projects that selected it. The text is cached in the database and the model never fetches
// anything. Before every run the library is brought in step with Confluence: each page's version is compared with
// the saved one (one small call) and the text is fetched again only when it moved; pages added with "also add all
// pages below it" are listed again, so sub-pages created later join the library on their own. If Confluence is down
// the cached copy is used and flagged stale, so a review never fails because of it.

import { createHash } from "node:crypto";
import { and, asc, count, eq, inArray, max, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects, tcAiKnowledgePages, tcAiProjectGuidelines } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { ConfluenceError, fetchPage, fetchPageVersion, listDescendants, resolvePageRef } from "@/lib/confluence/page";
import { childrenSyncDue, movePage, needsFullRefresh, packPages, planNewChildren, versionCheckDue } from "./knowledge-sync";
import { compactText } from "./compact";
import { MAX_KNOWLEDGE_TOTAL_CHARS, MAX_LIBRARY_PAGES } from "./limits";
import type { KnowledgeDoc } from "./prompt";

export { MAX_KNOWLEDGE_TOTAL_CHARS, MAX_LIBRARY_PAGES };

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
  /** New pages created below this one are added to the library automatically. */
  syncChildren: boolean;
  /** Place in the reading order (1 = first). Pages further down are the first to be left out when space runs out. */
  rank: number;
  /** In use, but too far down to fit when every page above it is also in use: such a review leaves it out. */
  overLimit: boolean;
  /** How many projects selected it (general pages apply to all and are not counted here). */
  projectCount: number;
  /** Whom the page is read with (the project's Jira account); null if that project was deleted. */
  readWith: { id: string; name: string } | null;
  fetchedAt: string | null;
  lastError: string | null;
};

/** A page a review used, or (`omitted`) one that was in use but did not fit the size limit and was left out. */
export type UsedKnowledge = { id: string; title: string; version: number; hash: string; stale: boolean; omitted?: boolean };

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
    chars: compactText(r.bodyText).length,
    truncated: r.truncated,
    enabled: r.enabled,
    isGeneral: r.isGeneral,
    syncChildren: r.syncChildren,
    rank: r.priority,
    overLimit: false,
    readWith: r.credentialsProjectId && byId.has(r.credentialsProjectId) ? { id: r.credentialsProjectId, name: byId.get(r.credentialsProjectId)! } : null,
    fetchedAt: r.fetchedAt ? r.fetchedAt.toISOString() : null,
    lastError: r.lastError,
  }));
}

export type KnowledgeFailure = { ok: false; status: number; error: string };

/** The whole library in reading order (most important first), marking the pages that would not fit if all were used. */
export async function listLibrary(): Promise<GuidelineView[]> {
  const rows = await db.select().from(tcAiKnowledgePages).orderBy(asc(tcAiKnowledgePages.priority), asc(tcAiKnowledgePages.createdAt));
  const views = await toViews(rows);
  const { omitted } = packPages(views.filter((v) => v.enabled), MAX_KNOWLEDGE_TOTAL_CHARS);
  const over = new Set(omitted.map((v) => v.id));
  return views.map((v, i) => ({ ...v, rank: i + 1, overLimit: over.has(v.id) }));
}

/** The next free place at the end of the reading order. */
async function nextPriority(): Promise<number> {
  const [row] = await db.select({ top: max(tcAiKnowledgePages.priority) }).from(tcAiKnowledgePages);
  return (row?.top ?? 0) + 1;
}

/** Moves a page one place up or down the reading order. Returns false if the page does not exist. */
export async function moveGuideline(id: string, direction: "up" | "down"): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx.select({ id: tcAiKnowledgePages.id }).from(tcAiKnowledgePages).orderBy(asc(tcAiKnowledgePages.priority), asc(tcAiKnowledgePages.createdAt));
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) return false;
    const moved = movePage(rows, index, direction);
    // Rewrite 1..n so equal or gappy numbers from earlier inserts never make the order ambiguous.
    for (let i = 0; i < moved.length; i++) await tx.update(tcAiKnowledgePages).set({ priority: i + 1 }).where(eq(tcAiKnowledgePages.id, moved[i].id));
    return true;
  });
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
  const firstPriority = await nextPriority();
  const result: Extract<AddResult, { ok: true }> = { ok: true, added: [], alreadyThere: [], failed: [] };
  const base = site.baseUrl.replace(/\/+$/, "");
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, wanted.length) }, async () => {
      while (next < wanted.length) {
        const place = next;
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
              bodyText: compactText(page.text),
              version: page.version,
              contentHash: sha(compactText(page.text)),
              truncated: page.truncated,
              fetchedAt: new Date(),
              priority: firstPriority + place,
              syncChildren: !!args.includeChildren && w.id === rootId,
              childrenSyncedAt: args.includeChildren && w.id === rootId ? new Date() : null,
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
  // A page that was already in the library (or added on its own earlier) starts following its section from now on.
  if (args.includeChildren) {
    await db.update(tcAiKnowledgePages).set({ syncChildren: true, childrenSyncedAt: new Date() }).where(eq(tcAiKnowledgePages.pageId, rootId));
  }
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
      .set({ title: page.title, bodyText: compactText(page.text), version: page.version, contentHash: sha(compactText(page.text)), truncated: page.truncated, fetchedAt: new Date(), lastError: null })
      .where(eq(tcAiKnowledgePages.id, id))
      .returning();
    return { ok: true, page: (await toViews([updated]))[0] };
  } catch (err) {
    const message = err instanceof ConfluenceError ? err.message : "Could not refresh the page.";
    await db.update(tcAiKnowledgePages).set({ lastError: message }).where(eq(tcAiKnowledgePages.id, id));
    return { ok: false, status: err instanceof ConfluenceError && err.code === "no_access" ? 403 : 502, error: message };
  }
}

export async function updateGuideline(id: string, patch: { enabled?: boolean; isGeneral?: boolean; syncChildren?: boolean }): Promise<boolean> {
  const set: Partial<Pick<Row, "enabled" | "isGeneral" | "syncChildren" | "childrenSyncedAt">> = {};
  if (typeof patch.enabled === "boolean") set.enabled = patch.enabled;
  if (typeof patch.isGeneral === "boolean") set.isGeneral = patch.isGeneral;
  if (typeof patch.syncChildren === "boolean") {
    set.syncChildren = patch.syncChildren;
    // Switching it on: list the section at the next review rather than waiting out the interval.
    if (patch.syncChildren) set.childrenSyncedAt = null;
  }
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

const failureText = (err: unknown, fallback: string) => (err instanceof ConfluenceError ? err.message : fallback);

/**
 * Adds the pages created below a followed section since it was last listed. They are read right away, take the
 * section's "general" setting and the same Jira account, and are selected for every project that selected the
 * section, so a new page behaves like the ones next to it. Returns how many were added.
 */
async function syncSectionChildren(root: Row): Promise<number> {
  const site = root.credentialsProjectId ? await projectSite(root.credentialsProjectId) : null;
  if (!site) return 0; // the page's own refresh records why (the reading project is gone)
  try {
    const listed = await listDescendants(site, root.pageId);
    const known = new Set((await db.select({ pageId: tcAiKnowledgePages.pageId }).from(tcAiKnowledgePages)).map((r) => r.pageId));
    const { toAdd, skipped } = planNewChildren(listed, known, MAX_LIBRARY_PAGES - known.size);
    const base = site.baseUrl.replace(/\/+$/, "");
    const addedIds: string[] = [];
    // New pages go to the end of the reading order: they are the first to be left out if space is short.
    const firstPriority = await nextPriority();
    for (const [place, child] of toAdd.entries()) {
      try {
        const page = await fetchPage({ baseUrl: site.baseUrl, email: site.email, apiToken: site.apiToken, pageId: child.id });
        const [row] = await db
          .insert(tcAiKnowledgePages)
          .values({
            credentialsProjectId: root.credentialsProjectId,
            isGeneral: root.isGeneral,
            url: `${base}/wiki/pages/viewpage.action?pageId=${child.id}`,
            pageId: child.id,
            title: page.title,
            bodyText: compactText(page.text),
            version: page.version,
            contentHash: sha(compactText(page.text)),
            truncated: page.truncated,
            fetchedAt: new Date(),
            priority: firstPriority + place,
            addedBy: "auto-sync",
          })
          .onConflictDoNothing({ target: tcAiKnowledgePages.pageId })
          .returning({ id: tcAiKnowledgePages.id });
        if (row) addedIds.push(row.id);
      } catch {
        // One unreadable sub-page must not stop the others; it is picked up again at the next listing.
      }
    }
    if (addedIds.length > 0 && !root.isGeneral) {
      const projects = await db.select({ projectId: tcAiProjectGuidelines.projectId }).from(tcAiProjectGuidelines).where(eq(tcAiProjectGuidelines.guidelineId, root.id));
      if (projects.length > 0) {
        await db
          .insert(tcAiProjectGuidelines)
          .values(projects.flatMap((p) => addedIds.map((guidelineId) => ({ projectId: p.projectId, guidelineId, selectedBy: "auto-sync" }))))
          .onConflictDoNothing();
      }
    }
    await db
      .update(tcAiKnowledgePages)
      .set({
        childrenSyncedAt: new Date(),
        ...(skipped > 0 ? { lastError: `${skipped} new page${skipped === 1 ? " below this one was" : "s below this one were"} not added: the library is full (${MAX_LIBRARY_PAGES} pages).` } : {}),
      })
      .where(eq(tcAiKnowledgePages.id, root.id));
    return addedIds.length;
  } catch (err) {
    await db.update(tcAiKnowledgePages).set({ lastError: failureText(err, "Could not list the pages below this one.") }).where(eq(tcAiKnowledgePages.id, root.id));
    return 0;
  }
}

/**
 * The guidelines for a project's review: every enabled general page, plus the enabled pages this project selected.
 * First the followed sections are listed again (new sub-pages join the library), then every page is compared with
 * Confluence by version and re-read only if it changed. If Confluence can't be reached the cached copy is used and
 * flagged stale. Total size is capped; pages that don't fit are shortened or left out. General pages come first.
 */
export async function loadKnowledgeForRun(projectId: string): Promise<{ docs: KnowledgeDoc[]; used: UsedKnowledge[] }> {
  const now = Date.now();
  const pickedIds = async () => (await db.select({ id: tcAiProjectGuidelines.guidelineId }).from(tcAiProjectGuidelines).where(eq(tcAiProjectGuidelines.projectId, projectId))).map((p) => p.id);

  // 1. Sections this project's reviews use: pick up pages created below them since the last listing. A section's own
  // page may be switched off (it is often just a contents page); its sub-pages are followed all the same.
  const picked = new Set(await pickedIds());
  const sections = await db.select().from(tcAiKnowledgePages).where(eq(tcAiKnowledgePages.syncChildren, true));
  await Promise.all(sections.filter((r) => (r.isGeneral || picked.has(r.id)) && childrenSyncDue(r.childrenSyncedAt, now)).map((r) => syncSectionChildren(r)));

  // 2. The pages themselves (including any just added).
  const pickIds = await pickedIds();
  const rows = await db
    .select()
    .from(tcAiKnowledgePages)
    .where(and(eq(tcAiKnowledgePages.enabled, true), pickIds.length > 0 ? or(eq(tcAiKnowledgePages.isGeneral, true), inArray(tcAiKnowledgePages.id, pickIds)) : eq(tcAiKnowledgePages.isGeneral, true)))
    .orderBy(asc(tcAiKnowledgePages.priority), asc(tcAiKnowledgePages.createdAt));

  // 3. Latest text: ask Confluence only for the version, fetch the text only when it moved.
  const sites = new Map<string, ReturnType<typeof projectSite>>();
  const siteFor = (id: string) => {
    if (!sites.has(id)) sites.set(id, projectSite(id));
    return sites.get(id)!;
  };
  const fresh = await Promise.all(
    rows.map(async (r): Promise<{ row: Row; stale: boolean }> => {
      if (!versionCheckDue(r.fetchedAt, now)) return { row: r, stale: r.lastError !== null };
      const site = r.credentialsProjectId ? await siteFor(r.credentialsProjectId) : null;
      if (!site) {
        await refreshGuideline(r.id); // records why the page can't be read
        return { row: r, stale: true };
      }
      try {
        const remote = await fetchPageVersion({ baseUrl: site.baseUrl, email: site.email, apiToken: site.apiToken, pageId: r.pageId });
        if (!needsFullRefresh({ savedVersion: r.version, remoteVersion: remote.version, lastError: r.lastError })) {
          await db.update(tcAiKnowledgePages).set({ fetchedAt: new Date() }).where(eq(tcAiKnowledgePages.id, r.id));
          return { row: r, stale: false };
        }
      } catch (err) {
        await db.update(tcAiKnowledgePages).set({ lastError: failureText(err, "Could not check the page.") }).where(eq(tcAiKnowledgePages.id, r.id));
        return { row: r, stale: true };
      }
      const refreshed = await refreshGuideline(r.id);
      if (refreshed.ok) {
        const [latest] = await db.select().from(tcAiKnowledgePages).where(eq(tcAiKnowledgePages.id, r.id)).limit(1);
        return { row: latest ?? r, stale: false };
      }
      return { row: r, stale: true };
    }),
  );

  // 4. Fit the pages into the size limit in priority order: whole pages only, the ones further down are left out.
  const candidates = fresh.map((f) => ({ ...f, text: compactText(f.row.bodyText) })).map((f) => ({ ...f, chars: f.text.length }));
  const { fit, omitted } = packPages(candidates, MAX_KNOWLEDGE_TOTAL_CHARS);
  const docs: KnowledgeDoc[] = fit.map(({ row, text }) => ({ title: row.title, scope: row.isGeneral ? "general" : "selected", text, truncated: row.truncated }));
  const used: UsedKnowledge[] = [
    ...fit.map(({ row, stale }) => ({ id: row.id, title: row.title, version: row.version, hash: row.contentHash, stale })),
    ...omitted.map(({ row, stale }) => ({ id: row.id, title: row.title, version: row.version, hash: row.contentHash, stale, omitted: true })),
  ];
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

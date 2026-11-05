// The Jira item's comments, as the AI review reads them. The description alone is often stale: scope changes,
// clarifications and decisions are made in the comments. People are not named to the model: each distinct commenter is
// "Person 1", "Person 2"... (roles are not known), the same way the review history is anonymised.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { JiraClient, type JiraCommentRaw } from "@/lib/jira/client";
import { adfToText } from "@/lib/jira/adf";

export type JiraComment = { who: string; at: string; text: string };

/** One comment is cut here, and the whole block to the budget (oldest comments dropped first). */
export const COMMENT_MAX_CHARS = 1500;
export const COMMENTS_TOTAL_BUDGET = 16_000;
export const MAX_COMMENTS = 60;
const FETCH_TIMEOUT_MS = 15_000;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).trimEnd()} […]` : s);

/** Raw Jira comments to the ones worth sending: oldest first, empty ones dropped, the newest kept when there are too many for the budget. */
export function formatComments(raw: Pick<JiraCommentRaw, "author" | "body" | "created">[]): { comments: JiraComment[]; omitted: number } {
  const people = new Map<string, string>();
  const all: JiraComment[] = [];
  // Oldest first, so "Person 1" is whoever commented first.
  for (const c of [...raw].sort((a, b) => (a.created ?? "").localeCompare(b.created ?? ""))) {
    const text = (typeof c.body === "string" ? c.body : adfToText(c.body ? JSON.stringify(c.body) : null)).replace(/\r/g, "").trim();
    if (!text) continue;
    const key = c.author?.accountId || c.author?.displayName || "unknown";
    if (!people.has(key)) people.set(key, `Person ${people.size + 1}`);
    all.push({ who: people.get(key) as string, at: (c.created ?? "").slice(0, 10), text: clip(text, COMMENT_MAX_CHARS) });
  }
  // Keep the newest that fit: later comments override earlier ones.
  const kept: JiraComment[] = [];
  let used = 0;
  for (let i = all.length - 1; i >= 0 && kept.length < MAX_COMMENTS; i--) {
    const size = all[i].text.length + 30;
    if (used + size > COMMENTS_TOTAL_BUDGET) break;
    used += size;
    kept.unshift(all[i]);
  }
  return { comments: kept, omitted: all.length - kept.length };
}

/** The prompt block for the comments; empty text when there are none. */
export function commentsBlock(c: { comments: JiraComment[]; omitted: number; unavailable: boolean }): string {
  if (c.unavailable) return `<jira_comments unavailable="true">The Jira comments could not be loaded for this run. Say so in coverageNotes; do not guess what they contain.</jira_comments>`;
  if (c.comments.length === 0) return `<jira_comments count="0">The item has no comments.</jira_comments>`;
  const lines = c.comments.map((x) => `${x.who}${x.at ? ` (${x.at})` : ""}: ${x.text}`);
  const note = c.omitted > 0 ? `${c.omitted} older comment${c.omitted === 1 ? "" : "s"} omitted. ` : "";
  return `<jira_comments count="${c.comments.length}">\n${note}Oldest first; a later comment can change or refine the description.\n${lines.join("\n\n")}\n</jira_comments>`;
}

/** Loads and formats the item's comments from Jira with the project's own credentials; a failure is reported, never thrown. */
export async function loadJiraComments(issueId: string): Promise<{ comments: JiraComment[]; omitted: number; unavailable: boolean }> {
  try {
    const [row] = await db
      .select({ key: jiraIssues.jiraKey, baseUrl: jiraProjects.jiraBaseUrl, email: jiraProjects.jiraEmail, token: jiraProjects.jiraApiToken })
      .from(jiraIssues)
      .innerJoin(jiraProjects, eq(jiraProjects.id, jiraIssues.projectId))
      .where(eq(jiraIssues.id, issueId))
      .limit(1);
    if (!row) return { comments: [], omitted: 0, unavailable: true };
    const client = new JiraClient({ baseUrl: row.baseUrl, email: row.email, apiToken: decrypt(row.token) });
    const issue = await Promise.race([
      client.fetchIssue(row.key),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), FETCH_TIMEOUT_MS)),
    ]);
    return { ...formatComments(issue.fields.comment?.comments ?? []), unavailable: false };
  } catch (err) {
    console.warn("[ai-review] Jira comments not loaded:", err instanceof Error ? err.message : err);
    return { comments: [], omitted: 0, unavailable: true };
  }
}

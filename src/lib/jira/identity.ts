// Jira identity resolution — links app emails to Atlassian accountIds so we
// can still attribute issues when a user has restricted email visibility on
// their Jira profile (the default for new Atlassian Cloud accounts).
//
// Flow:
//   1. We know the user's email (Google SSO; same as their Jira email per
//      org policy).
//   2. We call Jira's /user/search?query={email} — this endpoint resolves by
//      email even when emailAddress is hidden in normal issue payloads.
//   3. We persist the resulting accountId on users.jira_account_id and/or
//      observer_board_members.jira_account_id.
//   4. The sync path then uses this map to backfill jira_issues.assignee_email
//      whenever Jira returns a null emailAddress but a known accountId — so
//      every downstream query (timeline, gantt, unplanned, pulse, my-tasks,
//      …) continues to filter by email as it always has.

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects, observerBoardMembers, users } from "@/lib/db/schema";
import { JiraClient } from "./client";
import { decrypt } from "@/lib/crypto";

type ProjectCreds = {
  baseUrl: string;
  email: string;
  apiToken: string;
};

let cachedProjectCreds: { value: ProjectCreds[]; expiresAt: number } | null = null;
const PROJECT_CACHE_TTL_MS = 60_000;

// In-memory TTL cache for the accountId → email map. The Jira webhook calls
// loadAccountIdEmailMap() on every issue event; without this each call ran two
// table scans. Reused across invocations on a warm instance. Invalidated
// immediately whenever a new identity is resolved (see ensure* below) so a
// freshly linked account isn't masked for up to a full TTL.
let cachedAccountIdEmailMap: { value: Map<string, string>; expiresAt: number } | null = null;
const ACCOUNT_MAP_CACHE_TTL_MS = 60_000;

async function getActiveProjectCreds(): Promise<ProjectCreds[]> {
  const now = Date.now();
  if (cachedProjectCreds && cachedProjectCreds.expiresAt > now) {
    return cachedProjectCreds.value;
  }
  const rows = await db
    .select({
      baseUrl: jiraProjects.jiraBaseUrl,
      email: jiraProjects.jiraEmail,
      apiToken: jiraProjects.jiraApiToken,
    })
    .from(jiraProjects)
    .where(eq(jiraProjects.isActive, true));

  // Dedupe by base URL — one user-search per Atlassian site is enough.
  const seenBaseUrl = new Set<string>();
  const deduped: ProjectCreds[] = [];
  for (const r of rows) {
    if (seenBaseUrl.has(r.baseUrl)) continue;
    seenBaseUrl.add(r.baseUrl);
    deduped.push({ baseUrl: r.baseUrl, email: r.email, apiToken: decrypt(r.apiToken) });
  }
  cachedProjectCreds = { value: deduped, expiresAt: now + PROJECT_CACHE_TTL_MS };
  return deduped;
}

/**
 * Try /user/search across every configured Atlassian site and return the
 * first matching accountId. Returns null when no site recognizes the email.
 */
export async function resolveAccountIdForEmail(email: string): Promise<string | null> {
  const projects = await getActiveProjectCreds();
  for (const p of projects) {
    try {
      const client = new JiraClient(p);
      const accountId = await client.searchUserAccountIdByEmail(email);
      if (accountId) return accountId;
    } catch (err) {
      console.warn(`[jira-identity] user/search failed on ${p.baseUrl}:`, err);
    }
  }
  return null;
}

/**
 * Ensure users.jira_account_id is populated for the given app user. Safe to
 * call repeatedly; no-op once the column is set. Returns the accountId (or
 * null when resolution failed). Errors are swallowed so callers can fire
 * this as a side-effect during login.
 */
export async function ensureUserJiraAccountId(email: string): Promise<string | null> {
  const key = email.toLowerCase();
  try {
    const [row] = await db
      .select({ jiraAccountId: users.jiraAccountId })
      .from(users)
      .where(eq(users.id, key))
      .limit(1);
    if (!row) return null;
    if (row.jiraAccountId) return row.jiraAccountId;

    const accountId = await resolveAccountIdForEmail(key);
    if (!accountId) return null;

    await db
      .update(users)
      .set({ jiraAccountId: accountId, updatedAt: new Date() })
      .where(eq(users.id, key));

    // A new identity now exists — drop the cached map so the next webhook
    // rebuilds it instead of serving a stale snapshot.
    cachedAccountIdEmailMap = null;

    // Side-effect: any jira_issues that were assigned to this person but
    // arrived without an emailAddress are now linkable. Patch them so
    // existing queries (which still filter by email) work immediately.
    await backfillIssueEmailsForAccount(accountId, key);

    return accountId;
  } catch (err) {
    console.error("[jira-identity] ensureUserJiraAccountId failed:", err);
    return null;
  }
}

/**
 * Ensure observer_board_members.jira_account_id is populated for a member.
 * Same self-healing contract as ensureUserJiraAccountId.
 */
export async function ensureMemberJiraAccountId(memberId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ email: observerBoardMembers.email, jiraAccountId: observerBoardMembers.jiraAccountId })
      .from(observerBoardMembers)
      .where(eq(observerBoardMembers.id, memberId))
      .limit(1);
    if (!row) return null;
    if (row.jiraAccountId) return row.jiraAccountId;

    const accountId = await resolveAccountIdForEmail(row.email);
    if (!accountId) return null;

    await db
      .update(observerBoardMembers)
      .set({ jiraAccountId: accountId })
      .where(eq(observerBoardMembers.id, memberId));

    // A new identity now exists — drop the cached map (see above).
    cachedAccountIdEmailMap = null;

    await backfillIssueEmailsForAccount(accountId, row.email.toLowerCase());

    return accountId;
  } catch (err) {
    console.error("[jira-identity] ensureMemberJiraAccountId failed:", err);
    return null;
  }
}

/**
 * Set jira_issues.assignee_email for every row that already has the given
 * accountId but is missing an email. This is what unblocks the unplanned /
 * timeline / pulse views immediately after we resolve a new identity.
 */
export async function backfillIssueEmailsForAccount(
  accountId: string,
  email: string
): Promise<number> {
  const res = await db
    .update(jiraIssues)
    .set({ assigneeEmail: email })
    .where(
      and(
        eq(jiraIssues.assigneeAccountId, accountId),
        isNull(jiraIssues.assigneeEmail)
      )
    );
  // Drizzle returns rowCount on the underlying QueryResult; expose it for
  // the one-time script to log totals.
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

/**
 * Build a fresh accountId → email map from every known identity (users +
 * board members). Used by sync.ts to fill in missing assignee emails on
 * incoming Jira payloads.
 */
export async function loadAccountIdEmailMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cachedAccountIdEmailMap && cachedAccountIdEmailMap.expiresAt > now) {
    return cachedAccountIdEmailMap.value;
  }
  const map = new Map<string, string>();
  const userRows = await db
    .select({ email: users.email, accountId: users.jiraAccountId })
    .from(users)
    .where(sql`${users.jiraAccountId} IS NOT NULL`);
  for (const r of userRows) {
    if (r.accountId) map.set(r.accountId, r.email.toLowerCase());
  }
  const memberRows = await db
    .select({ email: observerBoardMembers.email, accountId: observerBoardMembers.jiraAccountId })
    .from(observerBoardMembers)
    .where(sql`${observerBoardMembers.jiraAccountId} IS NOT NULL`);
  for (const r of memberRows) {
    if (r.accountId && !map.has(r.accountId)) {
      map.set(r.accountId, r.email.toLowerCase());
    }
  }
  cachedAccountIdEmailMap = { value: map, expiresAt: now + ACCOUNT_MAP_CACHE_TTL_MS };
  return map;
}

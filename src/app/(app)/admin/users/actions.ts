"use server";

import { revalidatePath } from "next/cache";
import { count, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { users, jiraIssues, jiraProjects } from "@/lib/db/schema";
import { JiraClient } from "@/lib/jira/client";
import type { UserRole } from "@/lib/auth/types";

export type UpdateRolesResult = {
  error?: string;
  success?: boolean;
};

export async function updateUserRoles(
  updates: { id: string; role: UserRole }[]
): Promise<UpdateRolesResult> {
  const actor = await requireRole("SUPERUSER");

  if (!updates.length) return { success: true };

  // Prevent the acting superuser from demoting themselves
  const selfUpdate = updates.find((u) => u.id === actor.id);
  if (selfUpdate && selfUpdate.role !== "SUPERUSER") {
    return { error: "You cannot change your own role." };
  }

  await Promise.all(
    updates.map(({ id, role }) =>
      db
        .update(users)
        .set({ role, updatedAt: new Date() })
        .where(eq(users.id, id))
    )
  );

  revalidatePath("/admin/users");
  return { success: true };
}

export type SyncJiraEmailResult = {
  error?: string;
  email?: string;
  updated?: number;
};

export async function syncJiraUserEmail(
  accountId: string
): Promise<SyncJiraEmailResult> {
  await requireRole("SUPERUSER");

  // Find a Jira base URL from any project that has issues for this account
  const [projectRow] = await db
    .select({ jiraBaseUrl: jiraProjects.jiraBaseUrl })
    .from(jiraProjects)
    .innerJoin(jiraIssues, eq(jiraIssues.projectId, jiraProjects.id))
    .where(
      or(
        eq(jiraIssues.assigneeAccountId, accountId),
        eq(jiraIssues.reporterAccountId, accountId)
      )
    )
    .limit(1);

  if (!projectRow) {
    return { error: "No Jira project found for this account ID." };
  }

  const baseUrl = projectRow.jiraBaseUrl.replace(/\/$/, "");
  const adminEmail = process.env.JIRA_SITE_ADMIN_EMAIL;
  const adminToken = process.env.JIRA_SITE_ADMIN_TOKEN;

  if (!adminEmail || !adminToken) {
    return { error: "Jira site admin credentials are not configured." };
  }

  const token = Buffer.from(`${adminEmail}:${adminToken}`).toString("base64");
  const res = await fetch(
    `${baseUrl}/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${token}`,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `Jira API error (${res.status}): ${body}` };
  }

  const jiraUser = (await res.json()) as {
    emailAddress?: string;
    displayName?: string;
  };

  if (!jiraUser.emailAddress) {
    return { error: "Email is still not visible. The user may need to make their profile public in Jira." };
  }

  const email = jiraUser.emailAddress;
  const name = jiraUser.displayName ?? null;

  // Bulk-update all issues where this account is assignee or reporter with null email
  const [assigneeResult, reporterResult] = await Promise.all([
    db
      .update(jiraIssues)
      .set({ assigneeEmail: email, assigneeName: name ?? undefined })
      .where(
        eq(jiraIssues.assigneeAccountId, accountId)
      ),
    db
      .update(jiraIssues)
      .set({ reporterEmail: email, reporterName: name ?? undefined })
      .where(
        eq(jiraIssues.reporterAccountId, accountId)
      ),
  ]);

  revalidatePath("/admin/users");
  return { email, updated: (assigneeResult.rowCount ?? 0) + (reporterResult.rowCount ?? 0) };
}

export type InactiveJiraUser = {
  accountId: string;
  name: string;
  email: string | null;
  /** Issues where this account is still the assignee — the work left behind. */
  issueCount: number;
};

export type FindInactiveJiraUsersResult = {
  error?: string;
  users?: InactiveJiraUser[];
};

/**
 * Surfaces Jira accounts that have gone inactive (e.g. people who left the
 * company) but still appear as assignee or reporter on synced issues.
 *
 * The rest of the codebase deliberately drops inactive users at sync time
 * (fetchAssignableUsers / searchUserAccountIdByEmail filter `active !== false`),
 * so there is no inactive-user data sitting in our DB. We therefore re-check the
 * accounts we already know about against Jira live, via the bulk user endpoint.
 *
 * This is a read-only Jira call run on demand (not on every page render) because
 * it hits the Jira API for every distinct account we track.
 */
export async function findInactiveJiraUsers(): Promise<FindInactiveJiraUsersResult> {
  await requireRole("SUPERUSER");

  // User-lookup endpoints (/user, /user/bulk) require the site-admin service
  // account — per-project API tokens get a 401 here. This mirrors
  // syncJiraUserEmail, which uses the same credentials for /user lookups.
  const adminEmail = process.env.JIRA_SITE_ADMIN_EMAIL;
  const adminToken = process.env.JIRA_SITE_ADMIN_TOKEN;
  if (!adminEmail || !adminToken) {
    return { error: "Jira site admin credentials are not configured." };
  }

  const baseUrlRows = await db
    .selectDistinct({ baseUrl: jiraProjects.jiraBaseUrl })
    .from(jiraProjects);

  if (baseUrlRows.length === 0) {
    return { error: "No Jira projects are configured." };
  }

  // Distinct (account, base URL) pairs from assignee and reporter roles, with
  // the best-known name/email and how many issues each account is assigned.
  const assigneeRows = await db
    .select({
      accountId: jiraIssues.assigneeAccountId,
      name: sql<string | null>`max(${jiraIssues.assigneeName})`,
      email: sql<string | null>`max(${jiraIssues.assigneeEmail})`,
      baseUrl: jiraProjects.jiraBaseUrl,
      issueCount: count(),
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .where(isNotNull(jiraIssues.assigneeAccountId))
    .groupBy(jiraIssues.assigneeAccountId, jiraProjects.jiraBaseUrl);

  const reporterRows = await db
    .select({
      accountId: jiraIssues.reporterAccountId,
      name: sql<string | null>`max(${jiraIssues.reporterName})`,
      email: sql<string | null>`max(${jiraIssues.reporterEmail})`,
      baseUrl: jiraProjects.jiraBaseUrl,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .where(isNotNull(jiraIssues.reporterAccountId))
    .groupBy(jiraIssues.reporterAccountId, jiraProjects.jiraBaseUrl);

  type Account = {
    name: string;
    email: string | null;
    issueCount: number;
    baseUrls: Set<string>;
  };
  const accounts = new Map<string, Account>();

  const ensure = (id: string): Account => {
    let a = accounts.get(id);
    if (!a) {
      a = { name: id, email: null, issueCount: 0, baseUrls: new Set() };
      accounts.set(id, a);
    }
    return a;
  };

  for (const r of assigneeRows) {
    if (!r.accountId) continue;
    const a = ensure(r.accountId);
    if (r.name) a.name = r.name;
    if (r.email && !a.email) a.email = r.email;
    a.issueCount += Number(r.issueCount);
    a.baseUrls.add(r.baseUrl);
  }

  for (const r of reporterRows) {
    if (!r.accountId) continue;
    const a = ensure(r.accountId);
    // Only fill name from the reporter role if we have nothing better yet.
    if (r.name && a.name === r.accountId) a.name = r.name;
    if (r.email && !a.email) a.email = r.email;
    a.baseUrls.add(r.baseUrl);
  }

  if (accounts.size === 0) {
    return { users: [] };
  }

  // Group accounts by the instance(s) they appear under, then bulk-check each.
  const accountIdsByBaseUrl = new Map<string, string[]>();
  for (const [id, a] of accounts) {
    for (const baseUrl of a.baseUrls) {
      const list = accountIdsByBaseUrl.get(baseUrl) ?? [];
      list.push(id);
      accountIdsByBaseUrl.set(baseUrl, list);
    }
  }

  // active === true wins over absence: an account is "inactive" only when Jira
  // explicitly reports active === false on the instance it belongs to.
  const activeByAccount = new Map<string, boolean>();
  for (const [baseUrl, ids] of accountIdsByBaseUrl) {
    const client = new JiraClient({ baseUrl, email: adminEmail, apiToken: adminToken });
    try {
      const fetched = await client.fetchUsersByAccountId(ids);
      for (const u of fetched) {
        const prev = activeByAccount.get(u.accountId);
        activeByAccount.set(u.accountId, prev === undefined ? u.active : prev || u.active);
      }
    } catch (err) {
      console.warn(`[inactive-users] bulk fetch failed for ${baseUrl}:`, err);
    }
  }

  const inactive: InactiveJiraUser[] = [];
  for (const [id, a] of accounts) {
    if (activeByAccount.get(id) === false) {
      inactive.push({ accountId: id, name: a.name, email: a.email, issueCount: a.issueCount });
    }
  }
  inactive.sort((x, y) => y.issueCount - x.issueCount || x.name.localeCompare(y.name));

  return { users: inactive };
}

export type UnassignInactiveResult = {
  error?: string;
  updated?: number;
};

/**
 * Clears the primary-assignee fields on every issue assigned to an inactive
 * Jira account — used to scrub departed users off workload/analytics views.
 *
 * NOTE: this is local only. A full project sync re-fetches every issue from
 * Jira and will re-populate the assignee for any issue still assigned to this
 * account there. It sticks only for issues already reassigned/removed in Jira.
 *
 * Guarded: re-checks the account against Jira and refuses if it is actually
 * active, so a stale/incorrect accountId can't scrub a current employee's work.
 */
export async function unassignInactiveJiraUser(
  accountId: string
): Promise<UnassignInactiveResult> {
  await requireRole("SUPERUSER");

  const adminEmail = process.env.JIRA_SITE_ADMIN_EMAIL;
  const adminToken = process.env.JIRA_SITE_ADMIN_TOKEN;
  if (!adminEmail || !adminToken) {
    return { error: "Jira site admin credentials are not configured." };
  }

  // Need a base URL on the right instance to verify the account.
  const [projectRow] = await db
    .select({ jiraBaseUrl: jiraProjects.jiraBaseUrl })
    .from(jiraProjects)
    .innerJoin(jiraIssues, eq(jiraIssues.projectId, jiraProjects.id))
    .where(eq(jiraIssues.assigneeAccountId, accountId))
    .limit(1);

  if (!projectRow) {
    return { error: "No issues are assigned to this account." };
  }

  const client = new JiraClient({
    baseUrl: projectRow.jiraBaseUrl,
    email: adminEmail,
    apiToken: adminToken,
  });

  // Safety: only proceed when Jira confirms the account is inactive. An account
  // Jira no longer knows about (hard-deleted) returns nothing — that's fine to
  // scrub; an account reported active is refused.
  const [user] = await client.fetchUsersByAccountId([accountId]);
  if (user?.active) {
    return { error: "This account is active in Jira — refusing to unassign." };
  }

  const result = await db
    .update(jiraIssues)
    .set({
      assigneeAccountId: null,
      assigneeEmail: null,
      assigneeName: null,
      assigneeSince: null,
    })
    .where(eq(jiraIssues.assigneeAccountId, accountId));

  revalidatePath("/admin/users");
  return { updated: result.rowCount ?? 0 };
}

export type BulkUnassignResult = {
  error?: string;
  /** Issues whose assignee was cleared. */
  updated?: number;
  /** Accounts actually cleared (inactive / not-found). */
  clearedAccountIds?: string[];
  /** Accounts left untouched because Jira reports them active. */
  skippedActive?: number;
};

/**
 * Bulk variant of unassignInactiveJiraUser. Re-verifies every account against
 * Jira and clears the assignee only on those that are NOT active — any account
 * Jira still reports active is skipped, never scrubbed. Same local-only caveat:
 * a full re-sync re-populates assignees still set in Jira.
 */
export async function unassignInactiveJiraUsers(
  accountIds: string[]
): Promise<BulkUnassignResult> {
  await requireRole("SUPERUSER");

  const ids = [...new Set(accountIds.filter(Boolean))];
  if (ids.length === 0) {
    return { updated: 0, clearedAccountIds: [], skippedActive: 0 };
  }

  const adminEmail = process.env.JIRA_SITE_ADMIN_EMAIL;
  const adminToken = process.env.JIRA_SITE_ADMIN_TOKEN;
  if (!adminEmail || !adminToken) {
    return { error: "Jira site admin credentials are not configured." };
  }

  const baseUrlRows = await db
    .selectDistinct({ baseUrl: jiraProjects.jiraBaseUrl })
    .from(jiraProjects);

  if (baseUrlRows.length === 0) {
    return { error: "No Jira projects are configured." };
  }

  // Verify against every instance: an account active anywhere is kept; one that
  // is inactive or unknown (hard-deleted) is safe to clear.
  const activeByAccount = new Map<string, boolean>();
  for (const { baseUrl } of baseUrlRows) {
    const client = new JiraClient({ baseUrl, email: adminEmail, apiToken: adminToken });
    try {
      const fetched = await client.fetchUsersByAccountId(ids);
      for (const u of fetched) {
        const prev = activeByAccount.get(u.accountId);
        activeByAccount.set(u.accountId, prev === undefined ? u.active : prev || u.active);
      }
    } catch (err) {
      console.warn(`[inactive-users] bulk verify failed for ${baseUrl}:`, err);
    }
  }

  const clearedAccountIds = ids.filter((id) => activeByAccount.get(id) !== true);
  const skippedActive = ids.length - clearedAccountIds.length;

  if (clearedAccountIds.length === 0) {
    return { updated: 0, clearedAccountIds: [], skippedActive };
  }

  const result = await db
    .update(jiraIssues)
    .set({
      assigneeAccountId: null,
      assigneeEmail: null,
      assigneeName: null,
      assigneeSince: null,
    })
    .where(inArray(jiraIssues.assigneeAccountId, clearedAccountIds));

  revalidatePath("/admin/users");
  return { updated: result.rowCount ?? 0, clearedAccountIds, skippedActive };
}

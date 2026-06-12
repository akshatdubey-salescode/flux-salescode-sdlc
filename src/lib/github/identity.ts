// GitHub identity resolution — links a GitHub login to an app user so
// contributor stats (which GitHub attributes by account, not commit email) can
// be rolled up per person.
//
// Auto path (resolved_via = 'email_auto'):
//   1. Scan recent commits across tracked repos to learn each login's
//      commit-author email(s) — commits carry both author.login and the raw
//      commit.author.email.
//   2. Fall back to the login's public profile email.
//   3. Match (case-insensitively) against users.email; on a hit, set user_id.
// Manual path (resolved_via = 'manual'): a superuser maps the leftovers on the
// /superuser/github-accounts page.

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubAccounts, users } from "@/lib/db/schema";
import { getTrackedRepos } from "./repos";
import { buildOrgClients } from "./orgs";

export type ResolveResult = { resolved: number; remaining: number };

/** Map of lowercased user email → users.id, for matching commit emails. */
async function loadUserEmailMap(): Promise<Map<string, string>> {
  const rows = await db.select({ id: users.id, email: users.email }).from(users);
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.email.toLowerCase(), r.id);
  return map;
}

/**
 * Resolve every unmapped, non-bot github_accounts row to an app user where
 * possible. Returns how many were newly resolved and how many remain unmapped
 * (the latter surface on the superuser mapping page).
 *
 * Each repo is scanned with its own org's client (fine-grained PATs are
 * single-org), so private-repo commits across every org are covered.
 */
export async function resolveGithubIdentities(): Promise<ResolveResult> {
  const unresolved = await db
    .select({ id: githubAccounts.id, githubLogin: githubAccounts.githubLogin })
    .from(githubAccounts)
    .where(and(isNull(githubAccounts.userId), eq(githubAccounts.isBot, false)));

  if (unresolved.length === 0) return { resolved: 0, remaining: 0 };

  const orgClients = await buildOrgClients();
  const anyClient = orgClients.values().next().value?.client;
  if (!anyClient) return { resolved: 0, remaining: unresolved.length };

  const userEmailMap = await loadUserEmailMap();
  const pending = new Map(unresolved.map((a) => [a.githubLogin, a.id]));

  // login → matched users.id (only logins whose email maps to a known user).
  const matched = new Map<string, string>();

  // --- Pass 1: recent-commit email scan across tracked repos --------------
  const repos = await getTrackedRepos();
  for (const repo of repos) {
    if (pending.size === 0) break;
    // Use the repo's org client so private commits are readable.
    const gh = (repo.orgId && orgClients.get(repo.orgId)?.client) || anyClient;
    let commits;
    try {
      commits = await gh.listRecentCommits(repo.fullName, { maxPages: 2 });
    } catch (err) {
      console.warn(`[github-identity] commit scan failed for ${repo.fullName}:`, err);
      continue;
    }
    for (const c of commits) {
      const login = c.author?.login;
      const email = c.commit.author?.email?.toLowerCase();
      if (!login || !email) continue;
      if (!pending.has(login) || matched.has(login)) continue;
      const userId = userEmailMap.get(email);
      if (userId) {
        matched.set(login, userId);
        pending.delete(login);
      }
    }
  }

  // --- Pass 2: public-profile email fallback for the still-unmapped -------
  // Any org's token works for the public /users/{login} endpoint.
  for (const [login] of pending) {
    const profile = await anyClient.getUser(login).catch(() => null);
    const email = profile?.email?.toLowerCase();
    if (!email) continue;
    const userId = userEmailMap.get(email);
    if (userId) matched.set(login, userId);
  }

  // --- Persist matches -----------------------------------------------------
  let resolved = 0;
  for (const [login, userId] of matched) {
    await db
      .update(githubAccounts)
      .set({ userId, resolvedVia: "email_auto", updatedAt: new Date() })
      .where(eq(githubAccounts.githubLogin, login));
    resolved++;
  }

  const remaining = unresolved.length - resolved;
  return { resolved, remaining };
}

/**
 * Manually map a GitHub account to an app user (the superuser fallback).
 * Pass userId = null to clear an incorrect mapping.
 */
export async function assignAccountToUser(
  githubLogin: string,
  userId: string | null
): Promise<void> {
  await db
    .update(githubAccounts)
    .set({
      userId,
      resolvedVia: userId ? "manual" : null,
      updatedAt: new Date(),
    })
    .where(eq(githubAccounts.githubLogin, githubLogin));
}

/** Count of accounts still awaiting a person mapping (non-bot, user_id null). */
export async function countUnmappedAccounts(): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(githubAccounts)
    .where(and(isNull(githubAccounts.userId), eq(githubAccounts.isBot, false)));
  return count;
}

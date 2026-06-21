/**
 * Recover real emails for Jira accounts whose email is hidden by privacy and
 * who aren't registered app users — the long tail that breaks performance-review
 * attribution (hidden assignees + issue owners like "Harshpreet Kaur").
 *
 * How it works (the key asymmetry):
 *   - Reverse lookup  accountId -> email  is PRIVACY-BLOCKED by Atlassian.
 *   - Forward lookup  /user/search?query={email}  WORKS even for hidden emails
 *     and returns the accountId. So we turn each account's displayName into
 *     "firstname.lastname@domain" candidates, search each, and accept the one
 *     whose returned accountId MATCHES the target — zero false-positive risk.
 *
 * Source set: distinct assignee accountIds on jira_issues that have no email
 * (assignee_email IS NULL AND assignee_account_id IS NOT NULL). Resolving these
 * also populates the accountId->email map that issue-owner attribution reads.
 *
 * Dry-run by default (no writes). Pass --apply to upsert confirmed identities
 * into the users table and backfill jira_issues.assignee_email.
 *
 * Run: pnpm tsx --env-file=.env.local scripts/resolve-jira-identities.ts [--apply] [--limit N] [--domain salescode.ai]
 */

import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { jiraIssues, jiraProjects, users } from "../src/lib/db/schema";
import { JiraClient } from "../src/lib/jira/client";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 ? Number(args[i + 1]) : 0; // 0 = no limit
})();
const DOMAIN = (() => {
  const i = args.indexOf("--domain");
  return i >= 0 ? args[i + 1] : "salescode.ai";
})();

/** Candidate company emails from a Jira display name, most-likely first. */
function candidates(displayName: string, domain: string): string[] {
  const parts = displayName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return [];
  const first = parts[0];
  const rest = parts.slice(1);
  const last = rest[rest.length - 1] ?? "";
  const set = new Set<string>();
  if (last) {
    set.add(`${first}.${last}`); // akshat.dubey
    set.add(`${first}${last}`); // akshatdubey
    if (rest.length > 1) set.add(`${first}.${rest.join(".")}`); // first.middle.last
  }
  set.add(first); // single-name accounts
  return [...set].map((u) => `${u}@${domain}`);
}

async function main() {
  console.log(
    `Mode: ${APPLY ? "APPLY (will write)" : "DRY-RUN (no writes)"} | domain: @${DOMAIN}` +
      (LIMIT ? ` | limit: ${LIMIT}` : "")
  );

  // Distinct unresolved assignee accounts, with best-known name + a base URL to
  // search against (accounts are scoped to a Jira site).
  const rows = await db.execute(sql`
    SELECT ji.assignee_account_id AS account_id,
           max(ji.assignee_name)  AS name,
           max(jp.jira_base_url)  AS base_url,
           count(*)::int          AS issues
    FROM jira_issues ji
    JOIN jira_projects jp ON jp.id = ji.project_id
    WHERE ji.assignee_email IS NULL AND ji.assignee_account_id IS NOT NULL
    GROUP BY ji.assignee_account_id
    ORDER BY issues DESC
  `);
  let accounts = rows.rows as {
    account_id: string;
    name: string | null;
    base_url: string;
    issues: number;
  }[];

  console.log(`Distinct unresolved assignee accounts: ${accounts.length}`);
  if (LIMIT) accounts = accounts.slice(0, LIMIT);

  const adminEmail = process.env.JIRA_SITE_ADMIN_EMAIL;
  const adminToken = process.env.JIRA_SITE_ADMIN_TOKEN;
  if (!adminEmail || !adminToken) throw new Error("JIRA_SITE_ADMIN_EMAIL/TOKEN not set");

  // One client per distinct base URL (admin creds — forward search bypasses the
  // email privacy gate).
  const clients = new Map<string, JiraClient>();
  const clientFor = (baseUrl: string) => {
    let c = clients.get(baseUrl);
    if (!c) {
      c = new JiraClient({ baseUrl, email: adminEmail, apiToken: adminToken });
      clients.set(baseUrl, c);
    }
    return c;
  };

  // Skip departed/deactivated accounts — they can't be searched and don't need
  // a performance rating. One bulk call per site classifies active status.
  const activeByAccount = new Map<string, boolean>();
  for (const baseUrl of new Set(accounts.map((a) => a.base_url))) {
    const ids = accounts.filter((a) => a.base_url === baseUrl).map((a) => a.account_id);
    for (const u of await clientFor(baseUrl).fetchUsersByAccountId(ids)) {
      activeByAccount.set(u.accountId, u.active);
    }
  }
  const activeAccounts = accounts.filter((a) => activeByAccount.get(a.account_id));
  const departed = accounts.length - activeAccounts.length;
  console.log(`Active (resolvable): ${activeAccounts.length} | departed/inactive (skipped): ${departed}\n`);

  // Raw name search (admin creds) returning email when Jira exposes it.
  async function nameSearch(baseUrl: string, query: string) {
    const auth = "Basic " + Buffer.from(`${adminEmail}:${adminToken}`).toString("base64");
    const res = await fetch(
      `${baseUrl.replace(/\/$/, "")}/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=10`,
      { headers: { Authorization: auth, Accept: "application/json" } }
    );
    if (!res.ok) return [] as { accountId: string; emailAddress?: string }[];
    return (await res.json()) as { accountId: string; emailAddress?: string }[];
  }

  const resolved: {
    accountId: string;
    email: string;
    name: string;
    issues: number;
    via: string;
  }[] = [];
  const unresolved: { accountId: string; name: string | null; issues: number }[] = [];

  for (const a of activeAccounts) {
    if (!a.name) {
      unresolved.push({ accountId: a.account_id, name: a.name, issues: a.issues });
      continue;
    }
    const client = clientFor(a.base_url);

    // 1) Direct: name search may expose the email outright for this account.
    let email: string | null = null;
    let via = "";
    const direct = (await nameSearch(a.base_url, a.name)).find(
      (u) => u.accountId === a.account_id && u.emailAddress
    );
    if (direct?.emailAddress) {
      email = direct.emailAddress.toLowerCase();
      via = "directory email";
    } else {
      // 2) Confirm a convention candidate by matching accountId.
      for (const cand of candidates(a.name, DOMAIN)) {
        if ((await client.searchUserAccountIdByEmail(cand)) === a.account_id) {
          email = cand;
          via = "name→email confirm";
          break;
        }
      }
    }

    if (email) {
      resolved.push({ accountId: a.account_id, email, name: a.name, issues: a.issues, via });
      console.log(`  ✓ ${a.name}  ->  ${email}  (${via}; ${a.issues} issues)`);
    } else {
      unresolved.push({ accountId: a.account_id, name: a.name, issues: a.issues });
      console.log(`  ✗ ${a.name}  (active but no email match; ${a.issues} issues)`);
    }
  }

  const reachedIssues = resolved.reduce((s, r) => s + r.issues, 0);
  console.log(
    `\nResolved ${resolved.length}/${activeAccounts.length} active accounts ` +
      `(covering ${reachedIssues} issues). Unresolved active: ${unresolved.length}; departed: ${departed}.`
  );

  if (!APPLY) {
    console.log("\nDry-run — nothing written. Re-run with --apply to persist.");
    process.exit(0);
  }

  console.log("\nApplying: upserting identities into users + backfilling issues…");
  for (const r of resolved) {
    const email = r.email.toLowerCase();
    await db
      .insert(users)
      .values({ id: email, email, jiraAccountId: r.accountId })
      .onConflictDoUpdate({
        target: users.id,
        set: { jiraAccountId: r.accountId, updatedAt: new Date() },
      });
    await db
      .update(jiraIssues)
      .set({ assigneeEmail: email })
      .where(
        sql`${jiraIssues.assigneeAccountId} = ${r.accountId} AND ${jiraIssues.assigneeEmail} IS NULL`
      );
  }
  console.log(`Done: persisted ${resolved.length} identities.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * One-time backfill: resolve every app user's and board member's Jira
 * accountId via /user/search, persist it, then fix every jira_issues row
 * that was synced before we had the mapping (assignee_email IS NULL with a
 * known assignee_account_id). After this runs once, the per-login and
 * per-member-add hooks in src/lib/jira/identity.ts keep things up to date.
 *
 * Run: ./node_modules/.bin/tsx --env-file=.env.local scripts/backfill-jira-identities.ts
 */

import { eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { jiraIssues, observerBoardMembers, users } from "../src/lib/db/schema";
import {
  ensureUserJiraAccountId,
  ensureMemberJiraAccountId,
  loadAccountIdEmailMap,
} from "../src/lib/jira/identity";

async function main() {
  console.log("== Step 1/3: backfilling users.jira_account_id ==");
  const userRows = await db
    .select({ email: users.email })
    .from(users)
    .where(isNull(users.jiraAccountId));

  let userResolved = 0;
  for (const u of userRows) {
    const accountId = await ensureUserJiraAccountId(u.email);
    if (accountId) {
      userResolved++;
      console.log(`  resolved user ${u.email} -> ${accountId}`);
    } else {
      console.log(`  no Jira account found for user ${u.email}`);
    }
  }
  console.log(`  done: ${userResolved}/${userRows.length} users resolved`);

  console.log("\n== Step 2/3: backfilling observer_board_members.jira_account_id ==");
  const memberRows = await db
    .select({ id: observerBoardMembers.id, email: observerBoardMembers.email })
    .from(observerBoardMembers)
    .where(isNull(observerBoardMembers.jiraAccountId));

  let memberResolved = 0;
  for (const m of memberRows) {
    const accountId = await ensureMemberJiraAccountId(m.id);
    if (accountId) {
      memberResolved++;
      console.log(`  resolved member ${m.email} -> ${accountId}`);
    } else {
      console.log(`  no Jira account found for member ${m.email}`);
    }
  }
  console.log(`  done: ${memberResolved}/${memberRows.length} members resolved`);

  // ensureUser/Member already patches jira_issues for the accountIds they
  // resolve themselves, but a member or user whose accountId was set in a
  // previous run won't trigger that path. Do a final sweep over the
  // accumulated map to mop up any rows the per-row helpers missed.
  console.log("\n== Step 3/3: sweeping jira_issues.assignee_email backfill ==");
  const map = await loadAccountIdEmailMap();
  let totalPatched = 0;
  for (const [accountId, email] of map.entries()) {
    const res = await db
      .update(jiraIssues)
      .set({ assigneeEmail: email })
      .where(
        sql`${jiraIssues.assigneeAccountId} = ${accountId} AND ${jiraIssues.assigneeEmail} IS NULL`
      );
    const rows = (res as unknown as { rowCount?: number }).rowCount ?? 0;
    if (rows > 0) {
      totalPatched += rows;
      console.log(`  patched ${rows} issues for ${email} (${accountId})`);
    }
  }
  console.log(`  done: ${totalPatched} jira_issues rows patched`);

  // Report the long tail of issues we still can't link. These are typically
  // assignees who never logged into the app and aren't on any board — they
  // will get picked up automatically once they sign in or get added.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jiraIssues)
    .where(
      sql`${jiraIssues.assigneeEmail} IS NULL AND ${jiraIssues.assigneeAccountId} IS NOT NULL`
    );
  console.log(`\nRemaining issues with unknown assignee email: ${count}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

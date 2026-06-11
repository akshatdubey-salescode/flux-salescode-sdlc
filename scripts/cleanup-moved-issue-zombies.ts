/**
 * One-time cleanup: remove stale jira_issues rows left behind by cross-project
 * moves that happened before the webhook handler learned to delete them
 * (commit 1bb8348). A moved issue keeps its Jira-internal id, so any jira_id
 * appearing under more than one project is a move — the row with the newest
 * jira_updated_at (the destination keeps receiving webhooks; the source never
 * does) is the live one, everything else is a zombie.
 *
 * Child rows (status transitions, assignee changes) cascade on delete;
 * Freshdesk ticket links are set null and re-link on the next webhook/sync.
 * Cached views refresh on their normal TTL.
 *
 * Dry run (default):  ./node_modules/.bin/tsx --env-file=.env.local scripts/cleanup-moved-issue-zombies.ts
 * Actually delete:    ./node_modules/.bin/tsx --env-file=.env.local scripts/cleanup-moved-issue-zombies.ts --execute
 */

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { jiraIssues, jiraProjects } from "../src/lib/db/schema";

const execute = process.argv.includes("--execute");

async function main() {
  // Every row whose jira_id exists under more than one project.
  const duplicatedIds = db
    .select({ jiraId: jiraIssues.jiraId })
    .from(jiraIssues)
    .groupBy(jiraIssues.jiraId)
    .having(sql`count(distinct ${jiraIssues.projectId}) > 1`);

  const rows = await db
    .select({
      id: jiraIssues.id,
      jiraId: jiraIssues.jiraId,
      jiraKey: jiraIssues.jiraKey,
      status: jiraIssues.status,
      jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
      syncedAt: jiraIssues.syncedAt,
      projectName: jiraProjects.name,
      projectKey: jiraProjects.jiraProjectKey,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .where(inArray(jiraIssues.jiraId, duplicatedIds));

  if (rows.length === 0) {
    console.log("No cross-project duplicates found — nothing to clean up.");
    return;
  }

  // Group by jira_id; keep the most recently updated row (tiebreak: most
  // recently synced), mark the rest for deletion.
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = groups.get(row.jiraId) ?? [];
    group.push(row);
    groups.set(row.jiraId, group);
  }

  const zombieIds: string[] = [];
  console.log(`Found ${groups.size} moved issue(s) with stale copies:\n`);
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        (b.jiraUpdatedAt?.getTime() ?? 0) - (a.jiraUpdatedAt?.getTime() ?? 0) ||
        b.syncedAt.getTime() - a.syncedAt.getTime()
    );
    const [keep, ...zombies] = group;
    console.log(
      `  keep   ${keep.jiraKey} [${keep.projectKey}] ${keep.projectName} (updated ${keep.jiraUpdatedAt?.toISOString() ?? "?"})`
    );
    for (const zombie of zombies) {
      zombieIds.push(zombie.id);
      console.log(
        `  delete ${zombie.jiraKey} [${zombie.projectKey}] ${zombie.projectName} (updated ${zombie.jiraUpdatedAt?.toISOString() ?? "?"}, status ${zombie.status})`
      );
    }
    console.log();
  }

  if (!execute) {
    console.log(
      `Dry run: would delete ${zombieIds.length} stale row(s). Re-run with --execute to apply.`
    );
    return;
  }

  const deleted = await db
    .delete(jiraIssues)
    .where(inArray(jiraIssues.id, zombieIds))
    .returning({ id: jiraIssues.id });
  console.log(`Deleted ${deleted.length} stale row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

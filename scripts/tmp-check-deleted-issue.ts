/**
 * One-off: verify an issue key no longer exists on Jira, then remove its row
 * from our DB. Only deletes on a definitive 404 from Jira — a 200 (issue
 * still exists, possibly under a new key after a move), auth failure, or
 * network error leaves the row untouched.
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/tmp-check-deleted-issue.ts <KEY> [--delete]
 */

import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { jiraIssues, jiraProjects } from "../src/lib/db/schema";
import { decrypt } from "../src/lib/crypto";

const key = process.argv[2];
const doDelete = process.argv.includes("--delete");
if (!key) {
  console.error("Usage: tmp-check-deleted-issue.ts <ISSUE-KEY> [--delete]");
  process.exit(1);
}

async function main() {
  const rows = await db
    .select({
      id: jiraIssues.id,
      jiraId: jiraIssues.jiraId,
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      status: jiraIssues.status,
      assigneeName: jiraIssues.assigneeName,
      jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
      syncedAt: jiraIssues.syncedAt,
      projectName: jiraProjects.name,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
      jiraEmail: jiraProjects.jiraEmail,
      jiraApiToken: jiraProjects.jiraApiToken,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .where(eq(jiraIssues.jiraKey, key));

  if (rows.length === 0) {
    console.log(`${key}: not found in our DB — nothing to do.`);
    return;
  }

  for (const row of rows) {
    console.log(`DB row: ${row.jiraKey} (jira_id ${row.jiraId}) in "${row.projectName}"`);
    console.log(`  summary:  ${row.summary}`);
    console.log(`  status:   ${row.status}  assignee: ${row.assigneeName ?? "—"}`);
    console.log(`  updated:  ${row.jiraUpdatedAt?.toISOString() ?? "?"}  synced: ${row.syncedAt.toISOString()}`);

    const auth = Buffer.from(`${row.jiraEmail}:${decrypt(row.jiraApiToken)}`).toString("base64");
    const res = await fetch(
      `${row.jiraBaseUrl.replace(/\/$/, "")}/rest/api/3/issue/${encodeURIComponent(row.jiraKey)}?fields=key,project,status`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } }
    );

    if (res.status === 404) {
      console.log(`  Jira says: 404 — issue no longer exists on Atlassian.`);
      if (doDelete) {
        await db.delete(jiraIssues).where(eq(jiraIssues.id, row.id));
        console.log(`  ✓ Deleted row ${row.id} from our DB.`);
      } else {
        console.log(`  Dry run: re-run with --delete to remove it from our DB.`);
      }
    } else if (res.ok) {
      const live = (await res.json()) as {
        key: string;
        fields: { project?: { key: string; name: string }; status?: { name: string } };
      };
      console.log(
        `  Jira says: issue STILL EXISTS as ${live.key} in project ${live.fields.project?.key ?? "?"} ` +
          `(status ${live.fields.status?.name ?? "?"}) — NOT deleting.`
      );
    } else {
      console.log(`  Jira says: HTTP ${res.status} — inconclusive, NOT deleting.`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

/**
 * One-off correction: provision a manager's Team Pulse board that an earlier
 * bulk run wrongly skipped.
 *
 * Background: provisionSingleManager's dedup check used to treat
 * `lower(createdBy) = managerEmail` as "already has a board". During a bulk
 * provision the acting superuser is the createdBy of EVERY board, so once any
 * board existed their own team (managerEmail == their email) matched createdBy
 * and was skipped. The check is now guarded with `managerEmail IS NULL`
 * (see src/lib/observer/provisioning.ts), so this script — running that fixed
 * code path — creates the board correctly.
 *
 * Idempotent: if the board now exists, provisionSingleManager returns null and
 * this script reports "nothing to do".
 *
 * Run: ./node_modules/.bin/tsx --env-file=.env.local \
 *        scripts/provision-missing-team.ts <managerEmail> [provisionRunId]
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { observerBoardProvisionRuns } from "../src/lib/db/schema";
import { provisionSingleManager } from "../src/lib/observer/provisioning";
import { ensureMemberJiraAccountId } from "../src/lib/jira/identity";

// Mirror of KekaDirectory.directReports run as a direct query — the cached
// read model (loadKekaDirectory) can't run outside the Next.js runtime.
async function lookupManagerAndReports(managerEmail: string) {
  const mgrRes = await db.execute(sql`
    SELECT display_name AS "displayName", user_id AS "userId"
    FROM keka_employees WHERE email = ${managerEmail} LIMIT 1
  `);
  const manager = mgrRes.rows[0] as { displayName: string | null; userId: string | null } | undefined;

  // Direct reports = anyone whose manager_email is this person, excluding a
  // self-report (matches directReports()).
  const repRes = await db.execute(sql`
    SELECT email, display_name AS "displayName"
    FROM keka_employees
    WHERE lower(manager_email) = ${managerEmail}
      AND lower(email) <> ${managerEmail}
    ORDER BY display_name
  `);
  const reports = repRes.rows as { email: string | null; displayName: string | null }[];
  return { manager, reports };
}

async function main() {
  const managerEmail = (process.argv[2] ?? "").toLowerCase().trim();
  const runId = process.argv[3]?.trim() || null;
  if (!managerEmail) {
    console.error("Usage: provision-missing-team.ts <managerEmail> [provisionRunId]");
    process.exit(1);
  }

  const { manager, reports } = await lookupManagerAndReports(managerEmail);
  if (!manager) {
    console.error(`${managerEmail} is not in the Keka directory (no active employee).`);
    process.exit(1);
  }

  if (reports.length === 0) {
    console.error(`${managerEmail} has no Keka direct reports — nothing to provision.`);
    process.exit(1);
  }

  const managerName = manager.displayName ?? managerEmail;
  const members = reports
    .map((r) => ({ email: (r.email ?? "").toLowerCase(), name: r.displayName ?? r.email ?? "Unknown" }))
    .filter((m) => m.email.length > 0);

  // Faithful created_by: whoever triggered the run we're attaching to; else the
  // manager's own user id (they own the board) or their email as a last resort.
  let createdBy = manager.userId ?? managerEmail;
  if (runId) {
    const [run] = await db
      .select({ triggeredBy: observerBoardProvisionRuns.triggeredBy })
      .from(observerBoardProvisionRuns)
      .where(eq(observerBoardProvisionRuns.id, runId))
      .limit(1);
    if (!run) {
      console.error(`Provision run ${runId} not found.`);
      process.exit(1);
    }
    createdBy = run.triggeredBy;
  }

  console.log(`== Provisioning ${managerName}'s Team ==`);
  console.log(`  manager:   ${managerEmail}`);
  console.log(`  members:   ${members.map((m) => m.email).join(", ")}`);
  console.log(`  createdBy: ${createdBy}`);
  console.log(`  run:       ${runId ?? "(standalone, no run id)"}`);

  const result = await db.transaction((tx) =>
    provisionSingleManager(tx, {
      managerEmail,
      managerName,
      boardName: `${managerName}'s Team`,
      createdBy,
      provisionRunId: runId,
      members,
    })
  );

  if (!result) {
    console.log("Board already exists for this manager — nothing to do.");
    return;
  }

  // Keep the run's display counts consistent with the board we just added.
  if (runId) {
    await db
      .update(observerBoardProvisionRuns)
      .set({
        boardsCreated: sql`${observerBoardProvisionRuns.boardsCreated} + 1`,
        membersCreated: sql`${observerBoardProvisionRuns.membersCreated} + ${result.membersCreated}`,
      })
      .where(eq(observerBoardProvisionRuns.id, runId));
  }

  console.log(`  created board ${result.boardId} with ${result.membersCreated} member(s).`);

  // Resolve Jira account ids inline (the request path fires these async; here we
  // await so the script doesn't exit before they land).
  let resolved = 0;
  for (const id of result.memberIds) {
    const acct = await ensureMemberJiraAccountId(id);
    if (acct) resolved++;
  }
  console.log(`  resolved ${resolved}/${result.memberIds.length} member Jira account id(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

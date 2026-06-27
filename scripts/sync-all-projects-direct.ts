/**
 * DB-direct force-sync of every active Jira project — no Clerk/API session token.
 *
 * Calls syncProject() directly for each active project, sequentially, using the
 * DB connection and per-project Jira credentials from .env.local. Unlike
 * scripts/force-sync-all-projects.ts (which goes through the prod API and needs a
 * short-lived __session cookie), this runs to completion unattended.
 *
 * Safe to run repeatedly. Continues past per-project failures and reports them
 * at the end. Run a second time if you want the per-project "Dev Owner" field to
 * narrow from all candidates to the single populated one (the first run can't
 * disambiguate until the values are actually stored).
 *
 * Run: ./node_modules/.bin/tsx --env-file=.env.local scripts/sync-all-projects-direct.ts
 */
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { jiraProjects } from "../src/lib/db/schema";
import { syncProject } from "../src/lib/jira/sync";

async function main() {
  const projects = await db
    .select({
      id: jiraProjects.id,
      name: jiraProjects.name,
      key: jiraProjects.jiraProjectKey,
    })
    .from(jiraProjects)
    .where(eq(jiraProjects.isActive, true));

  console.log(`Syncing ${projects.length} active projects (DB-direct)\n`);
  let ok = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const [i, p] of projects.entries()) {
    const label = `[${i + 1}/${projects.length}] ${p.name} (${p.key})`;
    process.stdout.write(`→ ${label} ... `);
    const t0 = Date.now();
    try {
      const res = await syncProject(p.id);
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`✓ ${JSON.stringify(res)} (${secs}s)`);
      ok++;
    } catch (err) {
      console.log(`✗ ${(err as Error).message}`);
      failures.push(`${p.key}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${ok} ok, ${failed} failed.`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

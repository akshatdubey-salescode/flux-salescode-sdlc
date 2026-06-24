/**
 * Full Keka employee-directory sync, run directly against the DB. Pulls every
 * employee from Keka HRIS into keka_employees, then resolves work emails to app
 * users. Idempotent — safe to re-run; the cron does the same work.
 *
 * Requires KEKA_SUBDOMAIN / KEKA_CLIENT_ID / KEKA_CLIENT_SECRET / KEKA_API_KEY.
 *
 * Run: ./node_modules/.bin/tsx --env-file=.env.local scripts/sync-keka.ts
 */

import { syncKekaEmployees } from "../src/lib/keka/sync";

async function main() {
  console.log("== Syncing Keka employee directory ==");
  const { synced, errors, resolved, pruned } = await syncKekaEmployees();
  console.log(`  ${synced} active employees upserted, ${pruned} inactive pruned, ${errors} errors`);
  console.log(`  ${resolved} employee(s) linked to app users by email`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

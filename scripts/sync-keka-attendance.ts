/**
 * Keka attendance backfill, run directly against the DB. Pulls attendance into
 * keka_attendance for a window; the client chunks it into ≤90-day requests.
 * Idempotent — safe to re-run; the cron does the same for a trailing window.
 * Use this for the heavy first population (no serverless time limit).
 *
 * Requires KEKA_SUBDOMAIN / KEKA_CLIENT_ID / KEKA_CLIENT_SECRET / KEKA_API_KEY,
 * and the keka_employees directory should be synced first (for the GUID link).
 *
 * Run:
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/sync-keka-attendance.ts
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/sync-keka-attendance.ts 2026-01-01 2026-06-30
 */

import { syncKekaAttendance } from "../src/lib/keka/attendance-sync";

async function main() {
  const from = process.argv[2];
  const to = process.argv[3];

  console.log("== Syncing Keka attendance ==");
  const r = await syncKekaAttendance(
    from && to ? { from, to } : { trailingDays: 365 }
  );
  console.log(`  window ${r.from} → ${r.to}`);
  console.log(
    `  ${r.synced} day-records upserted, ${r.skipped} skipped, ${r.errors} errors`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

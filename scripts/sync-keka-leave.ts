/**
 * Keka leave backfill, run directly against the DB. Pulls leave requests into
 * keka_leave for a window; the client chunks it into ≤60-day requests and
 * throttles under Keka's 50/min quota. Idempotent — safe to re-run (upserts on
 * the request id). The cron does the same for a trailing+forward window.
 *
 * Requires KEKA_SUBDOMAIN / KEKA_CLIENT_ID / KEKA_CLIENT_SECRET / KEKA_API_KEY,
 * and the keka_employees directory should be synced first (for the email link).
 *
 * Run:
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/sync-keka-leave.ts
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/sync-keka-leave.ts 2026-01-01 2026-12-31
 */

import { syncKekaLeave } from "../src/lib/keka/leave-sync";

async function main() {
  const from = process.argv[2];
  const to = process.argv[3];

  console.log("== Syncing Keka leave requests ==");
  const r = await syncKekaLeave(
    from && to ? { from, to } : { pastDays: 180, futureDays: 90 }
  );
  console.log(`  window ${r.from} → ${r.to}`);
  console.log(
    `  ${r.synced} leave requests upserted, ${r.skipped} skipped, ${r.errors} errors`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/**
 * Force a full calendar re-sync for one user and print the outcome.
 *
 * With googleFullSyncedAt NULL (or stale), syncUserCalendar does a full window
 * pull over [now-7d, now+60d], re-materializing future occurrences of recurring
 * series that the incremental syncToken feed never delivers on its own.
 *
 * Run: ./node_modules/.bin/tsx --env-file=.env.local scripts/resync-user-calendar.ts <userId>
 */

import { syncUserCalendar } from "@/lib/google/calendar-sync";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: tsx scripts/resync-user-calendar.ts <userId>");
  process.exit(1);
}

const result = await syncUserCalendar(userId);
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === "error" ? 1 : 0);

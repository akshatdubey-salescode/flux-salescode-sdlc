// Pure decisions for the 17:00 cron: when a project is due, and its
// "ready for approval" notice.
//
// The notice is tied to the report, not to whether this build created the row:
// a manual "Build now" earlier in the day must not suppress it. The cron claims
// the notice (markApproversNotified, once per report) and only then sends.

export type BuildOutcome =
  | { id: string; created: boolean }
  | { blocked: "already_final" };

/**
 * The report id whose notice the cron should try to claim, or null when no
 * notice is due: sending is disabled in this environment (so UAT never consumes
 * the claim), or today's report is no longer awaiting approval.
 */
export function approverNoticeCandidate(sendEnabled: boolean, outcome: BuildOutcome): string | null {
  if (!sendEnabled) return null;
  if ("blocked" in outcome) return null;
  return outcome.id;
}

/**
 * Whether the project's schedule builds a report on `reportDate` (a calendar
 * day in its timezone): every day when daily, only on `weeklyDay` when weekly
 * (user decision, 2026-11-25). "Build now" ignores the schedule.
 */
export function isScheduledDay(frequency: string, weeklyDay: number, reportDate: string): boolean {
  if (frequency !== "weekly") return true;
  const [y, m, d] = reportDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === weeklyDay;
}

/** Local wall time at which each project's report is built (in its own timezone). */
export const BUILD_MINUTE_OF_DAY = 17 * 60;
/** The cron runs every 30 minutes, so a project is due in the half hour from 17:00 local. */
export const BUILD_WINDOW_MIN = 30;

/**
 * Whether a cron run at `now` should build the project's report: true during
 * [17:00, 17:30) on the project's local clock. With a run every 30 minutes,
 * exactly one run lands in that window for any whole, half- or quarter-hour
 * UTC offset (IST 17:00, Nepal 17:15, Buenos Aires 17:00, …).
 */
export function isBuildDue(minutesOfDay: number): boolean {
  return minutesOfDay >= BUILD_MINUTE_OF_DAY && minutesOfDay < BUILD_MINUTE_OF_DAY + BUILD_WINDOW_MIN;
}

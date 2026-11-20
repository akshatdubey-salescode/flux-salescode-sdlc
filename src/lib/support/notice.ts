// Pure decision for the 17:00 cron's "ready for approval" notice.
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

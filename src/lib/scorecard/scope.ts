// Pure quarter-scope rules for the performance review (rating doc §5). Kept free
// of DB / clock imports so it can be unit-tested directly (see scope.test.ts).
import {
  extractStartDate,
  extractDueDate,
  extractActualStart,
  extractActualEnd,
} from "@/lib/jira/dates";

// YYYY-MM-DD (UTC) for a Date, matching the quarter-bound string format; null
// when the date is absent.
export function toDay(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// The fields isWorkInQuarter needs from a synced Jira issue (plus its project's
// discovered custom-field IDs). A subset of the build.ts query row.
export type ScopeRow = {
  customFields: Record<string, unknown> | null;
  createdAt: Date | null;
  completedAt: Date | null;
  startDateFieldIds: string[] | null;
  endDateFieldIds: string[] | null;
  actualStartFieldIds: string[] | null;
  actualEndFieldIds: string[] | null;
};

/**
 * Quarter membership for the performance review. An issue belongs to the quarter
 * where its WORK FINISHED, independent of when it was created — so carryover
 * raised in an earlier quarter but delivered here still counts.
 *
 *   finish = Actual end → planned End date → Done date (completedAt);
 *            must fall inside the quarter.
 *
 * The one exception is backdated CROSS-QUARTER data: if the start falls BEFORE
 * this quarter AND also predates the issue's own creation, the dates were filled
 * in after the fact — work can't begin before the ticket exists — so the issue
 * is dropped (e.g. a project bulk-imported mid-quarter with start dates backdated
 * to a prior quarter). A start already inside the quarter is genuine this-quarter
 * work and is kept even when the ticket was logged a few days after work began;
 * genuine cross-quarter work (a real earlier start) is still credited to the
 * quarter it was delivered in.
 *
 * quarter.start / quarter.end are YYYY-MM-DD (inclusive); all comparisons are
 * same-format string compares, which are chronological for ISO dates.
 */
export function isWorkInQuarter(
  row: ScopeRow,
  quarter: { start: string; end: string }
): boolean {
  const cf = row.customFields ?? {};

  // Must have FINISHED this quarter.
  const end =
    toDay(extractActualEnd(cf, row.actualEndFieldIds)) ??
    extractDueDate(cf, row.endDateFieldIds) ??
    toDay(row.completedAt);
  if (!end || end < quarter.start || end > quarter.end) return false;

  // Drop only backdated CROSS-QUARTER tickets: a start that falls before this
  // quarter and also predates the issue's own creation (work can't begin before
  // the ticket exists). A start inside the quarter is genuine this-quarter work,
  // even if the ticket was logged a few days after work began.
  const start =
    toDay(extractActualStart(cf, row.actualStartFieldIds)) ??
    extractStartDate(cf, row.startDateFieldIds);
  const created = toDay(row.createdAt);
  if (start && start < quarter.start && created && start < created) return false;

  return true;
}

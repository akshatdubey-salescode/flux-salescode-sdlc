/**
 * Shared estimation utilities for observer/team-pulse routes.
 *
 * Centralised here to avoid copy-paste drift across the six routes that
 * compute working-day estimates (board timeline, at-risk, overdue and their
 * project-scoped mirrors).
 *
 * All date strings are expected in "YYYY-MM-DD" format.
 * All datetime strings are expected in "YYYY-MM-DDTHH:MM:SS" (no tz suffix).
 */

import type { IssueLabel } from "@/app/api/observer/boards/[boardId]/timeline/route";

// ---------------------------------------------------------------------------
// Working-day arithmetic
// ---------------------------------------------------------------------------

/**
 * Counts Mon–Fri working days between two dates, inclusive of both ends.
 *
 * Uses O(1) integer arithmetic — safe for arbitrarily large date spans.
 * The naive day-by-day loop approach is O(n) and can OOM on long-running
 * issues (e.g. multi-year epics processed in bulk).
 *
 * Algorithm:
 *  1. Compute total inclusive calendar days.
 *  2. Full ISO weeks each contribute exactly 5 working days.
 *  3. The remaining (< 7) days are checked with a bounded loop (≤ 6 iters).
 */
export function workingDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate + "T00:00:00");
  const end   = new Date(endDate   + "T00:00:00");

  if (start > end) return 0;

  // Total inclusive calendar days between the two dates.
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  // Each full 7-day week contains exactly 5 working days.
  const fullWeeks    = Math.floor(totalDays / 7);
  let workingDays    = fullWeeks * 5;

  // Check the leftover days (0–6 iterations max — effectively O(1)).
  // Convert JS getDay() (Sun=0) to Mon-anchored index (Mon=0 … Sun=6).
  const startDow     = (start.getDay() + 6) % 7;
  const remainingDays = totalDays % 7;
  for (let i = 0; i < remainingDays; i++) {
    // Days 0–4 are Mon–Fri; 5–6 are Sat–Sun.
    if ((startDow + i) % 7 < 5) workingDays++;
  }

  return workingDays;
}

/**
 * Total working hours allocated to a task based on its start → due date span.
 * Assumes a 9-hour working day (10:00–19:00), calendar days only (not
 * Mon–Fri) — consistent with the existing at-risk percentage calculations.
 */
export function totalWorkingHours(startDate: string, dueDate: string): number {
  const startMs = new Date(startDate + "T00:00:00").getTime();
  const dueMs   = new Date(dueDate   + "T00:00:00").getTime();
  const days    = Math.max(0, Math.round((dueMs - startMs) / 86_400_000) + 1);
  return days * 9;
}

/**
 * Working hours remaining from `nowStr` until end-of-day on `dueDate`.
 * End-of-day is defined as 19:00 local time; start-of-day as 10:00.
 *
 * Returns 0 if the due date has already passed.
 */
export function workingHoursRemaining(nowStr: string, dueDate: string): number {
  const dueEndStr = dueDate + "T19:00:00";
  if (nowStr >= dueEndStr) return 0;

  let hours = 0;
  const todayDate    = nowStr.slice(0, 10);
  const todayStartStr = todayDate + "T10:00:00";
  const todayEndStr   = todayDate + "T19:00:00";

  if (nowStr < todayStartStr) {
    // Before work starts today — full day remains.
    hours += 9;
  } else if (nowStr < todayEndStr) {
    // Mid-day — partial hours remaining today.
    hours += (new Date(todayEndStr).getTime() - new Date(nowStr).getTime()) / 3_600_000;
  }
  // else: past end-of-day today — today contributes 0.

  // Full working days from tomorrow through dueDate — O(1).
  const tomorrowMs = new Date(todayDate + "T00:00:00").getTime() + 86_400_000;
  const dueMs      = new Date(dueDate   + "T00:00:00").getTime();
  const fullDays   = Math.max(0, Math.round((dueMs - tomorrowMs) / 86_400_000) + 1);
  hours += fullDays * 9;

  return hours;
}

/**
 * Working days remaining from today until dueDate, using the same
 * Mon–Fri O(1) counting as `workingDaysBetween`.
 *
 * Semantics mirror the existing calendar-day `daysRemaining` field:
 *   0  → due today (dueDate === today)
 *   +N → N working days until due (tomorrow counts as 1 if it's a weekday)
 *   -N → overdue by N working days
 *
 * Today is treated as "consumed" — we count from tomorrow onward so that
 * an issue due tomorrow always shows 1 regardless of the current time.
 * Exception: if dueDate === today we return 0 ("Due today").
 *
 * @param today   - Current date as "YYYY-MM-DD".
 * @param dueDate - Issue due date as "YYYY-MM-DD".
 */
export function workingDaysRemainingFromToday(today: string, dueDate: string): number {
  // Due today — treat as 0 remaining regardless of time of day.
  if (dueDate === today) return 0;

  // Overdue — return negative working days elapsed since the due date.
  if (dueDate < today) return -workingDaysBetween(dueDate, today);

  // Future — count Mon–Fri days from tomorrow through dueDate.
  // We advance by exactly one 24-hour period to get "tomorrow" without
  // constructing a Date object inside a tight loop.
  const tomorrowMs = new Date(today + "T00:00:00").getTime() + 86_400_000;
  const tomorrow   = new Date(tomorrowMs).toISOString().slice(0, 10);
  return workingDaysBetween(tomorrow, dueDate);
}

// ---------------------------------------------------------------------------
// Issue classification
// ---------------------------------------------------------------------------

/**
 * Classifies an issue into one of four labels based on its status and
 * remaining time. "At risk" means ≤ 20 % of allocated working hours remain.
 */
export function classifyIssue(
  statusCategory: string | null,
  startDate: string,
  dueDate: string,
  nowStr: string,
): IssueLabel {
  const cat = (statusCategory ?? "").toLowerCase();
  if (cat === "done" || cat.includes("complete")) return "done";

  const today = nowStr.slice(0, 10);
  if (dueDate < today) return "overdue";

  const total     = totalWorkingHours(startDate, dueDate);
  const remaining = workingHoursRemaining(nowStr, dueDate);
  if (total > 0 && remaining / total <= 0.2) return "at_risk";

  return "on_track";
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/**
 * Safely parses the estimate threshold from a DB value that may be missing
 * (e.g. before the migration runs) or malformed.
 *
 * Logs a warning and falls back to 2 working days so callers never crash.
 *
 * @param raw   - Raw value from the DB column (string | null | undefined).
 * @param route - Caller label used in the warning message for traceability.
 */
export function safeThreshold(raw: unknown, route = "unknown"): number {
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) {
    console.warn(
      `[${route}] estimateThresholdDays missing or invalid — defaulting to 2. Got:`,
      raw,
    );
    return 2;
  }
  return n;
}

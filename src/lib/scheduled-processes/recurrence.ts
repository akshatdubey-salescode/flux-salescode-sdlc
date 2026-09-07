import { istNowStr } from "@/lib/sprints/risk";
import type { CadenceSpec } from "./types";

/**
 * All the date math the midnight run needs, over plain YYYY-MM-DD calendar
 * days. Pure and server-import-free so it is unit-testable and the compose
 * dialog can preview "next send" without a round trip.
 *
 * Two rules hold everywhere in here:
 *
 * 1. The calendar is IST, never UTC. Between 00:00 and 05:30 IST a UTC "today"
 *    still reads yesterday — the bug istNowStr already exists to prevent for
 *    the risk columns (see risk.ts). A schedule is due on an IST day, so it
 *    has to be judged on one; that helper is reused rather than duplicated so
 *    there is only ever one definition of "today" in the codebase.
 * 2. The next run is always STRICTLY AFTER the day handed in. Creating a daily
 *    schedule this afternoon sends at the next midnight, not instantly, and
 *    advancing after a send can never land back on the day just sent — which
 *    is what keeps the run loop from re-sending inside one night.
 */

/** Today as an IST calendar day, "YYYY-MM-DD" — the shape the date columns use. */
export function istToday(now: Date = new Date()): string {
  return istNowStr(now).slice(0, 10);
}

type Ymd = { year: number; month: number; day: number };

/** month is 1-based, matching the string form rather than JS's 0-based months. */
function parseDay(value: string): Ymd {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function formatDay({ year, month, day }: Ymd): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Day 0 of the following month is the last day of this one. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar-day arithmetic via UTC, so a DST-shifting local zone can't skew it. */
export function addDays(value: string, delta: number): string {
  const { year, month, day } = parseDay(value);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return shifted.toISOString().slice(0, 10);
}

/** 0 = Sunday, matching WEEKDAY_LABELS and the day_of_week column. */
export function dayOfWeekOf(value: string): number {
  const { year, month, day } = parseDay(value);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The first day matching the cadence that falls strictly after `after`.
 *
 * Monthly clamps to the month's real length: the 31st means "the 31st, or the
 * last day where there isn't one", so a month-end schedule still fires in
 * February instead of silently skipping it.
 */
export function computeNextRunOn(spec: CadenceSpec, after: string): string {
  switch (spec.frequency) {
    case "daily":
      return addDays(after, 1);

    case "weekly": {
      const target = spec.dayOfWeek ?? 1;
      const current = dayOfWeekOf(after);
      // 1–7 rather than 0–6: landing on the same weekday means next week, not
      // today, which is what keeps "strictly after" true.
      const delta = ((target - current + 6) % 7) + 1;
      return addDays(after, delta);
    }

    case "monthly": {
      const wanted = spec.dayOfMonth ?? 1;
      const { year, month, day } = parseDay(after);
      const thisMonth = Math.min(wanted, daysInMonth(year, month));
      if (thisMonth > day) return formatDay({ year, month, day: thisMonth });
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      return formatDay({
        year: nextYear,
        month: nextMonth,
        day: Math.min(wanted, daysInMonth(nextYear, nextMonth)),
      });
    }
  }
}

export type NextRun = { nextRunOn: string } | { ended: true };

/**
 * computeNextRunOn plus the end date: once the next occurrence would fall past
 * `endsOn` the schedule is finished, and the caller stops it rather than
 * parking a row that can never come due.
 */
export function nextRunAfter(
  spec: CadenceSpec,
  after: string,
  endsOn: string | null
): NextRun {
  const nextRunOn = computeNextRunOn(spec, after);
  if (endsOn && nextRunOn > endsOn) return { ended: true };
  return { nextRunOn };
}

/**
 * The first send for a schedule being created now: the next occurrence after
 * today. Creating a schedule never mails immediately — the compose dialog's
 * "Send now" button is right there for that.
 */
export function firstRunOn(spec: CadenceSpec, today: string = istToday()): NextRun {
  return nextRunAfter(spec, today, null);
}

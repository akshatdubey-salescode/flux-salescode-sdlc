// Pure Salescode-time math (no server/DB imports; safe for client components).
import type { OfficeHours, OwnershipEvent } from "./types";
import { addDays, dateInZone, wallTimeToInstant, weekdayOf } from "./tz";

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Minutes of [start, end) that fall on a working day within office hours, both
 * read as wall time in the office hours' timezone (DST-aware).
 */
export function officeMinutesBetween(start: Date, end: Date, hours: OfficeHours): number {
  const s = start.getTime();
  const e = end.getTime();
  if (e <= s) return 0;
  const tz = hours.timeZone;
  let totalMs = 0;
  const last = dateInZone(new Date(e - 1), tz);
  for (let day = dateInZone(start, tz); day <= last; day = addDays(day, 1)) {
    if (!hours.days.includes(weekdayOf(day))) continue;
    const open = wallTimeToInstant(day, hours.start, tz).getTime();
    const close = wallTimeToInstant(day, hours.end, tz).getTime();
    const from = Math.max(s, open);
    const to = Math.min(e, close);
    if (to > from) totalMs += to - from;
  }
  return totalMs / MIN_MS;
}

/** Whole office-hour minutes in [start, end) during which Salescode owned the ticket. */
export function salescodeMinutes(
  start: Date,
  end: Date,
  events: OwnershipEvent[],
  hours: OfficeHours,
): number {
  if (end.getTime() <= start.getTime()) return 0;
  const sorted = events
    .filter((ev) => ev.at.getTime() < end.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  let side: "salescode" | "client" = "salescode";
  for (const ev of sorted) {
    if (ev.at.getTime() <= start.getTime()) side = ev.side;
  }

  let total = 0;
  let cursor = start;
  for (const ev of sorted) {
    if (ev.at.getTime() <= start.getTime()) continue;
    if (side === "salescode") total += officeMinutesBetween(cursor, ev.at, hours);
    cursor = ev.at;
    side = ev.side;
  }
  if (side === "salescode") total += officeMinutesBetween(cursor, end, hours);
  return Math.floor(total);
}

export function formatDuration(min: number | null): string {
  if (min === null) return "–";
  const total = Math.floor(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** Whole days between two YYYY-MM-DD calendar dates (both in the project's timezone). */
export function ageDays(createdOn: string, reportDate: string): number {
  return Math.round((Date.parse(reportDate) - Date.parse(createdOn)) / DAY_MS);
}

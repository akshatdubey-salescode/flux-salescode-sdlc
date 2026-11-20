// Pure Salescode-time math (no server/DB imports; safe for client components).
import type { OfficeHours, OwnershipEvent } from "./types";

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * MIN_MS;

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Minutes of [start, end) that fall on an IST working day within office hours. */
export function officeMinutesBetween(start: Date, end: Date, hours: OfficeHours): number {
  const s = start.getTime() + IST_OFFSET_MS; // IST wall-clock as pseudo-UTC
  const e = end.getTime() + IST_OFFSET_MS;
  if (e <= s) return 0;
  const openMs = hhmmToMinutes(hours.start) * MIN_MS;
  const closeMs = hhmmToMinutes(hours.end) * MIN_MS;
  let totalMs = 0;
  for (let day = Math.floor(s / DAY_MS); day <= Math.floor((e - 1) / DAY_MS); day++) {
    const dow = (((day + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
    if (!hours.days.includes(dow)) continue;
    const from = Math.max(s, day * DAY_MS + openMs);
    const to = Math.min(e, day * DAY_MS + closeMs);
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

/** Whole days between two YYYY-MM-DD IST calendar dates. */
export function ageDays(createdOnIst: string, reportDate: string): number {
  return Math.round((Date.parse(reportDate) - Date.parse(createdOnIst)) / DAY_MS);
}

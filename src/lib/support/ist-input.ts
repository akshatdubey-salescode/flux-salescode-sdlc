// Pure IST helpers for <input type="datetime-local"> values. The input has no
// timezone, so we treat its `YYYY-MM-DDTHH:mm` value as Asia/Kolkata wall
// time regardless of the browser's timezone. Safe for client components.

const IST_OFFSET_MS = 330 * 60_000;

/** `YYYY-MM-DDTHH:mm` IST wall time for a Date (or ISO string). */
export function toIstInputValue(d: Date | string): string {
  const ms = (typeof d === "string" ? new Date(d) : d).getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** Parses a datetime-local value as IST; null when empty or malformed. */
export function fromIstInputValue(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) return null;
  const d = new Date(`${v}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const IST_DATETIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Human-readable IST timestamp, e.g. "20 Nov 2026, 10:30". */
export function formatIstDateTime(iso: string): string {
  return IST_DATETIME.format(new Date(iso));
}

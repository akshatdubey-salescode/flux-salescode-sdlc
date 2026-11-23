// Pure IANA-timezone helpers for the support report (no server/DB imports;
// safe for client components). Each project has one timezone (Settings →
// Timezone, default Asia/Kolkata) that drives its report day, office hours,
// build time, and every time typed or shown for it (user decision, 2026-11-21).
// DST-correct: conversions go through Intl, never a fixed offset.

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsFmt.set(tz, f);
  }
  return f;
}

type WallParts = { y: number; mo: number; d: number; h: number; mi: number; s: number };

function wallParts(at: Date, tz: string): WallParts {
  const p: Record<string, number> = {};
  for (const x of partsFormatter(tz).formatToParts(at)) {
    if (x.type !== "literal") p[x.type] = Number(x.value);
  }
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** The zone's UTC offset at an instant, in ms (e.g. +19_800_000 for IST). */
function offsetMs(at: Date, tz: string): number {
  const p = wallParts(at, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day ("YYYY-MM-DD") of an instant in the zone. */
export function dateInZone(at: Date, tz: string): string {
  const p = wallParts(at, tz);
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`;
}

/** Minutes since local midnight of an instant in the zone. */
export function minutesOfDayInZone(at: Date, tz: string): number {
  const p = wallParts(at, tz);
  return p.h * 60 + p.mi;
}

/** Day of week of a "YYYY-MM-DD" calendar day, Sunday = 0. */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const instantCache = new Map<string, number>();

/**
 * The instant at which the zone's wall clock reads `hhmm` on `ymd`. "24:00" is
 * the following midnight. A wall time skipped by a DST jump resolves to the
 * instant just after the jump.
 */
export function wallTimeToInstant(ymd: string, hhmm: string, tz: string): Date {
  const key = `${tz}|${ymd}|${hhmm}`;
  const hit = instantCache.get(key);
  if (hit !== undefined) return new Date(hit);
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi || 0);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  if (instantCache.size > 50_000) instantCache.clear();
  instantCache.set(key, t);
  return new Date(t);
}

/** `YYYY-MM-DDTHH:mm` wall time in the zone, for date-time inputs. */
export function toZonedInputValue(at: Date | string, tz: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const p = wallParts(d, tz);
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** Parses a `YYYY-MM-DDTHH:mm` wall time in the zone; null when empty or malformed. */
export function fromZonedInputValue(v: string, tz: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(v);
  if (!m) return null;
  const d = wallTimeToInstant(m[1], m[2], tz);
  return Number.isNaN(d.getTime()) ? null : d;
}

const displayFmt = new Map<string, Intl.DateTimeFormat>();

/** Human-readable wall time in the zone, e.g. "20 Nov 2026, 10:30". */
export function formatZonedDateTime(iso: string | Date, tz: string): string {
  let f = displayFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-IN", {
      timeZone: tz,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    displayFmt.set(tz, f);
  }
  return f.format(typeof iso === "string" ? new Date(iso) : iso);
}

function shortName(tz: string, at: Date, locale: string): string {
  return (
    new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "short" })
      .formatToParts(at)
      .find((x) => x.type === "timeZoneName")?.value ?? tz
  );
}

/**
 * A short label for the zone at an instant: a familiar abbreviation where ICU
 * has one ("IST", "EST", "GST"), else the offset ("GMT-3").
 */
export function zoneLabel(tz: string, at: Date = new Date()): string {
  const inIndia = shortName(tz, at, "en-IN");
  if (!inIndia.startsWith("GMT")) return inIndia;
  const inUs = shortName(tz, at, "en-US");
  return inUs.startsWith("GMT") ? inIndia : inUs;
}

/** IANA zones for a picker, with Asia/Calcutta shown under its current name. */
export function timeZoneOptions(): string[] {
  const all =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [DEFAULT_TIME_ZONE, "UTC"];
  const named = all.map((z) => (z === "Asia/Calcutta" ? DEFAULT_TIME_ZONE : z));
  if (!named.includes(DEFAULT_TIME_ZONE)) named.push(DEFAULT_TIME_ZONE);
  if (!named.includes("UTC")) named.push("UTC");
  return [...new Set(named)].sort();
}

/**
 * Compute the UTC instant of local midnight (00:00:00) on the given date in
 * the given IANA timezone. Falls back to UTC midnight when tz is empty or
 * invalid — preserves the old behavior for callers that don't pass a tz.
 *
 * The implementation uses Intl to discover the wall-clock representation of
 * a probe instant inside the tz, then back-solves the offset. Mid-day probe
 * (12:00 UTC) avoids DST-transition edges that can occur right at midnight.
 */
export function zonedDayStartToUtc(dateStr: string, tz?: string | null): Date {
  const utcMidnight = new Date(`${dateStr}T00:00:00Z`);
  if (!tz) return utcMidnight;

  let parts: Intl.DateTimeFormatPart[];
  try {
    const probe = new Date(`${dateStr}T12:00:00Z`);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    parts = fmt.formatToParts(probe);
    const get = (t: string) =>
      parts.find((p) => p.type === t)?.value ?? "00";
    const wallAsIfUtc = Date.parse(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`
    );
    // Difference between "the wall clock in tz" and "the real UTC instant"
    // gives us the tz's offset on this date.
    const offsetMs = wallAsIfUtc - probe.getTime();
    return new Date(utcMidnight.getTime() - offsetMs);
  } catch {
    // Invalid timezone string — fall back to UTC.
    return utcMidnight;
  }
}

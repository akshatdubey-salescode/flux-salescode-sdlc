import { format } from "date-fns";
import type { PeriodMode } from "./types";

/**
 * Pure report-period windows over calendar days in the project's timezone
 * (see tz.ts for turning instants into those days). No server/DB imports.
 */

/** A local-time Date for a YYYY-MM-DD day, so date-fns formats it unshifted. */
function localDay(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function reportWindow(
  reportDate: string,
  mode: PeriodMode,
  customStart: string | null,
): { start: string; end: string; label: string } {
  const end = reportDate;
  if (mode === "ytd") {
    return { start: `${reportDate.slice(0, 4)}-01-01`, end, label: "YTD" };
  }
  if (mode === "custom" && customStart) {
    const sameYear = customStart.slice(0, 4) === end.slice(0, 4);
    const from = format(localDay(customStart), sameYear ? "d MMM" : "d MMM yyyy");
    const to = format(localDay(end), "d MMM yyyy");
    return { start: customStart, end, label: `${from} – ${to}` };
  }
  return { start: `${reportDate.slice(0, 7)}-01`, end, label: "MTD" };
}

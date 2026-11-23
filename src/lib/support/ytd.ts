// Pure year-to-date ticket snapshot for the support report's Excel attachment.
// No DB/server imports (store types come in via `import type`), so it is unit
// tested in ytd.test.ts and safe for client components.
//
// User decision, 2026-11-20 (revised the same day): the email carries every
// support ticket whose effective raised time falls on a date (in the project's
// timezone) from the
// start of the project up to the report date inclusive (no lower bound) — open and closed, all categories, uncategorised
// included — independent of the project's period setting. The rows are
// computed at build time and stored on the report, so what is sent is what
// was previewed.

import { format } from "date-fns";
import type { SupportTicketRow } from "./ticket-row";
import type { OfficeHours, YtdTicketRow } from "./types";
import { salescodeMinutes } from "./time";
import { dateInZone } from "./tz";

export function buildYtdRows(
  rows: SupportTicketRow[],
  reportDate: string,
  officeHours: OfficeHours,
): YtdTicketRow[] {
  return rows
    .filter((t) => dateInZone(t.createdAt, officeHours.timeZone) <= reportDate)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.jiraKey.localeCompare(b.jiraKey))
    .map((t) => ({
      jiraKey: t.jiraKey,
      summary: t.summary,
      category: t.category,
      priority: t.priority,
      status: t.status,
      isOpen: t.resolvedAt === null,
      raisedAt: t.createdAt.toISOString(),
      firstRespondedAt: t.firstRespondedAt?.toISOString() ?? null,
      responseMin:
        t.firstRespondedAt === null ? null : salescodeMinutes(t.createdAt, t.firstRespondedAt, t.events, officeHours),
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
      resolutionMin:
        t.resolvedAt === null ? null : salescodeMinutes(t.createdAt, t.resolvedAt, t.events, officeHours),
      ownerSide: t.ownerSide,
      rcaShared: t.rcaGiven,
      usersReported: t.usersReported,
      usersImpacted: t.usersImpacted,
      eta: t.eta,
    }));
}

/** A local-time Date for a YYYY-MM-DD day, so date-fns formats it unshifted. */
function localDay(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "20 Nov 2026" for a YYYY-MM-DD calendar day. */
export function formatDayMonthYear(ymd: string): string {
  return format(localDay(ymd), "d MMM yyyy");
}

/** The attachment's file name; characters invalid in file names become "-". */
export function ytdAttachmentFilename(projectName: string, reportDate: string): string {
  const name = `Support tickets - ${projectName} - ${formatDayMonthYear(reportDate)}.xlsx`;
  return name.replace(/[\\/:*?"<>|]/g, "-");
}

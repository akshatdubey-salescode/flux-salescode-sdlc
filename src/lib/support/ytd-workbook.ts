// The support report's all-time (project start → report date) Excel attachment:
// one sheet per year-month of the raised time in the project's timezone (user
// decisions, 2026-11-20 and 2026-11-21). Built only from
// the rows stored on the report (`data.ytdTickets`), never from live data, so
// the attachment sent is the one that could be downloaded for review.

import ExcelJS from "exceljs";
import { formatDuration } from "./time";
import { CATEGORY_LABELS, type YtdTicketRow } from "./types";
import { dateInZone, DEFAULT_TIME_ZONE, formatZonedDateTime, wallTimeToInstant, zoneLabel } from "./tz";
import { formatDayMonthYear } from "./ytd";

export { ytdAttachmentFilename } from "./ytd";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Column = { header: string; width: number; value: (r: YtdTicketRow) => string | number | null };

/** Columns for a workbook in `tz`; `label` is the zone's short name ("IST", "GMT-3"). */
function columns(tz: string, label: string): Column[] {
  const when = (iso: string | null) => (iso ? formatZonedDateTime(iso, tz) : null);
  return [

  { header: "Jira Key", width: 14, value: (r) => r.jiraKey },
  { header: "Summary", width: 60, value: (r) => r.summary },
  { header: "Category", width: 16, value: (r) => (r.category ? CATEGORY_LABELS[r.category] : "Uncategorised") },
  { header: "Priority", width: 10, value: (r) => r.priority },
  { header: "Open/Closed", width: 13, value: (r) => (r.isOpen ? "Open" : "Closed") },
  { header: `Raised (${label})`, width: 20, value: (r) => when(r.raisedAt) },
  { header: `First Response (${label})`, width: 20, value: (r) => when(r.firstRespondedAt) },
  { header: "Response Time (office hrs)", width: 16, value: (r) => formatDuration(r.responseMin) },
  { header: `Resolved (${label})`, width: 20, value: (r) => when(r.resolvedAt) },
  { header: "Resolution Time (office hrs)", width: 16, value: (r) => formatDuration(r.resolutionMin) },
  { header: "Currently With", width: 15, value: (r) => (r.ownerSide === "client" ? "Client" : "Salescode") },
  { header: "RCA Shared", width: 11, value: (r) => (r.rcaShared ? "Yes" : "No") },
  { header: "Users Reported", width: 10, value: (r) => r.usersReported },
  { header: "Users Impacted", width: 10, value: (r) => r.usersImpacted },
  { header: "ETA", width: 13, value: (r) => (r.eta ? formatDayMonthYear(r.eta) : null) },
  ];
}

/** The zone's short name as of the report date (so DST zones label consistently). */
function labelFor(tz: string, reportDate: string): string {
  return zoneLabel(tz, wallTimeToInstant(reportDate, "12:00", tz));
}

/** The header row of a workbook built in `tz` for `reportDate`. */
export function ytdHeaders(tz: string = DEFAULT_TIME_ZONE, reportDate = "2026-01-01"): string[] {
  return columns(tz, labelFor(tz, reportDate)).map((c) => c.header);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jan 2026" for a "2026-01" year-month. */
function sheetName(yearMonth: string): string {
  return `${MONTHS[Number(yearMonth.slice(5, 7)) - 1]} ${yearMonth.slice(0, 4)}`;
}

function addSheet(wb: ExcelJS.Workbook, name: string, rows: YtdTicketRow[], cols: Column[]): void {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ width: c.width }));
  const head = ws.addRow(cols.map((c) => c.header));
  head.font = { bold: true };
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  });
  for (const r of rows) ws.addRow(cols.map((c) => c.value(r)));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}

export async function buildYtdWorkbook(
  rows: YtdTicketRow[],
  meta: { projectName: string; reportDate: string; timeZone?: string },
): Promise<Buffer> {
  // Reports built before per-project timezones (2026-11-21) were IST.
  const tz = meta.timeZone ?? DEFAULT_TIME_ZONE;
  const cols = columns(tz, labelFor(tz, meta.reportDate));
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flux";
  wb.title = `Support tickets - ${meta.projectName} - ${meta.reportDate}`;

  const byMonth = new Map<string, YtdTicketRow[]>();
  for (const r of rows) {
    const ym = dateInZone(new Date(r.raisedAt), tz).slice(0, 7);
    const bucket = byMonth.get(ym);
    if (bucket) bucket.push(r);
    else byMonth.set(ym, [r]);
  }

  if (byMonth.size === 0) {
    addSheet(wb, "No tickets", [], cols);
  } else {
    for (const ym of [...byMonth.keys()].sort()) {
      const monthRows = byMonth.get(ym)!.sort((a, b) => Date.parse(a.raisedAt) - Date.parse(b.raisedAt));
      addSheet(wb, sheetName(ym), monthRows, cols);
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

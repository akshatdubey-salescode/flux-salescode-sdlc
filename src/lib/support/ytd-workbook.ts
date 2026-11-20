// The support report's year-to-date Excel attachment: one sheet per IST
// year-month of the raised time (user decision, 2026-11-20). Built only from
// the rows stored on the report (`data.ytdTickets`), never from live data, so
// the attachment sent is the one that could be downloaded for review.

import ExcelJS from "exceljs";
import { formatIstDateTime } from "./ist-input";
import { formatDuration } from "./time";
import { CATEGORY_LABELS, type YtdTicketRow } from "./types";
import { istDateOf } from "./windows";
import { formatDayMonthYear } from "./ytd";

export { ytdAttachmentFilename } from "./ytd";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const COLUMNS: { header: string; width: number; value: (r: YtdTicketRow) => string | number | null }[] = [
  { header: "Jira Key", width: 14, value: (r) => r.jiraKey },
  { header: "Summary", width: 60, value: (r) => r.summary },
  { header: "Category", width: 16, value: (r) => (r.category ? CATEGORY_LABELS[r.category] : "Uncategorised") },
  { header: "Priority", width: 10, value: (r) => r.priority },
  { header: "Open/Closed", width: 13, value: (r) => (r.isOpen ? "Open" : "Closed") },
  { header: "Raised (IST)", width: 20, value: (r) => formatIstDateTime(r.raisedAt) },
  {
    header: "First Response (IST)",
    width: 20,
    value: (r) => (r.firstRespondedAt ? formatIstDateTime(r.firstRespondedAt) : null),
  },
  { header: "Response Time (office hrs)", width: 16, value: (r) => formatDuration(r.responseMin) },
  { header: "Resolved (IST)", width: 20, value: (r) => (r.resolvedAt ? formatIstDateTime(r.resolvedAt) : null) },
  { header: "Resolution Time (office hrs)", width: 16, value: (r) => formatDuration(r.resolutionMin) },
  { header: "Currently With", width: 15, value: (r) => (r.ownerSide === "client" ? "Client" : "Salescode") },
  { header: "RCA Shared", width: 11, value: (r) => (r.rcaShared ? "Yes" : "No") },
  { header: "Users Reported", width: 10, value: (r) => r.usersReported },
  { header: "Users Impacted", width: 10, value: (r) => r.usersImpacted },
  { header: "ETA", width: 13, value: (r) => (r.eta ? formatDayMonthYear(r.eta) : null) },
];

export const YTD_HEADERS = COLUMNS.map((c) => c.header);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jan 2026" for a "2026-01" IST year-month. */
function sheetName(yearMonth: string): string {
  return `${MONTHS[Number(yearMonth.slice(5, 7)) - 1]} ${yearMonth.slice(0, 4)}`;
}

function addSheet(wb: ExcelJS.Workbook, name: string, rows: YtdTicketRow[]): void {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ width: c.width }));
  const head = ws.addRow(YTD_HEADERS);
  head.font = { bold: true };
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  });
  for (const r of rows) ws.addRow(COLUMNS.map((c) => c.value(r)));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
}

export async function buildYtdWorkbook(
  rows: YtdTicketRow[],
  meta: { projectName: string; reportDate: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flux";
  wb.title = `Support tickets YTD - ${meta.projectName} - ${meta.reportDate}`;

  const byMonth = new Map<string, YtdTicketRow[]>();
  for (const r of rows) {
    const ym = istDateOf(new Date(r.raisedAt)).slice(0, 7);
    const bucket = byMonth.get(ym);
    if (bucket) bucket.push(r);
    else byMonth.set(ym, [r]);
  }

  if (byMonth.size === 0) {
    addSheet(wb, "No tickets", []);
  } else {
    for (const ym of [...byMonth.keys()].sort()) {
      const monthRows = byMonth.get(ym)!.sort((a, b) => Date.parse(a.raisedAt) - Date.parse(b.raisedAt));
      addSheet(wb, sheetName(ym), monthRows);
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

import ExcelJS from "exceljs";
import { classifyIssue } from "@/lib/jira/estimate";
import type { SprintWithItems, SprintItemRow } from "@/lib/sprints/entries";

// The sprint report workbook (Summary + Items sheets, deliveries-export
// theme). Shared by the download route (/api/sprints/export) and the
// email-to-stakeholders route, so the attachment always matches the download.

const TEAL = "FF0D9488";
const TEAL_DARK = "FF0F766E";
const ZEBRA = "FFF0FDFA";
const BORDER = "FFE5E7EB";
const TEXT = "FF111827";
const MUTED = "FF6B7280";
const AMBER = "FFB45309";

const HEADERS = [
  "Jira Key",
  "Summary",
  "Status",
  "Risk",
  "Priority",
  "Assignee",
  "Start Date",
  "End Date",
  "Actual Start",
  "Actual End",
  "Scope",
  "Reason",
  "Added On",
  "Added By",
];

const RED = "FFB91C1C";

/** Same classification the Team Tracking views and the on-screen sprint table use. */
function riskLabel(item: SprintItemRow, nowStr: string): string {
  const cat = (item.statusCategory ?? "").toLowerCase();
  if (cat === "done" || cat.includes("complete")) return "";
  if (!item.startDate || !item.dueDate) return "Unplanned";
  const label = classifyIssue(item.statusCategory, item.startDate, item.dueDate, nowStr);
  if (label === "overdue") return "Overdue";
  if (label === "at_risk") return "At risk";
  return "";
}

/**
 * Actual Start/End are date+time fields in Jira — render both. The export is
 * built server-side (UTC on Vercel), so pin the org timezone instead of the
 * server's; the on-screen table shows the viewer's local time.
 */
const ACTUAL_DT_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatActualDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return ACTUAL_DT_FORMAT.format(d);
}

function phaseLabel(s: SprintWithItems): string {
  if (s.completedAt) return "Completed";
  if (s.startedAt) return "Active";
  return "Planned";
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

function sprintDays(s: SprintWithItems): number {
  return Math.round((new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 86_400_000) + 1;
}

/**
 * Sheet 1: the at-a-glance summary — one labeled block per sprint, readable
 * without scanning the item rows, so opening the file immediately answers
 * "what sprint is this and how did it go".
 */
function buildSummarySheet(wb: ExcelJS.Workbook, sprints: SprintWithItems[]) {
  const ws = wb.addWorksheet("Summary");
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 64;

  ws.mergeCells(1, 1, 1, 2);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = "Sprint Report — Summary";
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_DARK } };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, 2);
  const subCell = ws.getCell(2, 1);
  subCell.value = `Exported ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · full item detail on the "Items" sheet`;
  subCell.font = { name: "Calibri", size: 10, color: { argb: "FFFFFFFF" }, italic: true };
  subCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  ws.getRow(2).height = 18;

  let r = 4;
  for (const sprint of sprints) {
    const rollup = sprint.rollup;
    const started = !!sprint.startedAt;
    const pct = rollup.committed > 0 ? Math.round((rollup.committedDone / rollup.committed) * 100) : 0;
    const unfinished = rollup.total - rollup.done;

    ws.mergeCells(r, 1, r, 2);
    const nameCell = ws.getCell(r, 1);
    nameCell.value = `${sprint.name} — ${phaseLabel(sprint)}`;
    nameCell.font = { name: "Calibri", size: 13, bold: true, color: { argb: TEAL_DARK } };
    nameCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    nameCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F7F4" } };
    ws.getRow(r).height = 24;
    r++;

    const lines: [string, string, { bold?: boolean; amber?: boolean }?][] = [
      ["Time box", `${sprint.startDate} → ${sprint.endDate} (${sprintDays(sprint)} days)`],
      ...(sprint.goal ? ([["Goal", sprint.goal]] as [string, string][]) : []),
      [
        "Started",
        started ? `${fmtDate(sprint.startedAt)}${sprint.startedByName ? ` by ${sprint.startedByName}` : ""}` : "Not started — commitment not locked yet",
      ],
      ...(sprint.completedAt
        ? ([["Completed", `${fmtDate(sprint.completedAt)}${sprint.completedByName ? ` by ${sprint.completedByName}` : ""}`]] as [string, string][])
        : []),
      ...(started
        ? ([
            ["Committed at start", `${rollup.committed} issue${rollup.committed === 1 ? "" : "s"}`],
            ["Commitment completed", `${rollup.committedDone} of ${rollup.committed} (${pct}%)`, { bold: true }],
            ["Scope added after start *", `${rollup.addedAfterStart}`, { amber: rollup.addedAfterStart > 0 }],
            ["Removed after start", `${rollup.removed}`],
            ["Carried in from earlier sprints", `${rollup.carriedOver}`],
          ] as [string, string, { bold?: boolean; amber?: boolean }?][])
        : ([["Planned scope", `${rollup.total} issue${rollup.total === 1 ? "" : "s"}`]] as [string, string][])),
      ["Current progress", `${rollup.done} done · ${rollup.inProgress} in progress · ${rollup.todo} to do (of ${rollup.total})`],
      [
        sprint.completedAt ? "Spillover at close" : "Unfinished right now",
        `${unfinished} issue${unfinished === 1 ? "" : "s"}`,
        { amber: unfinished > 0 && !!sprint.completedAt },
      ],
    ];

    for (const [label, value, opts] of lines) {
      const lc = ws.getCell(r, 1);
      lc.value = label;
      lc.font = { name: "Calibri", size: 11, color: { argb: MUTED } };
      lc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      const vc = ws.getCell(r, 2);
      vc.value = value;
      vc.font = {
        name: "Calibri",
        size: 11,
        bold: opts?.bold ?? false,
        color: { argb: opts?.amber ? AMBER : TEXT },
      };
      vc.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      ws.getCell(r, 1).border = { bottom: { style: "hair", color: { argb: BORDER } } };
      ws.getCell(r, 2).border = { bottom: { style: "hair", color: { argb: BORDER } } };
      r++;
    }
    r++; // blank row between sprints
  }
}

function scopeLabel(item: SprintItemRow, started: boolean): string {
  if (!started) return "Planned";
  const carried = item.carriedFromSprintName ? ` (carried from ${item.carriedFromSprintName})` : "";
  if (item.committed) return `Committed${carried}`;
  return `Added after start *${carried}`;
}

export async function buildSprintWorkbook(sprints: SprintWithItems[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flux";
  wb.created = new Date();

  buildSummarySheet(wb, sprints);

  const ws = wb.addWorksheet("Items", { views: [{ state: "frozen", ySplit: 3 }] });
  const colCount = HEADERS.length;

  const totalItems = sprints.reduce((n, s) => n + s.items.length + s.removedItems.length, 0);
  const generatedOn = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  // Banner (rows 1–2), matching the deliveries export theme.
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = "Sprint Report — Items";
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_DARK } };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, colCount);
  const subCell = ws.getCell(2, 1);
  subCell.value = `${sprints.length} sprint${sprints.length === 1 ? "" : "s"} · ${totalItems} item${totalItems === 1 ? "" : "s"} · Exported ${generatedOn}`;
  subCell.font = { name: "Calibri", size: 10, color: { argb: "FFFFFFFF" }, italic: true };
  subCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  ws.getRow(2).height = 18;

  // Column header (row 3).
  const headerRow = ws.getRow(3);
  HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  });
  headerRow.height = 22;

  const widths = HEADERS.map((h) => h.length);
  const nowStr = new Date().toISOString().slice(0, 19);
  let r = 4;

  for (const sprint of sprints) {
    const started = !!sprint.startedAt;
    const rollup = sprint.rollup;
    const pct = rollup.committed > 0 ? Math.round((rollup.committedDone / rollup.committed) * 100) : 0;

    // Sprint section header.
    ws.mergeCells(r, 1, r, colCount);
    const gc = ws.getCell(r, 1);
    gc.value = `${sprint.name}   —   ${sprint.startDate} → ${sprint.endDate}   ·   ${phaseLabel(sprint)}${sprint.goal ? `   ·   Goal: ${sprint.goal}` : ""}`;
    gc.font = { name: "Calibri", size: 11, bold: true, color: { argb: TEAL_DARK } };
    gc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    gc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F7F4" } };
    gc.border = { top: { style: "thin", color: { argb: TEAL } } };
    ws.getRow(r).height = 20;
    r++;

    // The sprint-report metrics line — the same numbers the card shows.
    ws.mergeCells(r, 1, r, colCount);
    const mc = ws.getCell(r, 1);
    mc.value = started
      ? `Committed ${rollup.committed} · Completed ${rollup.committedDone} of ${rollup.committed} (${pct}%) · Added after start ${rollup.addedAfterStart} · Removed ${rollup.removed} · Carried in ${rollup.carriedOver} · Overall done ${rollup.done}/${rollup.total}`
      : `${rollup.total} issue${rollup.total === 1 ? "" : "s"} planned — commitment locks when the sprint starts`;
    mc.font = { name: "Calibri", size: 10, italic: true, color: { argb: MUTED } };
    mc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(r).height = 16;
    r++;

    const writeItem = (item: SprintItemRow, idx: number, removed: boolean) => {
      const row = ws.getRow(r);
      const zebra = idx % 2 === 1;
      const scope = removed
        ? `Removed${item.removedAt ? ` ${item.removedAt.slice(0, 10)}` : ""}${item.removedByName ? ` by ${item.removedByName}` : ""}`
        : scopeLabel(item, started);

      // The scope-change reason: removal reason for removed rows, the
      // required added-mid-sprint reason for uncommitted rows — the "no
      // silent scope change" rule, visible in the report.
      const reason = removed ? (item.removedComment ?? "") : !item.committed && started ? (item.addedComment ?? "") : "";

      const risk = removed ? "" : riskLabel(item, nowStr);

      const values: [string, string][] = [
        ["jiraKey", item.jiraKey],
        ["summary", item.summary],
        ["status", item.jiraStatus],
        ["risk", risk],
        ["priority", item.priority ?? ""],
        ["assignee", item.assigneeName ?? ""],
        ["startDate", item.startDate ?? ""],
        ["dueDate", item.dueDate ?? ""],
        ["actualStart", formatActualDateTime(item.actualStart)],
        ["actualEnd", formatActualDateTime(item.actualEnd)],
        ["scope", scope],
        ["reason", reason],
        ["addedOn", item.addedAt.slice(0, 10)],
        ["addedBy", item.addedByName ?? ""],
      ];

      values.forEach(([key, display], ci) => {
        const cell = row.getCell(ci + 1);
        if (key === "jiraKey") {
          const url = `${item.jiraBaseUrl.replace(/\/$/, "")}/browse/${item.jiraKey}`;
          cell.value = { text: display, hyperlink: url };
          cell.font = {
            name: "Calibri",
            size: 11,
            color: { argb: removed ? MUTED : TEAL_DARK },
            underline: true,
            bold: !removed,
            strike: removed,
          };
        } else {
          cell.value = display;
          cell.font = {
            name: "Calibri",
            size: key === "scope" || key === "reason" ? 10 : 11,
            color: {
              argb:
                key === "reason"
                  ? MUTED
                  : removed
                    ? MUTED
                    : key === "risk"
                      ? risk === "Overdue"
                        ? RED
                        : risk === "At risk"
                          ? AMBER
                          : MUTED
                      : key === "scope" && scope.startsWith("Added after start")
                        ? AMBER
                        : TEXT,
            },
            strike: removed && key !== "reason",
          };
        }
        cell.alignment = {
          vertical: "top",
          horizontal: "left",
          indent: 1,
          wrapText: key === "summary" || key === "reason",
        };
        cell.border = {
          bottom: { style: "hair", color: { argb: BORDER } },
          right: { style: "hair", color: { argb: BORDER } },
        };
        if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
        if (display && key !== "summary" && key !== "reason") widths[ci] = Math.max(widths[ci], display.length);
      });
      r++;
    };

    sprint.items.forEach((item, idx) => writeItem(item, idx, false));
    sprint.removedItems.forEach((item, idx) => writeItem(item, sprint.items.length + idx, true));
  }

  HEADERS.forEach((h, i) => {
    if (h === "Summary") ws.getColumn(i + 1).width = 44;
    else if (h === "Reason") ws.getColumn(i + 1).width = 36;
    else ws.getColumn(i + 1).width = Math.min(34, Math.max(h.length, widths[i]) + 3);
  });

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

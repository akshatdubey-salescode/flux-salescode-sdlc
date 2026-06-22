import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth/server";
import {
  buildOwnerSummaries,
  ENV_UNSET,
  type BugRow,
  type OwnerSummary,
} from "@/lib/bug-summary";

type ExportBody = {
  rows: BugRow[];
  title?: string;
  showProject?: boolean;
  /** "developer" exports only the developer-wise rollup sheet. */
  scope?: ExportScope;
  start?: string;
  end?: string;
  excludeInvalid?: boolean;
  environment?: string | null;
};

type ExportScope = "all" | "developer";

export async function POST(req: NextRequest) {
  await requireAuth();

  let body: ExportBody;
  try {
    body = (await req.json()) as ExportBody;
  } catch {
    return new Response("Invalid body", { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  const opts: Opts = {
    title: body.title?.trim() || "Bugs",
    showProject: body.showProject === true,
    scope: body.scope === "developer" ? "developer" : "all",
    start: body.start ?? "",
    end: body.end ?? "",
    excludeInvalid: body.excludeInvalid !== false,
    environment: body.environment ?? null,
  };
  const buffer = await buildWorkbook(rows, opts);

  const safeName = opts.title.replace(/[^\w-]+/g, "_");
  const tag = opts.scope === "developer" ? "developer-bugs" : "bugs";
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}-${tag}-${opts.end}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

// ---- Workbook styling (matches the My Tasks export) -------------------------

const TEAL = "FF0D9488";
const TEAL_DARK = "FF0F766E";
const ZEBRA = "FFF0FDFA";
const BORDER = "FFE5E7EB";
const TEXT = "FF111827";
const MUTED = "FF6B7280";

function priorityColor(priority: string | null): string | null {
  const p = (priority ?? "").toLowerCase().trim();
  if (p === "p0") return "FF7F1D1D"; // deep red
  if (p === "p1" || p === "highest" || p === "blocker" || p === "critical") return "FFB91C1C"; // red
  if (p === "p2" || p === "high" || p === "major") return "FFC2410C"; // orange
  if (p === "p3" || p === "medium" || p === "moderate") return "FFB45309"; // amber
  if (p === "p4" || p === "low" || p === "lowest" || p === "minor") return "FF047857"; // green
  return null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

type Opts = {
  title: string;
  showProject: boolean;
  scope: ExportScope;
  start: string;
  end: string;
  excludeInvalid: boolean;
  environment: string | null;
};

async function buildWorkbook(rows: BugRow[], opts: Opts): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flux";
  wb.created = new Date();

  // "developer" scope = the Developer-wise Bug Count table only; "all" also
  // includes the detailed bug list sheet.
  if (opts.scope !== "developer") addBugsSheet(wb, rows, opts);
  addDeveloperSheet(wb, buildOwnerSummaries(rows), opts);

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

// ---- Sheet 1: the filtered bug list -----------------------------------------

type BugColKey =
  | keyof BugRow
  | "createdAt"
  | "updatedAt"
  | "open"
  | "project";

type BugCol = { header: string; key: BugColKey; width?: number; min: number; max: number };

function bugColumns(showProject: boolean): BugCol[] {
  const cols: BugCol[] = [
    { header: "Jira Key", key: "jiraKey", min: 10, max: 16 },
  ];
  if (showProject) cols.push({ header: "Project", key: "project", min: 14, max: 30 });
  cols.push(
    { header: "Summary", key: "summary", width: 50, min: 30, max: 60 },
    { header: "Owner", key: "ownerName", min: 14, max: 28 },
    { header: "Owner Email", key: "ownerEmail", min: 18, max: 36 },
    { header: "Priority", key: "priority", min: 8, max: 12 },
    { header: "Environment", key: "environment", min: 11, max: 16 },
    { header: "Status", key: "status", min: 12, max: 26 },
    { header: "Open", key: "open", min: 6, max: 8 },
    { header: "Created", key: "createdAt", min: 12, max: 14 },
    { header: "Updated", key: "updatedAt", min: 12, max: 14 }
  );
  return cols;
}

function subtitle(rows: BugRow[], opts: Opts): string {
  const parts = [`${rows.length} bug${rows.length === 1 ? "" : "s"}`];
  if (opts.start && opts.end) parts.push(`Raised ${fmtDate(opts.start)} – ${fmtDate(opts.end)}`);
  if (opts.environment) parts.push(`Env: ${opts.environment}`);
  if (opts.excludeInvalid) parts.push("excl. Not-a-bug / Can't Reproduce");
  const generatedOn = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  parts.push(`Exported ${generatedOn}`);
  return parts.join(" · ");
}

function bannerRows(ws: ExcelJS.Worksheet, colCount: number, title: string, sub: string) {
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_DARK } };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, colCount);
  const subCell = ws.getCell(2, 1);
  subCell.value = sub;
  subCell.font = { name: "Calibri", size: 10, color: { argb: "FFFFFFFF" }, italic: true };
  subCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  ws.getRow(2).height = 18;
}

function headerRow(ws: ExcelJS.Worksheet, headers: string[]) {
  const row = ws.getRow(3);
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    cell.border = {
      top: { style: "thin", color: { argb: TEAL } },
      bottom: { style: "thin", color: { argb: TEAL } },
      left: { style: "thin", color: { argb: TEAL } },
      right: { style: "thin", color: { argb: TEAL } },
    };
  });
  row.height = 22;
}

function addBugsSheet(wb: ExcelJS.Workbook, rows: BugRow[], opts: Opts) {
  const columns = bugColumns(opts.showProject);
  const ws = wb.addWorksheet("Bugs", { views: [{ state: "frozen", ySplit: 3 }] });
  const colCount = columns.length;

  bannerRows(ws, colCount, `Bug Summary — ${opts.title}`, subtitle(rows, opts));
  headerRow(ws, columns.map((c) => c.header));

  const widths = columns.map((c) => c.header.length);

  rows.forEach((bug, idx) => {
    const row = ws.getRow(idx + 4);
    const zebra = idx % 2 === 1;

    columns.forEach((col, ci) => {
      const cell = row.getCell(ci + 1);
      let display = "";

      switch (col.key) {
        case "jiraKey": {
          const url =
            bug.jiraBaseUrl && bug.jiraKey
              ? `${bug.jiraBaseUrl.replace(/\/$/, "")}/browse/${bug.jiraKey}`
              : null;
          display = bug.jiraKey ?? "";
          if (url) {
            cell.value = { text: display, hyperlink: url };
            cell.font = { name: "Calibri", size: 11, color: { argb: TEAL_DARK }, underline: true, bold: true };
          } else {
            cell.value = display;
            cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: TEXT } };
          }
          break;
        }
        case "project": {
          display = bug.projectName || bug.projectKey;
          cell.value = display;
          cell.font = { name: "Calibri", size: 10, color: { argb: TEXT } };
          break;
        }
        case "priority": {
          display = bug.priority ?? "";
          cell.value = display;
          const color = priorityColor(bug.priority);
          cell.font = { name: "Calibri", size: 11, bold: !!color, color: { argb: color ?? TEXT } };
          break;
        }
        case "open": {
          display = bug.isOpen ? "Open" : "Closed";
          cell.value = display;
          cell.font = {
            name: "Calibri",
            size: 11,
            bold: bug.isOpen,
            color: { argb: bug.isOpen ? "FFB45309" : MUTED },
          };
          break;
        }
        case "environment": {
          display = bug.environment === ENV_UNSET ? "" : bug.environment;
          cell.value = display;
          cell.font = { name: "Calibri", size: 11, color: { argb: TEXT } };
          break;
        }
        case "ownerEmail": {
          display = bug.ownerEmail ?? "";
          cell.value = display;
          cell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
          break;
        }
        case "createdAt":
        case "updatedAt": {
          const iso = col.key === "createdAt" ? bug.jiraCreatedAt : bug.jiraUpdatedAt;
          display = fmtDate(iso);
          cell.value = display;
          cell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
          break;
        }
        default: {
          display = ((bug[col.key as keyof BugRow] as string | null) ?? "").toString();
          cell.value = display;
          cell.font = { name: "Calibri", size: 11, color: { argb: TEXT } };
        }
      }

      cell.alignment = {
        vertical: "top",
        horizontal: "left",
        indent: 1,
        wrapText: col.key === "summary",
      };
      cell.border = {
        bottom: { style: "hair", color: { argb: BORDER } },
        right: { style: "hair", color: { argb: BORDER } },
      };
      if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };

      if (display && col.key !== "summary") widths[ci] = Math.max(widths[ci], display.length);
    });
  });

  columns.forEach((col, i) => {
    const measured = col.key === "summary" ? (col.width ?? 50) : widths[i] + 3;
    ws.getColumn(i + 1).width = Math.min(col.max, Math.max(col.min, measured));
  });

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colCount } };
}

// ---- Sheet 2: developer-wise rollup -----------------------------------------

const DEV_HEADERS = ["Developer", "P1", "P2", "P3", "Other", "Total", "Open"];

function addDeveloperSheet(wb: ExcelJS.Workbook, summaries: OwnerSummary[], opts: Opts) {
  const ws = wb.addWorksheet("By Developer", { views: [{ state: "frozen", ySplit: 3 }] });
  const colCount = DEV_HEADERS.length;

  bannerRows(
    ws,
    colCount,
    `Developer-wise Bug Count — ${opts.title}`,
    `${summaries.length} developer${summaries.length === 1 ? "" : "s"} · owner = Issue Owner, falling back to Assignee`
  );
  headerRow(ws, DEV_HEADERS);

  const totals = { p1: 0, p2: 0, p3: 0, other: 0, total: 0, open: 0 };

  summaries.forEach((s, idx) => {
    const row = ws.getRow(idx + 4);
    const zebra = idx % 2 === 1;
    const values = [s.ownerName, s.p1, s.p2, s.p3, s.other, s.total, s.open];

    values.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      const isName = ci === 0;
      const isTotal = ci === 5;
      cell.font = {
        name: "Calibri",
        size: 11,
        bold: isName || isTotal,
        color: { argb: isTotal ? "FFB91C1C" : isName ? TEXT : MUTED },
      };
      cell.alignment = { vertical: "middle", horizontal: isName ? "left" : "center", indent: isName ? 1 : 0 };
      cell.border = {
        bottom: { style: "hair", color: { argb: BORDER } },
        right: { style: "hair", color: { argb: BORDER } },
      };
      if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
    });

    totals.p1 += s.p1;
    totals.p2 += s.p2;
    totals.p3 += s.p3;
    totals.other += s.other;
    totals.total += s.total;
    totals.open += s.open;
  });

  const totalRow = ws.getRow(summaries.length + 4);
  const totalValues = ["Total", totals.p1, totals.p2, totals.p3, totals.other, totals.total, totals.open];
  totalValues.forEach((v, ci) => {
    const cell = totalRow.getCell(ci + 1);
    cell.value = v;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: TEXT } };
    cell.alignment = { vertical: "middle", horizontal: ci === 0 ? "left" : "center", indent: ci === 0 ? 1 : 0 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F7F4" } };
    cell.border = { top: { style: "thin", color: { argb: TEAL } } };
  });

  ws.getColumn(1).width = 28;
  for (let c = 2; c <= colCount; c++) ws.getColumn(c).width = 10;
}

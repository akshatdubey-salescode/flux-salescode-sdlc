// Reading an uploaded workbook and writing the per-round snapshot. Only the
// chosen tab is ever kept: the team's workbooks hold many features, and a
// snapshot for one issue must not carry (and re-expose) the others.

import ExcelJS from "exceljs";
import { cellText } from "./template";

/** Keep well under Vercel's 4.5MB request limit; a Google Sheet link has no such limit. */
export const MAX_XLSX_BYTES = 4 * 1024 * 1024;

/** xlsx is a zip archive: "PK\x03\x04". */
export function looksLikeXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

export async function loadWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS types predate Node's Buffer generics; the runtime accepts a Buffer.
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

export function xlsxTabs(wb: ExcelJS.Workbook): { title: string; hidden: boolean }[] {
  return wb.worksheets.map((ws) => ({ title: ws.name, hidden: ws.state !== "visible" }));
}

export function xlsxTabGrid(wb: ExcelJS.Workbook, title: string): unknown[][] {
  const ws = wb.getWorksheet(title);
  if (!ws) return [];
  const grid: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    // row.values is 1-based (index 0 is unused).
    grid[n - 1] = (row.values as unknown[]).slice(1);
  });
  return grid;
}

/** Drop trailing blank rows and columns (sheets are padded to ~1000 empty rows). */
export function trimGrid(grid: unknown[][]): string[][] {
  const text = grid.map((r) => (r ?? []).map(cellText));
  let lastRow = text.length - 1;
  while (lastRow >= 0 && text[lastRow].every((c) => c === "")) lastRow--;
  const rows = text.slice(0, lastRow + 1);
  let width = 0;
  for (const r of rows) {
    for (let c = r.length - 1; c >= 0; c--) {
      if (r[c] !== "") {
        width = Math.max(width, c + 1);
        break;
      }
    }
  }
  return rows.map((r) => Array.from({ length: width }, (_, c) => r[c] ?? ""));
}

/** Excel sheet names: max 31 chars, none of \ / ? * [ ] : */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
  return cleaned || "Test Cases";
}

/** A fresh single-tab workbook holding exactly the committed values. */
export async function buildSnapshotXlsx(args: {
  tabTitle: string;
  grid: unknown[][];
  /** 1-based header row inside the grid. */
  headerRow: number;
}): Promise<Buffer> {
  const rows = trimGrid(args.grid);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flux";
  wb.created = new Date();
  const ws = wb.addWorksheet(safeSheetName(args.tabTitle), {
    views: [{ state: "frozen", ySplit: args.headerRow }],
  });

  rows.forEach((r) => ws.addRow(r));

  const widths = rows[0]?.map((_, c) =>
    Math.min(60, Math.max(10, ...rows.slice(0, 200).map((r) => Math.min(60, (r[c] ?? "").split("\n")[0].length)))),
  );
  widths?.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.eachRow((row, n) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
    if (n === args.headerRow) {
      row.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      });
    }
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

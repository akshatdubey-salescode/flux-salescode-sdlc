import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth/server";
import { deliveryStatusLabel } from "@/lib/deliveries/status";
import type { DeliveryItemRow } from "@/lib/deliveries/entries";

// Row filters (search/date range/item-status/show-completed) all happen
// client-side in delivery-tracker-tab.tsx — there's no server-side query to
// re-run with the same filters the way project-tracking's export does. So
// the client sends its own already-filtered `filteredDeliveries` straight
// through, same as the Bug Board export (rows-in-body, not query-params).

type ExportDelivery = { name: string; deliveryDate: string; items: DeliveryItemRow[] };
type ExportBody = { deliveries: ExportDelivery[] };

// ---- Theme (matches the Bug Board / My Tasks export exactly) --------------

const TEAL = "FF0D9488";
const TEAL_DARK = "FF0F766E";
const ZEBRA = "FFF0FDFA";
const BORDER = "FFE5E7EB";
const TEXT = "FF111827";
const MUTED = "FF6B7280";

export async function POST(req: NextRequest) {
  await requireAuth();

  let body: ExportBody;
  try {
    body = (await req.json()) as ExportBody;
  } catch {
    return new Response("Invalid body", { status: 400 });
  }

  const deliveries = Array.isArray(body.deliveries) ? body.deliveries : [];
  const buffer = await buildWorkbook(deliveries);

  const generatedOn = new Date().toISOString().split("T")[0];
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="deliveries-${generatedOn}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
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

// Fixed regardless of the on-screen column-visibility toggle — that's a
// purely client-side preference, not something the export should ever honor.
const HEADERS = ["Jira Key", "Summary", "Status", "Priority", "Assignee", "Delivery Status", "Start Date", "End Date", "Actual Start", "Actual End", "Comment"];

async function buildWorkbook(deliveries: ExportDelivery[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flux";
  wb.created = new Date();

  const ws = wb.addWorksheet("Deliveries", { views: [{ state: "frozen", ySplit: 3 }] });
  const colCount = HEADERS.length;

  const totalItems = deliveries.reduce((n, d) => n + d.items.length, 0);
  const generatedOn = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  bannerRows(
    ws,
    colCount,
    "Deliveries — Filtered Export",
    `${deliveries.length} deliver${deliveries.length === 1 ? "y" : "ies"} · ${totalItems} item${totalItems === 1 ? "" : "s"} · Exported ${generatedOn}`
  );
  headerRow(ws, HEADERS);

  const widths = HEADERS.map((h) => h.length);
  let r = 4; // first body row (banner rows 1–2, header row 3)

  for (const delivery of deliveries) {
    // Section header, one per delivery — mirrors the Bug Board export's
    // per-developer sections, since deliveries are already grouped this way
    // on screen.
    ws.mergeCells(r, 1, r, colCount);
    const gc = ws.getCell(r, 1);
    gc.value = `${delivery.name}   —   ${delivery.deliveryDate}   ·   ${delivery.items.length} item${delivery.items.length === 1 ? "" : "s"}`;
    gc.font = { name: "Calibri", size: 11, bold: true, color: { argb: TEAL_DARK } };
    gc.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    gc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F7F4" } };
    gc.border = { top: { style: "thin", color: { argb: TEAL } } };
    ws.getRow(r).height = 20;
    r++;

    delivery.items.forEach((item, idx) => {
      const row = ws.getRow(r);
      const zebra = idx % 2 === 1;

      const values: [string, unknown][] = [
        ["jiraKey", item.jiraKey],
        ["summary", item.summary],
        ["jiraStatus", item.jiraStatus],
        ["priority", item.priority ?? ""],
        ["assignee", item.assigneeName ?? ""],
        ["delivery", deliveryStatusLabel(item.status)],
        ["startDate", item.startDate ?? ""],
        ["dueDate", item.dueDate ?? ""],
        ["actualStart", item.actualStart ?? ""],
        ["actualEnd", item.actualEnd ?? ""],
        ["comment", item.statusComment ?? ""],
      ];

      values.forEach(([key, value], ci) => {
        const cell = row.getCell(ci + 1);
        const display = String(value ?? "");

        if (key === "jiraKey") {
          const url = `${item.jiraBaseUrl.replace(/\/$/, "")}/browse/${item.jiraKey}`;
          cell.value = { text: display, hyperlink: url };
          cell.font = { name: "Calibri", size: 11, color: { argb: TEAL_DARK }, underline: true, bold: true };
        } else if (key === "comment") {
          cell.value = display;
          cell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
        } else {
          cell.value = display;
          cell.font = { name: "Calibri", size: 11, color: { argb: TEXT } };
        }

        cell.alignment = {
          vertical: "top",
          horizontal: "left",
          indent: 1,
          wrapText: key === "summary" || key === "comment",
        };
        cell.border = {
          bottom: { style: "hair", color: { argb: BORDER } },
          right: { style: "hair", color: { argb: BORDER } },
        };
        if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };

        if (display && key !== "summary" && key !== "comment") {
          widths[ci] = Math.max(widths[ci], display.length);
        }
      });
      r++;
    });
  }

  HEADERS.forEach((h, i) => {
    const isWrap = h === "Summary" || h === "Comment";
    ws.getColumn(i + 1).width = isWrap ? 40 : Math.min(30, Math.max(h.length, widths[i]) + 3);
  });

  // No autoFilter: sectioned by delivery (merged group rows between the
  // data), same reasoning as the Bug Board export's dev-wise detail sheet.

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

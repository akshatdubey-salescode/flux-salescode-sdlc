import {
  and, or, eq, ilike, sql, isNull, isNotNull,
  desc, asc, gte, lt, gt, not, inArray, getTableColumns,
  type SQL,
} from "drizzle-orm";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { freshdeskTickets, jiraIssues, jiraProjects } from "@/lib/db/schema";
import { adfToText } from "@/lib/adf-to-text";

// Excel export of the Freshdesk client-issue tracker. Mirrors the filter/sort
// logic of GET /api/freshdesk/tickets/[projectId] so the workbook matches what
// the table is showing, and additionally includes the Freshdesk ticket body and
// the linked Jira issue's description.
export async function GET(
  req: Request,
  props: { params: Promise<{ projectId: string }> }
) {
  await requireAuth();
  const { projectId } = await props.params;
  const sp = new URL(req.url).searchParams;

  const search = sp.get("search") ?? "";
  const fdStatus = sp.get("fdStatus") ?? "";
  const fdPriority = sp.get("fdPriority") ?? "";
  const ticketType = sp.get("ticketType") ?? "";
  const jiraLink = sp.get("jiraLink") ?? "all";
  const jiraStatus = sp.get("jiraStatus") ?? "";
  const jiraAssignee = sp.get("jiraAssignee") ?? "";
  const jiraPriority = sp.get("jiraPriority") ?? "";
  const sla = sp.get("sla") ?? "all";
  const escalated = sp.get("escalated") ?? "";
  const sort = sp.get("sort") ?? "newest";
  const dateRange = sp.get("dateRange") ?? "all";

  const [project] = await db
    .select({ jiraBaseUrl: jiraProjects.jiraBaseUrl })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId))
    .limit(1);

  // Build WHERE conditions (kept in lockstep with the tickets route)
  const conditions: (SQL | undefined)[] = [eq(freshdeskTickets.projectId, projectId)];

  if (dateRange !== "all") {
    const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
    conditions.push(gte(freshdeskTickets.fdCreatedAt, new Date(Date.now() - days * 86_400_000)));
  }

  if (search) {
    conditions.push(
      or(
        ilike(freshdeskTickets.subject, `%${search}%`),
        sql`${freshdeskTickets.fdTicketId}::text like ${`%${search}%`}`
      )
    );
  }

  if (fdStatus) conditions.push(eq(freshdeskTickets.fdStatus, parseInt(fdStatus, 10)));
  if (fdPriority) conditions.push(eq(freshdeskTickets.fdPriority, parseInt(fdPriority, 10)));
  if (ticketType) conditions.push(eq(freshdeskTickets.ticketType, ticketType));

  if (jiraLink === "linked") conditions.push(isNotNull(freshdeskTickets.linkedJiraKey));
  else if (jiraLink === "unlinked") conditions.push(isNull(freshdeskTickets.linkedJiraKey));

  if (jiraStatus) conditions.push(eq(freshdeskTickets.linkedJiraStatus, jiraStatus));
  if (jiraAssignee) conditions.push(eq(freshdeskTickets.linkedJiraAssigneeName, jiraAssignee));
  if (jiraPriority) conditions.push(eq(jiraIssues.priority, jiraPriority));

  if (sla === "breached") {
    conditions.push(
      and(
        isNotNull(freshdeskTickets.dueBy),
        lt(freshdeskTickets.dueBy, new Date()),
        not(inArray(freshdeskTickets.fdStatus, [4, 5]))
      )
    );
  } else if (sla === "at_risk") {
    const now = new Date();
    const fourHoursFromNow = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    conditions.push(
      and(
        isNotNull(freshdeskTickets.dueBy),
        gt(freshdeskTickets.dueBy, now),
        lt(freshdeskTickets.dueBy, fourHoursFromNow),
        not(inArray(freshdeskTickets.fdStatus, [4, 5]))
      )
    );
  }

  if (escalated === "yes") conditions.push(eq(freshdeskTickets.isEscalated, true));

  const whereClause = and(...conditions);

  const orderBy =
    sort === "oldest"   ? asc(freshdeskTickets.fdCreatedAt) :
    sort === "priority" ? desc(freshdeskTickets.fdPriority) :
    sort === "days"     ? asc(freshdeskTickets.fdCreatedAt) :
    sort === "response" ? sql`(${jiraIssues.jiraCreatedAt} - ${freshdeskTickets.fdCreatedAt}) desc nulls last` :
    desc(freshdeskTickets.fdCreatedAt);

  const rows = await db
    .select({
      ...getTableColumns(freshdeskTickets),
      jiraCreatedAt: jiraIssues.jiraCreatedAt,
      jiraPriority: jiraIssues.priority,
      jiraDescription: jiraIssues.description,
    })
    .from(freshdeskTickets)
    .leftJoin(jiraIssues, eq(freshdeskTickets.linkedJiraIssueId, jiraIssues.id))
    .where(whereClause)
    .orderBy(orderBy)
    .limit(10000);

  const buffer = await buildWorkbook(rows, project?.jiraBaseUrl ?? null);

  const today = new Date().toISOString().split("T")[0];
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="freshdesk-tickets-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

// ---- derived fields (mirror of the client-side helpers) ---------------------

type TicketRow = typeof freshdeskTickets.$inferSelect & {
  jiraCreatedAt: Date | null;
  jiraPriority: string | null;
  jiraDescription: string | null;
};

function daysOpen(createdAt: Date | null): number {
  if (!createdAt) return 0;
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
}

function responseDays(fdCreatedAt: Date | null, jiraCreatedAt: Date | null): number | null {
  if (!fdCreatedAt || !jiraCreatedAt) return null;
  return Math.max(0, Math.floor(
    (new Date(jiraCreatedAt).getTime() - new Date(fdCreatedAt).getTime()) / 86_400_000
  ));
}

function slaLabel(t: TicketRow): string {
  if (t.dueBy) {
    const due = new Date(t.dueBy).getTime();
    const isClosed = t.fdStatus === 4 || t.fdStatus === 5;
    if (due < Date.now() && !isClosed) return "Breached";
    const msLeft = due - Date.now();
    if (msLeft > 0 && msLeft < 4 * 60 * 60 * 1000) return "At Risk";
  }
  if (t.fdStatus === 4 || t.fdStatus === 5) return "OK";
  return "";
}

// ---- Workbook styling (shared palette with the my-tasks export) -------------

const TEAL = "FF0D9488";
const TEAL_DARK = "FF0F766E";
const ZEBRA = "FFF0FDFA";
const BORDER = "FFE5E7EB";
const TEXT = "FF111827";
const MUTED = "FF6B7280";

type ColKey =
  | "ticket" | "subject" | "fdDescription" | "fdStatus" | "priority" | "type"
  | "requester" | "requesterEmail" | "fdCreated"
  | "jiraKey" | "jiraStatus" | "jiraAssignee" | "jiraPriority" | "jiraCreated"
  | "jiraDescription" | "response" | "daysOpen" | "sla";

const COLUMNS: { header: string; key: ColKey; width: number; min: number; max: number }[] = [
  { header: "FD Ticket", key: "ticket", width: 11, min: 9, max: 14 },
  { header: "Subject", key: "subject", width: 44, min: 24, max: 60 },
  { header: "FD Description", key: "fdDescription", width: 60, min: 30, max: 80 },
  { header: "FD Status", key: "fdStatus", width: 14, min: 10, max: 20 },
  { header: "Priority", key: "priority", width: 10, min: 8, max: 12 },
  { header: "Type", key: "type", width: 16, min: 10, max: 24 },
  { header: "Requester", key: "requester", width: 20, min: 14, max: 28 },
  { header: "Requester Email", key: "requesterEmail", width: 28, min: 18, max: 36 },
  { header: "FD Created", key: "fdCreated", width: 13, min: 12, max: 16 },
  { header: "Jira Key", key: "jiraKey", width: 12, min: 10, max: 16 },
  { header: "Jira Status", key: "jiraStatus", width: 14, min: 10, max: 22 },
  { header: "Jira Assignee", key: "jiraAssignee", width: 20, min: 14, max: 28 },
  { header: "Jira Priority", key: "jiraPriority", width: 12, min: 8, max: 14 },
  { header: "Jira Created", key: "jiraCreated", width: 13, min: 12, max: 16 },
  { header: "Jira Description", key: "jiraDescription", width: 60, min: 30, max: 80 },
  { header: "Response (days)", key: "response", width: 14, min: 10, max: 16 },
  { header: "Days Open", key: "daysOpen", width: 11, min: 9, max: 14 },
  { header: "SLA", key: "sla", width: 11, min: 8, max: 14 },
];

const WRAP_COLS = new Set<ColKey>(["subject", "fdDescription", "jiraDescription"]);

const fdBaseUrl = process.env.NEXT_PUBLIC_FRESHDESK_BASE_URL?.replace(/\/$/, "")
  ?? process.env.FRESHDESK_BASE_URL?.replace(/\/$/, "")
  ?? null;

async function buildWorkbook(rows: TicketRow[], jiraBaseUrl: string | null): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flux";
  wb.created = new Date();

  const ws = wb.addWorksheet("Freshdesk Tickets", {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  const colCount = COLUMNS.length;

  // Title banner (rows 1-2)
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = "Freshdesk Tickets";
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_DARK } };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, colCount);
  const subCell = ws.getCell(2, 1);
  const generatedOn = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
  subCell.value = `${rows.length} ticket${rows.length === 1 ? "" : "s"} · Exported ${generatedOn}`;
  subCell.font = { name: "Calibri", size: 10, color: { argb: "FFFFFFFF" }, italic: true };
  subCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  ws.getRow(2).height = 18;

  // Header row (row 3)
  const headerRow = ws.getRow(3);
  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
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
  headerRow.height = 22;

  const widths = COLUMNS.map((c) => c.header.length);

  rows.forEach((t, idx) => {
    const row = ws.getRow(idx + 4);
    const zebra = idx % 2 === 1;

    COLUMNS.forEach((col, ci) => {
      const cell = row.getCell(ci + 1);
      let display = "";
      cell.font = { name: "Calibri", size: 11, color: { argb: TEXT } };

      switch (col.key) {
        case "ticket": {
          display = `#${t.fdTicketId}`;
          const url = fdBaseUrl ? `${fdBaseUrl}/a/tickets/${t.fdTicketId}` : null;
          if (url) {
            cell.value = { text: display, hyperlink: url };
            cell.font = { name: "Calibri", size: 11, color: { argb: TEAL_DARK }, underline: true, bold: true };
          } else {
            cell.value = display;
            cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: TEXT } };
          }
          break;
        }
        case "subject":
          display = t.subject ?? "";
          cell.value = display;
          break;
        case "fdDescription":
          display = t.description ?? "";
          cell.value = display;
          cell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
          break;
        case "fdStatus":
          display = t.fdStatusLabel ?? "";
          cell.value = display;
          break;
        case "priority":
          display = t.fdPriorityLabel ?? "";
          cell.value = display;
          break;
        case "type":
          display = t.ticketType ?? "";
          cell.value = display;
          break;
        case "requester":
          display = t.requesterName ?? "";
          cell.value = display;
          break;
        case "requesterEmail":
          display = t.requesterEmail ?? "";
          cell.value = display;
          cell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
          break;
        case "fdCreated":
          if (t.fdCreatedAt) {
            cell.value = new Date(t.fdCreatedAt);
            cell.numFmt = "dd MMM yyyy";
          } else cell.value = "";
          cell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
          break;
        case "jiraKey": {
          display = t.linkedJiraKey ?? "";
          const url = jiraBaseUrl && t.linkedJiraKey ? `${jiraBaseUrl}/browse/${t.linkedJiraKey}` : null;
          if (url) {
            cell.value = { text: display, hyperlink: url };
            cell.font = { name: "Calibri", size: 11, color: { argb: TEAL_DARK }, underline: true, bold: true };
          } else {
            cell.value = display;
          }
          break;
        }
        case "jiraStatus":
          display = t.linkedJiraStatus ?? "";
          cell.value = display;
          break;
        case "jiraAssignee":
          display = t.linkedJiraAssigneeName ?? "";
          cell.value = display;
          break;
        case "jiraPriority":
          display = t.jiraPriority ?? "";
          cell.value = display;
          break;
        case "jiraCreated":
          if (t.jiraCreatedAt) {
            cell.value = new Date(t.jiraCreatedAt);
            cell.numFmt = "dd MMM yyyy";
          } else cell.value = "";
          cell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
          break;
        case "jiraDescription":
          display = adfToText(t.jiraDescription);
          cell.value = display;
          cell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
          break;
        case "response": {
          const r = responseDays(t.fdCreatedAt, t.jiraCreatedAt);
          cell.value = r ?? "";
          display = r !== null ? String(r) : "";
          break;
        }
        case "daysOpen": {
          const d = daysOpen(t.fdCreatedAt);
          cell.value = d;
          display = String(d);
          break;
        }
        case "sla":
          display = slaLabel(t);
          cell.value = display;
          break;
      }

      cell.alignment = {
        vertical: "top",
        horizontal: "left",
        indent: 1,
        wrapText: WRAP_COLS.has(col.key),
      };
      cell.border = {
        bottom: { style: "hair", color: { argb: BORDER } },
        right: { style: "hair", color: { argb: BORDER } },
      };
      if (zebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      }

      // Measure width from the first line only; wrapped columns use their default.
      if (display && !WRAP_COLS.has(col.key)) {
        widths[ci] = Math.max(widths[ci], display.length);
      }
    });
  });

  COLUMNS.forEach((col, i) => {
    const measured = WRAP_COLS.has(col.key) ? col.width : widths[i] + 3;
    ws.getColumn(i + 1).width = Math.min(col.max, Math.max(col.min, measured));
  });

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colCount } };

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

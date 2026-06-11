import type { NextRequest } from "next/server";
import {
  eq,
  and,
  or,
  ilike,
  desc,
  asc,
  inArray,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { hasStartDateSql, hasDueDateSql } from "@/lib/jira/planned-sql";

export async function GET(req: NextRequest) {
  const user = await requireAuth();

  const { searchParams } = req.nextUrl;

  const forEmail = searchParams.get("forEmail")?.trim();
  const targetEmail = forEmail || user.email;

  const q = searchParams.get("q")?.trim() ?? "";
  const projectList = (searchParams.get("projects") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const statusList = (searchParams.get("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const priorityList = (searchParams.get("priority") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const reporterList = (searchParams.get("reporter") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const issueTypeList = (searchParams.get("issueType") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const labelsList = (searchParams.get("labels") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const showCompleted = searchParams.get("showCompleted") === "true";
  const includeReported = searchParams.get("includeReported") === "true";
  const unplannedOnly = searchParams.get("unplannedOnly") === "true";
  const sortBy = searchParams.get("sortBy") ?? "created";
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";

  const assigneeCondition = includeReported
    ? or(
        eq(jiraIssues.assigneeEmail, targetEmail),
        sql`${targetEmail} = ANY(${jiraIssues.additionalAssigneeEmails})`,
        eq(jiraIssues.reporterEmail, targetEmail)
      )!
    : or(
        eq(jiraIssues.assigneeEmail, targetEmail),
        sql`${targetEmail} = ANY(${jiraIssues.additionalAssigneeEmails})`
      )!;

  const conditions = [assigneeCondition];

  if (q) {
    const searchCondition = or(
      ilike(jiraIssues.jiraKey, `%${q}%`),
      ilike(jiraIssues.summary, `%${q}%`)
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  if (projectList.length) conditions.push(inArray(jiraIssues.projectId, projectList));
  if (statusList.length) conditions.push(inArray(jiraIssues.status, statusList));
  if (priorityList.length) conditions.push(inArray(jiraIssues.priority, priorityList));
  if (reporterList.length) conditions.push(inArray(jiraIssues.reporterEmail, reporterList));
  if (issueTypeList.length) conditions.push(inArray(jiraIssues.issueType, issueTypeList));

  if (labelsList.length) {
    const labelsCondition = or(...labelsList.map((label) => sql`${label} = ANY(${jiraIssues.labels})`));
    if (labelsCondition) conditions.push(labelsCondition);
  }

  if (dateFrom) conditions.push(gte(jiraIssues.jiraCreatedAt, new Date(dateFrom)));
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    conditions.push(lte(jiraIssues.jiraCreatedAt, to));
  }
  if (!showCompleted) {
    conditions.push(
      sql`LOWER(TRIM(${jiraIssues.statusCategory})) NOT IN ('done', 'complete')`
    );
  }
  if (unplannedOnly) {
    conditions.push(
      sql`NOT (${hasStartDateSql(
        jiraIssues.customFields,
        jiraProjects.startDateFieldIds
      )} AND ${hasDueDateSql(jiraIssues.customFields, jiraProjects.endDateFieldIds)})`
    );
  }

  const where = and(...conditions);

  const isAsc = sortDir === "asc";
  let orderExpr;
  switch (sortBy) {
    case "created":
      orderExpr = isAsc ? asc(jiraIssues.jiraCreatedAt) : desc(jiraIssues.jiraCreatedAt);
      break;
    case "priority":
      orderExpr = isAsc
        ? sql`CASE WHEN ${jiraIssues.priority} = 'Highest' THEN 1 WHEN ${jiraIssues.priority} = 'High' THEN 2 WHEN ${jiraIssues.priority} = 'Medium' THEN 3 WHEN ${jiraIssues.priority} = 'Low' THEN 4 WHEN ${jiraIssues.priority} = 'Lowest' THEN 5 ELSE 6 END ASC`
        : sql`CASE WHEN ${jiraIssues.priority} = 'Highest' THEN 1 WHEN ${jiraIssues.priority} = 'High' THEN 2 WHEN ${jiraIssues.priority} = 'Medium' THEN 3 WHEN ${jiraIssues.priority} = 'Low' THEN 4 WHEN ${jiraIssues.priority} = 'Lowest' THEN 5 ELSE 6 END DESC`;
      break;
    case "status":
      orderExpr = isAsc ? asc(jiraIssues.status) : desc(jiraIssues.status);
      break;
    default:
      orderExpr = isAsc ? asc(jiraIssues.jiraUpdatedAt) : desc(jiraIssues.jiraUpdatedAt);
  }

  const issues = await db
    .select({
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      status: jiraIssues.status,
      issueType: jiraIssues.issueType,
      priority: jiraIssues.priority,
      assigneeName: jiraIssues.assigneeName,
      assigneeEmail: jiraIssues.assigneeEmail,
      reporterName: jiraIssues.reporterName,
      reporterEmail: jiraIssues.reporterEmail,
      labels: jiraIssues.labels,
      jiraCreatedAt: jiraIssues.jiraCreatedAt,
      jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .where(where)
    .orderBy(orderExpr)
    .limit(5000);

  const buffer = await buildWorkbook(issues);

  const today = new Date().toISOString().split("T")[0];
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tasks-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

// ---- Workbook styling -------------------------------------------------------

interface IssueRow {
  jiraKey: string;
  summary: string;
  status: string;
  issueType: string;
  priority: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  reporterName: string | null;
  reporterEmail: string | null;
  labels: string[] | null;
  jiraCreatedAt: Date | null;
  jiraUpdatedAt: Date | null;
  jiraBaseUrl: string | null;
}

// Brand palette (ARGB — 8-digit hex, alpha first).
const TEAL = "FF0D9488";
const TEAL_DARK = "FF0F766E";
const ZEBRA = "FFF0FDFA";
const BORDER = "FFE5E7EB";
const TEXT = "FF111827";
const MUTED = "FF6B7280";

function priorityColor(priority: string | null): string | null {
  const p = (priority ?? "").toLowerCase();
  if (p === "p1" || p === "highest") return "FFB91C1C"; // red
  if (p === "p2" || p === "high") return "FFC2410C"; // orange
  if (p === "p3" || p === "medium") return "FFB45309"; // amber
  if (p === "p4" || p === "low") return "FF047857"; // green
  if (p === "p5" || p === "lowest") return "FF6B7280"; // gray
  return null;
}

const COLUMNS: {
  header: string;
  key: keyof IssueRow | "createdAt" | "updatedAt";
  width: number;
  min: number;
  max: number;
}[] = [
  { header: "Jira Key", key: "jiraKey", width: 12, min: 10, max: 16 },
  { header: "Summary", key: "summary", width: 50, min: 30, max: 60 },
  { header: "Status", key: "status", width: 14, min: 10, max: 22 },
  { header: "Issue Type", key: "issueType", width: 12, min: 10, max: 16 },
  { header: "Priority", key: "priority", width: 10, min: 8, max: 12 },
  { header: "Assignee", key: "assigneeName", width: 20, min: 14, max: 28 },
  { header: "Assignee Email", key: "assigneeEmail", width: 28, min: 18, max: 36 },
  { header: "Reporter", key: "reporterName", width: 20, min: 14, max: 28 },
  { header: "Reporter Email", key: "reporterEmail", width: 28, min: 18, max: 36 },
  { header: "Labels", key: "labels", width: 24, min: 14, max: 40 },
  { header: "Created", key: "createdAt", width: 13, min: 12, max: 14 },
  { header: "Updated", key: "updatedAt", width: 13, min: 12, max: 14 },
];

async function buildWorkbook(issues: IssueRow[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flux";
  wb.created = new Date();

  const ws = wb.addWorksheet("Tasks", {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  const colCount = COLUMNS.length;

  // --- Title banner (rows 1-2) ---
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = "My Tasks";
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_DARK } };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, colCount);
  const subCell = ws.getCell(2, 1);
  const generatedOn = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  subCell.value = `${issues.length} task${issues.length === 1 ? "" : "s"} · Exported ${generatedOn}`;
  subCell.font = { name: "Calibri", size: 10, color: { argb: "FFFFFFFF" }, italic: true };
  subCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  ws.getRow(2).height = 18;

  // --- Header row (row 3) ---
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

  // Track max content length per column for auto-width.
  const widths = COLUMNS.map((c) => c.header.length);

  // --- Data rows ---
  issues.forEach((issue, idx) => {
    const rowIndex = idx + 4;
    const row = ws.getRow(rowIndex);
    const zebra = idx % 2 === 1;

    COLUMNS.forEach((col, ci) => {
      const cell = row.getCell(ci + 1);
      let display = "";

      switch (col.key) {
        case "jiraKey": {
          const url =
            issue.jiraBaseUrl && issue.jiraKey
              ? `${issue.jiraBaseUrl}/browse/${issue.jiraKey}`
              : null;
          display = issue.jiraKey ?? "";
          if (url) {
            cell.value = { text: display, hyperlink: url };
            cell.font = { name: "Calibri", size: 11, color: { argb: TEAL_DARK }, underline: true, bold: true };
          } else {
            cell.value = display;
            cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: TEXT } };
          }
          break;
        }
        case "labels": {
          display = (issue.labels ?? []).join(", ");
          cell.value = display;
          cell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
          break;
        }
        case "priority": {
          display = issue.priority ?? "";
          cell.value = display;
          const color = priorityColor(issue.priority);
          cell.font = { name: "Calibri", size: 11, bold: !!color, color: { argb: color ?? TEXT } };
          break;
        }
        case "createdAt":
        case "updatedAt": {
          const d = col.key === "createdAt" ? issue.jiraCreatedAt : issue.jiraUpdatedAt;
          if (d) {
            cell.value = new Date(d);
            cell.numFmt = "dd MMM yyyy";
            display = "dd MMM yyyy";
          } else {
            cell.value = "";
          }
          cell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
          break;
        }
        case "assigneeEmail":
        case "reporterEmail": {
          display = (issue[col.key] as string | null) ?? "";
          cell.value = display;
          cell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
          break;
        }
        default: {
          display = ((issue[col.key as keyof IssueRow] as string | null) ?? "").toString();
          cell.value = display;
          cell.font = { name: "Calibri", size: 11, color: { argb: TEXT } };
        }
      }

      cell.alignment = {
        vertical: "top",
        horizontal: "left",
        indent: 1,
        wrapText: col.key === "summary" || col.key === "labels",
      };
      cell.border = {
        bottom: { style: "hair", color: { argb: BORDER } },
        right: { style: "hair", color: { argb: BORDER } },
      };
      if (zebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      }

      // Update measured width (skip the wrapped summary beyond its cap).
      if (display && col.key !== "summary") {
        widths[ci] = Math.max(widths[ci], display.length);
      }
    });
  });

  // --- Apply computed column widths (clamped) + filter ---
  COLUMNS.forEach((col, i) => {
    const measured = col.key === "summary" ? col.width : widths[i] + 3;
    ws.getColumn(i + 1).width = Math.min(col.max, Math.max(col.min, measured));
  });

  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: colCount },
  };

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

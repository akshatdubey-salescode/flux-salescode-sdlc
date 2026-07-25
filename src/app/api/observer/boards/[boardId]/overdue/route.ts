import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";
import { workingDaysBetween } from "@/lib/jira/estimate";
import { nearestDeliveryDateSql, nearestDeliveryStatusSql } from "@/lib/deliveries/entries";

type Params = { params: Promise<{ boardId: string }> };

export type OverdueIssueItem = {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  statusCategory: string | null;
  /** Our own status bucket, translated from the raw Jira status per the
   * project's status mapping. Null when the raw status has no mapping. */
  canonicalStatus: string | null;
  priority: string | null;
  issueType: string;
  startDate: string;
  dueDate: string;
  daysOverdue: number;
  projectName: string;
  jiraBaseUrl: string;
  estWorkingDays: number | null;
  deliveryDate: string | null;
  deliveryStatus: string | null;
};

export type OverduePersonGroup = {
  email: string;
  name: string;
  isManager: boolean;
  issues: OverdueIssueItem[];
  maxDaysOverdue: number;
};

export type OverdueResponse = {
  today: string;
  quarterStart: string;
  quarterEnd: string;
  totalCount: number;
  byPerson: OverduePersonGroup[];
};

type IssueRow = {
  id: string;
  jira_key: string;
  summary: string;
  status: string;
  status_category: string | null;
  canonical_status: string | null;
  priority: string | null;
  issue_type: string;
  assignee_email: string;
  custom_fields: Record<string, unknown>;
  project_name: string;
  jira_base_url: string;
  end_date_field_ids: string[] | null;
  start_date_field_ids: string[] | null;
  delivery_date: string | null;
  delivery_status: string | null;
};

// workingDaysBetween imported from @/lib/jira/estimate.

export async function GET(req: Request, { params }: Params) {
  try {
    await requireAuth();
    const { boardId } = await params;
    const url = new URL(req.url);

    const today = url.searchParams.get("today") ?? new Date().toISOString().split("T")[0];

    // Quarter bounds — scope to current quarter so past-quarter overdue tasks don't bleed in
    const defaultQEnd = today;
    const defaultQStart = new Date(new Date(today).getTime() - 90 * 86400000).toISOString().split("T")[0];
    const quarterStart = url.searchParams.get("qstart") ?? defaultQStart;
    const quarterEnd = url.searchParams.get("qend") ?? defaultQEnd;

    const data = await fetchBoardOverdue(boardId, today, quarterStart, quarterEnd);
    if (data === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[overdue] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchBoardOverdue(
  boardId: string,
  today: string,
  quarterStart: string,
  quarterEnd: string,
) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`board:${boardId}`);

  const [board] = await db
    .select()
    .from(observerBoards)
    .where(eq(observerBoards.id, boardId));

  if (!board) return null;

  const members = await db
    .select()
    .from(observerBoardMembers)
    .where(eq(observerBoardMembers.boardId, boardId));

  const emailToMeta = new Map<string, { name: string; isManager: boolean }>();
  for (const m of members) {
    emailToMeta.set(m.email.toLowerCase(), { name: m.name, isManager: false });
  }
  if (board.managerEmail) {
    const mgrKey = board.managerEmail.toLowerCase();
    if (!emailToMeta.has(mgrKey)) {
      emailToMeta.set(mgrKey, {
        name: board.managerName ?? board.managerEmail,
        isManager: true,
      });
    }
  }

  if (emailToMeta.size === 0) {
    return { today, quarterStart, quarterEnd, totalCount: 0, byPerson: [] } satisfies OverdueResponse;
  }

  const emails = [...emailToMeta.keys()];
  const emailsIn = sql.join(emails.map((e) => sql`${e}`), sql`, `);

  const issuesRes = await db.execute(sql`
    WITH member_issue_emails AS (
      SELECT ji.id, lower(ji.assignee_email) AS effective_email
      FROM jira_issues ji
      WHERE lower(ji.assignee_email) IN (${emailsIn})
      UNION
      SELECT ji.id, lower(ae) AS effective_email
      FROM jira_issues ji
      CROSS JOIN LATERAL unnest(ji.additional_assignee_emails) AS ae
      WHERE lower(ae) IN (${emailsIn})
    )
    SELECT
      ji.id,
      ji.jira_key,
      ji.summary,
      ji.status,
      ji.status_category,
      psm.canonical_status AS canonical_status,
      ji.priority,
      ji.issue_type,
      mie.effective_email AS assignee_email,
      ji.custom_fields,
      jp.name          AS project_name,
      jp.jira_base_url AS jira_base_url,
      jp.end_date_field_ids,
      jp.start_date_field_ids,
      ${nearestDeliveryDateSql(sql`ji.id`)} AS delivery_date,
      ${nearestDeliveryStatusSql(sql`ji.id`)} AS delivery_status
    FROM member_issue_emails mie
    JOIN jira_issues ji ON ji.id = mie.id
    JOIN jira_projects jp ON jp.id = ji.project_id
    LEFT JOIN project_status_mappings psm
      ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
    ORDER BY mie.effective_email, ji.jira_key
  `);

  const byEmail = new Map<string, OverdueIssueItem[]>();

  for (const raw of issuesRes.rows as IssueRow[]) {
    const cf = (raw.custom_fields as Record<string, unknown>) ?? {};
    const startDate = extractStartDate(cf, raw.start_date_field_ids);
    const dueDate = extractDueDate(cf, raw.end_date_field_ids);

    // Must have a due date to be "overdue"
    if (!dueDate) continue;

    // Must be past due relative to today
    if (dueDate >= today) continue;

    // Scope to quarter: due date must be within the quarter window
    if (dueDate < quarterStart || dueDate > quarterEnd) continue;

    // Skip if already done/completed/closed
    const cat = (raw.status_category ?? "").toLowerCase();
    if (cat === "done" || cat.includes("complete") || cat.includes("closed")) continue;

    const daysOverdue = Math.ceil(
      (new Date(today).getTime() - new Date(dueDate).getTime()) / 86400000
    );

    const email = raw.assignee_email;
    const list = byEmail.get(email) ?? [];
    list.push({
      id: raw.id,
      jiraKey: raw.jira_key,
      summary: raw.summary,
      status: raw.status,
      statusCategory: raw.status_category,
      canonicalStatus: raw.canonical_status,
      priority: raw.priority,
      issueType: raw.issue_type,
      startDate: startDate ?? "",
      dueDate,
      daysOverdue,
      projectName: raw.project_name,
      jiraBaseUrl: raw.jira_base_url,
      estWorkingDays: startDate ? workingDaysBetween(startDate, dueDate) : null,
      deliveryDate: raw.delivery_date,
      deliveryStatus: raw.delivery_status,
    });
    byEmail.set(email, list);
  }

  // Sort each person's issues by most overdue first
  for (const issues of byEmail.values()) {
    issues.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }

  let totalCount = 0;
  const byPerson: OverduePersonGroup[] = [];

  for (const [email, meta] of emailToMeta) {
    const issues = byEmail.get(email) ?? [];
    if (issues.length === 0) continue;
    totalCount += issues.length;
    byPerson.push({
      email,
      name: meta.name,
      isManager: meta.isManager,
      issues,
      maxDaysOverdue: issues[0].daysOverdue,
    });
  }

  // Sort persons by most overdue task first
  byPerson.sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue);

  return { today, quarterStart, quarterEnd, totalCount, byPerson } satisfies OverdueResponse;
}

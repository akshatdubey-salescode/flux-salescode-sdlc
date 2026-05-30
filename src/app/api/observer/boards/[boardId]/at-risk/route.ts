import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";

type Params = { params: Promise<{ boardId: string }> };

export type AtRiskIssueItem = {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  statusCategory: string | null;
  priority: string | null;
  issueType: string;
  startDate: string;
  dueDate: string;
  totalWorkingHours: number;
  remainingWorkingHours: number;
  percentRemaining: number;
  projectName: string;
  jiraBaseUrl: string;
};

export type AtRiskPersonGroup = {
  email: string;
  name: string;
  isManager: boolean;
  issues: AtRiskIssueItem[];
  minPercentRemaining: number;
};

export type AtRiskResponse = {
  now: string;
  quarterStart: string;
  quarterEnd: string;
  totalCount: number;
  byPerson: AtRiskPersonGroup[];
};

type IssueRow = {
  id: string;
  jira_key: string;
  summary: string;
  status: string;
  status_category: string | null;
  priority: string | null;
  issue_type: string;
  assignee_email: string;
  custom_fields: Record<string, unknown>;
  project_name: string;
  jira_base_url: string;
  end_date_field_ids: string[] | null;
  start_date_field_ids: string[] | null;
};

function totalWorkingHours(startDate: string, dueDate: string): number {
  const startMs = new Date(startDate + "T00:00:00").getTime();
  const dueMs = new Date(dueDate + "T00:00:00").getTime();
  const days = Math.max(0, Math.round((dueMs - startMs) / 86_400_000) + 1);
  return days * 9;
}

function workingHoursRemaining(nowStr: string, dueDate: string): number {
  const dueEndStr = dueDate + "T19:00:00";
  if (nowStr >= dueEndStr) return 0;

  let hours = 0;
  const todayDate = nowStr.slice(0, 10);
  const todayStartStr = todayDate + "T10:00:00";
  const todayEndStr = todayDate + "T19:00:00";

  if (nowStr < todayStartStr) {
    hours += 9;
  } else if (nowStr < todayEndStr) {
    hours += (new Date(todayEndStr).getTime() - new Date(nowStr).getTime()) / 3_600_000;
  }

  const tomorrowMs = new Date(todayDate + "T00:00:00").getTime() + 86_400_000;
  const dueMs = new Date(dueDate + "T00:00:00").getTime();
  const fullDays = Math.max(0, Math.round((dueMs - tomorrowMs) / 86_400_000) + 1);
  hours += fullDays * 9;

  return hours;
}

export async function GET(req: Request, { params }: Params) {
  try {
    await requireAuth();
    const { boardId } = await params;
    const url = new URL(req.url);

    // Client passes its local datetime as "YYYY-MM-DDTHH:MM:SS" (no timezone suffix)
    const nowStr = url.searchParams.get("now") ?? new Date().toISOString().slice(0, 19);
    const today = nowStr.slice(0, 10);

    const defaultQStart = new Date(new Date(today).getTime() - 90 * 86400000).toISOString().split("T")[0];
    const quarterStart = url.searchParams.get("qstart") ?? defaultQStart;
    const quarterEnd = url.searchParams.get("qend") ?? today;

    const data = await fetchBoardAtRisk(boardId, nowStr, today, quarterStart, quarterEnd);
    if (data === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[at-risk] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchBoardAtRisk(
  boardId: string,
  nowStr: string,
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
    return { now: nowStr, quarterStart, quarterEnd, totalCount: 0, byPerson: [] } satisfies AtRiskResponse;
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
      ji.priority,
      ji.issue_type,
      mie.effective_email AS assignee_email,
      ji.custom_fields,
      jp.name          AS project_name,
      jp.jira_base_url AS jira_base_url,
      jp.end_date_field_ids,
      jp.start_date_field_ids
    FROM member_issue_emails mie
    JOIN jira_issues ji ON ji.id = mie.id
    JOIN jira_projects jp ON jp.id = ji.project_id
    ORDER BY mie.effective_email, ji.jira_key
  `);

  const byEmail = new Map<string, AtRiskIssueItem[]>();

  for (const raw of issuesRes.rows as IssueRow[]) {
    const cf = (raw.custom_fields as Record<string, unknown>) ?? {};
    const startDate = extractStartDate(cf, raw.start_date_field_ids);
    const dueDate = extractDueDate(cf, raw.end_date_field_ids);

    // Must have both dates to be measurable
    if (!startDate || !dueDate) continue;

    // Already overdue — handled by the Overdue tab
    if (dueDate < today) continue;

    // Scope due date to the quarter window
    if (dueDate < quarterStart || dueDate > quarterEnd) continue;

    // Skip done/completed/closed
    const cat = (raw.status_category ?? "").toLowerCase();
    if (cat === "done" || cat.includes("complete") || cat.includes("closed")) continue;

    const total = totalWorkingHours(startDate, dueDate);
    const remaining = workingHoursRemaining(nowStr, dueDate);
    const percentRemaining = total > 0 ? (remaining / total) * 100 : 0;

    // At risk = last 20% of working time remaining
    if (percentRemaining > 20) continue;

    const email = raw.assignee_email;
    const list = byEmail.get(email) ?? [];
    list.push({
      id: raw.id,
      jiraKey: raw.jira_key,
      summary: raw.summary,
      status: raw.status,
      statusCategory: raw.status_category,
      priority: raw.priority,
      issueType: raw.issue_type,
      startDate,
      dueDate,
      totalWorkingHours: total,
      remainingWorkingHours: remaining,
      percentRemaining,
      projectName: raw.project_name,
      jiraBaseUrl: raw.jira_base_url,
    });
    byEmail.set(email, list);
  }

  // Sort each person's issues by least time remaining first
  for (const issues of byEmail.values()) {
    issues.sort((a, b) => a.remainingWorkingHours - b.remainingWorkingHours);
  }

  let totalCount = 0;
  const byPerson: AtRiskPersonGroup[] = [];

  for (const [email, meta] of emailToMeta) {
    const issues = byEmail.get(email) ?? [];
    if (issues.length === 0) continue;
    totalCount += issues.length;
    byPerson.push({
      email,
      name: meta.name,
      isManager: meta.isManager,
      issues,
      minPercentRemaining: issues[0].percentRemaining,
    });
  }

  // Sort persons by most urgent (least time remaining) first
  byPerson.sort((a, b) => a.minPercentRemaining - b.minPercentRemaining);

  return { now: nowStr, quarterStart, quarterEnd, totalCount, byPerson } satisfies AtRiskResponse;
}

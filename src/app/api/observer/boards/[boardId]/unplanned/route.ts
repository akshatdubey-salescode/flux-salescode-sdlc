import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";

type Params = { params: Promise<{ boardId: string }> };

export type UnplannedIssueItem = {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  statusCategory: string | null;
  priority: string | null;
  issueType: string;
  projectName: string;
  jiraBaseUrl: string;
  missingStart: boolean;
  missingDue: boolean;
  createdAt: string | null;
};

export type UnplannedPersonGroup = {
  email: string;
  name: string;
  isManager: boolean;
  issues: UnplannedIssueItem[];
};

export type UnplannedResponse = {
  start: string;
  end: string;
  totalCount: number;
  byPerson: UnplannedPersonGroup[];
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
  jira_created_at: string | null;
  end_date_field_ids: string[] | null;
  start_date_field_ids: string[] | null;
};

export async function GET(req: Request, { params }: Params) {
  try {
    await requireAuth();
    const { boardId } = await params;
    const url = new URL(req.url);

    const today = new Date();
    const defaultEnd = today.toISOString().split("T")[0];
    const defaultStart = new Date(today.getTime() - 30 * 86400000).toISOString().split("T")[0];

    const start = url.searchParams.get("start") ?? defaultStart;
    const end = url.searchParams.get("end") ?? defaultEnd;

    const data = await fetchBoardUnplanned(boardId, start, end);
    if (data === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[unplanned] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchBoardUnplanned(boardId: string, start: string, end: string) {
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

  const emailToName = new Map<string, { name: string; isManager: boolean }>();
  for (const m of members) {
    emailToName.set(m.email.toLowerCase(), { name: m.name, isManager: false });
  }
  if (board.managerEmail) {
    const mgrKey = board.managerEmail.toLowerCase();
    if (!emailToName.has(mgrKey)) {
      emailToName.set(mgrKey, {
        name: board.managerName ?? board.managerEmail,
        isManager: true,
      });
    }
  }

  if (emailToName.size === 0) {
    return { start, end, totalCount: 0, byPerson: [] } satisfies UnplannedResponse;
  }

  const emails = [...emailToName.keys()];
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
      ji.jira_created_at,
      jp.name          AS project_name,
      jp.jira_base_url AS jira_base_url,
      jp.end_date_field_ids,
      jp.start_date_field_ids
    FROM member_issue_emails mie
    JOIN jira_issues ji ON ji.id = mie.id
    JOIN jira_projects jp ON jp.id = ji.project_id
    WHERE ji.jira_created_at IS NOT NULL
      AND ji.jira_created_at::date >= ${start}::date
      AND ji.jira_created_at::date <= ${end}::date
    ORDER BY mie.effective_email, ji.jira_created_at DESC NULLS LAST
  `);

  const byEmail = new Map<string, UnplannedIssueItem[]>();

  for (const raw of issuesRes.rows as IssueRow[]) {
    const cf = (raw.custom_fields as Record<string, unknown>) ?? {};
    const startDate = extractStartDate(cf, raw.start_date_field_ids);
    const dueDate = extractDueDate(cf, raw.end_date_field_ids);

    if (startDate && dueDate) continue;

    const email = raw.assignee_email.toLowerCase();
    const list = byEmail.get(email) ?? [];
    list.push({
      id: raw.id,
      jiraKey: raw.jira_key,
      summary: raw.summary,
      status: raw.status,
      statusCategory: raw.status_category,
      priority: raw.priority,
      issueType: raw.issue_type,
      projectName: raw.project_name,
      jiraBaseUrl: raw.jira_base_url,
      missingStart: !startDate,
      missingDue: !dueDate,
      createdAt: raw.jira_created_at ? raw.jira_created_at.slice(0, 10) : null,
    });
    byEmail.set(email, list);
  }

  const byPerson: UnplannedPersonGroup[] = [];
  for (const [email, info] of emailToName.entries()) {
    const issues = byEmail.get(email) ?? [];
    if (issues.length > 0) {
      byPerson.push({ email, name: info.name, isManager: info.isManager, issues });
    }
  }
  byPerson.sort((a, b) => {
    if (a.isManager && !b.isManager) return -1;
    if (!a.isManager && b.isManager) return 1;
    return b.issues.length - a.issues.length;
  });

  return {
    start,
    end,
    totalCount: byPerson.reduce((s, p) => s + p.issues.length, 0),
    byPerson,
  } satisfies UnplannedResponse;
}

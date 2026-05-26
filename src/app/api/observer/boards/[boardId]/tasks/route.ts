import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

type Params = { params: Promise<{ boardId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { boardId } = await params;

    const [board] = await db
      .select({ id: observerBoards.id })
      .from(observerBoards)
      .where(and(eq(observerBoards.id, boardId), eq(observerBoards.createdBy, user.id)));

    if (!board) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") ?? "";
    const to = searchParams.get("to") ?? "";

    const data = await fetchBoardTasks(boardId, from, to);
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

async function fetchBoardTasks(boardId: string, from: string, to: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues", `board:${boardId}`);

  const members = await db
    .select()
    .from(observerBoardMembers)
    .where(eq(observerBoardMembers.boardId, boardId));

  if (members.length === 0) return [];

  const memberEmails = members.map((m) => m.email);
  const emailsIn = sql.join(memberEmails.map((e) => sql`${e}`), sql`, `);

  const fromFilter = from ? sql`AND ji.jira_updated_at >= ${new Date(from).toISOString()}::timestamptz` : sql``;
  const toFilter = (() => {
    if (!to) return sql``;
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    return sql`AND ji.jira_updated_at <= ${toDate.toISOString()}::timestamptz`;
  })();

  type IssueRow = {
    id: string;
    jira_key: string;
    summary: string;
    status: string;
    status_category: string | null;
    issue_type: string;
    priority: string | null;
    effective_email: string;
    assignee_name: string | null;
    jira_updated_at: string | null;
    jira_created_at: string | null;
    project_id: string;
    project_name: string;
    project_key: string;
  };

  const issuesRes = await db.execute(sql`
    WITH member_issue_emails AS (
      SELECT ji.id, ji.assignee_email AS effective_email
      FROM jira_issues ji
      WHERE ji.assignee_email IN (${emailsIn})
      UNION
      SELECT ji.id, ae AS effective_email
      FROM jira_issues ji
      CROSS JOIN LATERAL unnest(ji.additional_assignee_emails) AS ae
      WHERE ae IN (${emailsIn})
    )
    SELECT
      ji.id,
      ji.jira_key,
      ji.summary,
      ji.status,
      ji.status_category,
      ji.issue_type,
      ji.priority,
      mie.effective_email,
      ji.assignee_name,
      ji.jira_updated_at,
      ji.jira_created_at,
      ji.project_id,
      jp.name          AS project_name,
      jp.jira_project_key AS project_key
    FROM member_issue_emails mie
    JOIN jira_issues ji ON ji.id = mie.id
    JOIN jira_projects jp ON jp.id = ji.project_id
    WHERE TRUE ${fromFilter} ${toFilter}
  `);

  const grouped: Record<
    string,
    {
      member: (typeof members)[0];
      issues: IssueRow[];
      statusCounts: Record<string, number>;
    }
  > = {};

  for (const m of members) {
    grouped[m.email] = { member: m, issues: [], statusCounts: {} };
  }

  for (const issue of issuesRes.rows as IssueRow[]) {
    const email = issue.effective_email;
    if (!email || !grouped[email]) continue;
    grouped[email].issues.push(issue);
    const cat = issue.status_category ?? issue.status ?? "Unknown";
    grouped[email].statusCounts[cat] = (grouped[email].statusCounts[cat] ?? 0) + 1;
  }

  return Object.values(grouped);
}

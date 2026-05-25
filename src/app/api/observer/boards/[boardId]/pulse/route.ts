import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

type Params = { params: Promise<{ boardId: string }> };

function loadLabel(score: number): "Free" | "Light" | "Moderate" | "Heavy" {
  if (score === 0) return "Free";
  if (score <= 2) return "Light";
  if (score <= 4) return "Moderate";
  return "Heavy";
}

function loadScore(issues: { priority: string | null }[]): number {
  return issues.reduce((sum, d) => {
    const p = d.priority?.toLowerCase() ?? "";
    return sum + (p === "critical" || p === "highest" ? 2 : 1);
  }, 0);
}

export async function GET(_req: Request, { params }: Params) {
  try {
    await requireAuth();
    const { boardId } = await params;
    const referenceDate = new Date().toISOString().split("T")[0]; // day-granularity, outside cache boundary
    const data = await fetchBoardPulse(boardId, referenceDate);
    if (data === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[pulse] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchBoardPulse(boardId: string, referenceDate: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues", `board:${boardId}`);

  const [board] = await db
    .select()
    .from(observerBoards)
    .where(eq(observerBoards.id, boardId));

  if (!board) return null;

  const members = await db
    .select()
    .from(observerBoardMembers)
    .where(eq(observerBoardMembers.boardId, boardId));

  if (members.length === 0) return [];

  const emails = members.map((m) => m.email);
  const emailsIn = sql.join(emails.map((e) => sql`${e}`), sql`, `);

  const staleCutoff = new Date(referenceDate);
  staleCutoff.setDate(staleCutoff.getDate() - board.stalenessThresholdDays);

  const activeIssuesRes = await db.execute(sql`
    SELECT
      ji.id              AS jira_issue_id,
      ji.assignee_email,
      ji.jira_key,
      ji.summary,
      ji.status,
      ji.status_category,
      ji.priority,
      jp.name            AS project_name,
      jp.jira_base_url   AS jira_base_url
    FROM jira_issues ji
    JOIN jira_projects jp ON jp.id = ji.project_id
    LEFT JOIN project_status_mappings psm
      ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
    WHERE ji.assignee_email IN (${emailsIn})
      AND (
        psm.canonical_status = 'IN_PROGRESS'
        OR (psm.canonical_status IS NULL AND ji.status_category ILIKE '%progress%')
      )
    ORDER BY ji.assignee_email, ji.updated_at DESC
  `);

  const stalledRes = await db.execute(sql`
    SELECT
      ji.assignee_email,
      COUNT(*)::int AS stalled_count
    FROM jira_issues ji
    JOIN project_status_mappings psm
      ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
    WHERE ji.assignee_email IN (${emailsIn})
      AND psm.canonical_status = 'IN_PROGRESS'
      AND ji.updated_at < ${staleCutoff.toISOString()}
    GROUP BY ji.assignee_email
  `);

  type ActiveIssueRow = {
    jira_issue_id: string;
    assignee_email: string;
    jira_key: string;
    summary: string;
    status: string;
    status_category: string | null;
    priority: string | null;
    project_name: string;
    jira_base_url: string;
  };
  type StalledRow = { assignee_email: string; stalled_count: number };

  const issuesByEmail = new Map<string, ActiveIssueRow[]>();
  for (const row of activeIssuesRes.rows as ActiveIssueRow[]) {
    const list = issuesByEmail.get(row.assignee_email) ?? [];
    list.push(row);
    issuesByEmail.set(row.assignee_email, list);
  }

  const stalledByEmail = new Map<string, number>();
  for (const row of stalledRes.rows as StalledRow[]) {
    stalledByEmail.set(row.assignee_email, row.stalled_count);
  }

  const pulse = members.map((member) => {
    const issues = issuesByEmail.get(member.email) ?? [];
    const score = loadScore(issues);

    return {
      memberId: member.id,
      name: member.name,
      email: member.email,
      loadScore: score,
      loadLabel: loadLabel(score),
      activeIssues: issues.map((i) => ({
        jiraIssueId: i.jira_issue_id,
        jiraKey: i.jira_key,
        summary: i.summary,
        status: i.status,
        statusCategory: i.status_category,
        priority: i.priority,
        projectName: i.project_name,
        jiraBaseUrl: i.jira_base_url,
      })),
      stalledCount: stalledByEmail.get(member.email) ?? 0,
    };
  });

  pulse.sort((a, b) => {
    const order = { Heavy: 0, Moderate: 1, Light: 2, Free: 3 };
    const diff = order[a.loadLabel] - order[b.loadLabel];
    if (diff !== 0) return diff;
    return b.stalledCount - a.stalledCount;
  });

  return pulse;
}

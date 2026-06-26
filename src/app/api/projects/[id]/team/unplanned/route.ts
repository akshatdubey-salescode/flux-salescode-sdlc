import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";

export type {
  UnplannedIssueItem,
  UnplannedPersonGroup,
  UnplannedResponse,
} from "@/app/api/observer/boards/[boardId]/unplanned/route";

import type { UnplannedIssueItem, UnplannedPersonGroup, UnplannedResponse } from "@/app/api/observer/boards/[boardId]/unplanned/route";

type Params = { params: Promise<{ id: string }> };

type IssueRow = {
  id: string; jira_key: string; summary: string; status: string;
  status_category: string | null; priority: string | null; issue_type: string;
  assignee_email: string; custom_fields: Record<string, unknown>;
  project_name: string; jira_base_url: string; jira_created_at: string | null;
  assignee_since: string | null;
  end_date_field_ids: string[] | null; start_date_field_ids: string[] | null;
};

export async function GET(req: Request, { params }: Params) {
  try {
    await requireAuth();
    const { id: projectId } = await params;
    const url = new URL(req.url);
    const today = new Date().toISOString().split("T")[0];
    const defaultEnd = today;
    const defaultStart = new Date(new Date(today).getTime() - 30 * 86400000).toISOString().split("T")[0];
    const start = url.searchParams.get("start") ?? defaultStart;
    const end = url.searchParams.get("end") ?? defaultEnd;
    const data = await fetchProjectUnplanned(projectId, start, end);
    if (data === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[project-team-unplanned] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchProjectUnplanned(projectId: string, start: string, end: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag("projects", `project:${projectId}`);

  const [project] = await db.select().from(jiraProjects).where(eq(jiraProjects.id, projectId));
  if (!project) return null;

  const membersRes = await db.execute(sql`
    SELECT DISTINCT lower(ji.assignee_email) AS email,
      COALESCE(MIN(ji.assignee_name), lower(ji.assignee_email)) AS name
    FROM jira_issues ji
    WHERE ji.project_id = ${projectId} AND ji.assignee_email IS NOT NULL AND ji.assignee_email != ''
    GROUP BY lower(ji.assignee_email) ORDER BY name
  `);
  type MemberRow = { email: string; name: string };
  const members = membersRes.rows as MemberRow[];
  if (members.length === 0) return { start, end, totalCount: 0, byPerson: [] } satisfies UnplannedResponse;

  const emailsIn = sql.join(members.map((m) => sql`${m.email}`), sql`, `);
  const issuesRes = await db.execute(sql`
    WITH mie AS (
      SELECT ji.id, lower(ji.assignee_email) AS effective_email FROM jira_issues ji
      WHERE lower(ji.assignee_email) IN (${emailsIn}) AND ji.project_id = ${projectId}
      UNION
      SELECT ji.id, lower(ae) FROM jira_issues ji
      CROSS JOIN LATERAL unnest(ji.additional_assignee_emails) AS ae
      WHERE lower(ae) IN (${emailsIn}) AND ji.project_id = ${projectId}
    )
    SELECT ji.id, ji.jira_key, ji.summary, ji.status, ji.status_category, ji.priority, ji.issue_type,
      mie.effective_email AS assignee_email, ji.custom_fields, ji.jira_created_at, ji.assignee_since,
      jp.name AS project_name, jp.jira_base_url, jp.end_date_field_ids, jp.start_date_field_ids
    FROM mie JOIN jira_issues ji ON ji.id = mie.id JOIN jira_projects jp ON jp.id = ji.project_id
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
    if (startDate && dueDate) continue; // has both dates, not unplanned
    const list = byEmail.get(raw.assignee_email) ?? [];
    list.push({
      id: raw.id, jiraKey: raw.jira_key, summary: raw.summary, status: raw.status,
      statusCategory: raw.status_category, priority: raw.priority, issueType: raw.issue_type,
      projectName: raw.project_name, jiraBaseUrl: raw.jira_base_url,
      missingStart: !startDate, missingDue: !dueDate, createdAt: raw.jira_created_at ?? null,
      assignedAt: raw.assignee_since ?? null,
    });
    byEmail.set(raw.assignee_email, list);
  }

  let totalCount = 0;
  const byPerson: UnplannedPersonGroup[] = [];
  for (const m of members) {
    const issues = byEmail.get(m.email) ?? [];
    if (!issues.length) continue;
    totalCount += issues.length;
    byPerson.push({ email: m.email, name: m.name, isManager: false, issues });
  }
  return { start, end, totalCount, byPerson } satisfies UnplannedResponse;
}

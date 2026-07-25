import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { nearestDeliveryDateSql, nearestDeliveryStatusSql } from "@/lib/deliveries/entries";

type Params = { params: Promise<{ id: string }> };

export type UnassignedIssueItem = {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  statusCategory: string | null;
  priority: string | null;
  issueType: string;
  projectName: string;
  jiraBaseUrl: string;
  createdAt: string | null;
  deliveryDate: string | null;
  deliveryStatus: string | null;
};

export type UnassignedResponse = {
  totalCount: number;
  issues: UnassignedIssueItem[];
};

type IssueRow = {
  id: string;
  jira_key: string;
  summary: string;
  status: string;
  status_category: string | null;
  priority: string | null;
  issue_type: string;
  project_name: string;
  jira_base_url: string;
  jira_created_at: string | null;
  delivery_date: string | null;
  delivery_status: string | null;
};

const PRIORITY_ORDER: Record<string, number> = {
  highest: 0, critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  lowest: 4,
};

export async function GET(req: Request, { params }: Params) {
  try {
    await requireAuth();
    const { id: projectId } = await params;
    const url = new URL(req.url);
    const today = new Date().toISOString().split("T")[0];
    const defaultQStart = new Date(new Date(today).getTime() - 90 * 86400000).toISOString().split("T")[0];
    const qstart = url.searchParams.get("qstart") ?? defaultQStart;
    const qend = url.searchParams.get("qend") ?? today;
    const data = await fetchUnassigned(projectId, qstart, qend);
    if (data === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[project-team-unassigned] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchUnassigned(projectId: string, qstart: string, qend: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag("projects", `project:${projectId}`);

  const [project] = await db.select().from(jiraProjects).where(eq(jiraProjects.id, projectId));
  if (!project) return null;

  const issuesRes = await db.execute(sql`
    SELECT
      ji.id, ji.jira_key, ji.summary, ji.status, ji.status_category,
      ji.priority, ji.issue_type, ji.jira_created_at,
      jp.name AS project_name, jp.jira_base_url,
      ${nearestDeliveryDateSql(sql`ji.id`)} AS delivery_date,
      ${nearestDeliveryStatusSql(sql`ji.id`)} AS delivery_status
    FROM jira_issues ji
    JOIN jira_projects jp ON jp.id = ji.project_id
    WHERE ji.project_id = ${projectId}
      AND (ji.assignee_email IS NULL OR ji.assignee_email = '')
      AND LOWER(COALESCE(ji.status_category, '')) NOT IN ('done', 'complete', 'completed', 'closed')
      AND ji.jira_created_at IS NOT NULL
      AND ji.jira_created_at::date >= ${qstart}::date
      AND ji.jira_created_at::date <= ${qend}::date
    ORDER BY ji.jira_created_at DESC NULLS LAST
  `);

  const issues: UnassignedIssueItem[] = (issuesRes.rows as IssueRow[]).map((raw) => ({
    id: raw.id,
    jiraKey: raw.jira_key,
    summary: raw.summary,
    status: raw.status,
    statusCategory: raw.status_category,
    priority: raw.priority,
    issueType: raw.issue_type,
    projectName: raw.project_name,
    jiraBaseUrl: raw.jira_base_url,
    createdAt: raw.jira_created_at ?? null,
    deliveryDate: raw.delivery_date,
    deliveryStatus: raw.delivery_status,
  }));

  // Sort: priority first, then by creation date descending
  issues.sort((a, b) => {
    const pa = PRIORITY_ORDER[(a.priority ?? "").toLowerCase()] ?? 2;
    const pb = PRIORITY_ORDER[(b.priority ?? "").toLowerCase()] ?? 2;
    if (pa !== pb) return pa - pb;
    if (a.createdAt && b.createdAt) return b.createdAt.localeCompare(a.createdAt);
    return 0;
  });

  return { totalCount: issues.length, issues } satisfies UnassignedResponse;
}

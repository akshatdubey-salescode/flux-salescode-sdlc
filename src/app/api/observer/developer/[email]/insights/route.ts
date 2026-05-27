import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";

type Params = { params: Promise<{ email: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    await requireAuth();
    const { email } = await params;
    const decodedEmail = decodeURIComponent(email).toLowerCase();
    const data = await fetchDeveloperInsights(decodedEmail);
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

async function fetchDeveloperInsights(email: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`developer:${email}`);

  const [
    completedThisWeekRes,
    completedLastWeekRes,
    openIssuesRes,
    priorityDistRes,
    projectDistRes,
    issueTypeDistRes,
    statusDistRes,
    recentIssuesRes,
    avgCycleTimeRes,
  ] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM jira_issues ji
      WHERE (ji.assignee_email = ${email} OR ${email} = ANY(ji.additional_assignee_emails))
        AND ji.completed_at >= NOW() - INTERVAL '7 days'
    `),

    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM jira_issues ji
      WHERE (ji.assignee_email = ${email} OR ${email} = ANY(ji.additional_assignee_emails))
        AND ji.completed_at >= NOW() - INTERVAL '14 days'
        AND ji.completed_at < NOW() - INTERVAL '7 days'
    `),

    db.execute(sql`
      SELECT COUNT(DISTINCT ji.id)::int AS count
      FROM jira_issues ji
      LEFT JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE (ji.assignee_email = ${email} OR ${email} = ANY(ji.additional_assignee_emails))
        AND (psm.canonical_status IS NULL OR psm.canonical_status NOT IN ('DONE', 'CANCELLED'))
    `),

    db.execute(sql`
      SELECT
        COALESCE(ji.priority, 'None') AS priority,
        COUNT(*)::int AS count
      FROM jira_issues ji
      WHERE (ji.assignee_email = ${email} OR ${email} = ANY(ji.additional_assignee_emails))
      GROUP BY ji.priority
      ORDER BY count DESC
    `),

    db.execute(sql`
      SELECT
        jp.name AS project_name,
        jp.jira_project_key AS project_key,
        COUNT(*)::int AS count
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      WHERE (ji.assignee_email = ${email} OR ${email} = ANY(ji.additional_assignee_emails))
      GROUP BY jp.id, jp.name, jp.jira_project_key
      ORDER BY count DESC
      LIMIT 10
    `),

    db.execute(sql`
      SELECT
        ji.issue_type AS issue_type,
        COUNT(*)::int AS count
      FROM jira_issues ji
      WHERE (ji.assignee_email = ${email} OR ${email} = ANY(ji.additional_assignee_emails))
      GROUP BY ji.issue_type
      ORDER BY count DESC
    `),

    db.execute(sql`
      SELECT
        ji.status,
        MAX(ji.status_category) AS status_category,
        COUNT(*)::int AS count
      FROM jira_issues ji
      LEFT JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE (ji.assignee_email = ${email} OR ${email} = ANY(ji.additional_assignee_emails))
        AND (psm.canonical_status IS NULL OR psm.canonical_status NOT IN ('DONE', 'CANCELLED'))
      GROUP BY ji.status
      ORDER BY count DESC
    `),

    db.execute(sql`
      SELECT
        ji.jira_key,
        ji.summary,
        ji.status,
        ji.status_category,
        ji.issue_type,
        ji.priority,
        ji.jira_updated_at,
        ji.jira_created_at,
        jp.name AS project_name,
        jp.jira_project_key AS project_key
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      WHERE (ji.assignee_email = ${email} OR ${email} = ANY(ji.additional_assignee_emails))
      ORDER BY ji.jira_updated_at DESC NULLS LAST
      LIMIT 15
    `),

    db.execute(sql`
      SELECT ROUND(AVG(
        EXTRACT(EPOCH FROM (ji.completed_at - ji.jira_created_at)) / 3600
      )::numeric, 1) AS avg_hours
      FROM jira_issues ji
      WHERE (ji.assignee_email = ${email} OR ${email} = ANY(ji.additional_assignee_emails))
        AND ji.completed_at >= NOW() - INTERVAL '30 days'
        AND ji.jira_created_at IS NOT NULL
    `),
  ]);

  const completedThisWeek = (completedThisWeekRes.rows[0] as { count: number })?.count ?? 0;
  const completedLastWeek = (completedLastWeekRes.rows[0] as { count: number })?.count ?? 0;
  const openIssues = (openIssuesRes.rows[0] as { count: number })?.count ?? 0;
  const avgCycleHours = (avgCycleTimeRes.rows[0] as { avg_hours: string | null })?.avg_hours;

  return {
    completedThisWeek,
    completedLastWeek,
    openIssues,
    avgCycleHours: avgCycleHours ? parseFloat(avgCycleHours) : null,
    priorityDistribution: priorityDistRes.rows as { priority: string; count: number }[],
    projectDistribution: projectDistRes.rows as {
      project_name: string;
      project_key: string;
      count: number;
    }[],
    issueTypeDistribution: issueTypeDistRes.rows as { issue_type: string; count: number }[],
    statusDistribution: statusDistRes.rows as {
      status: string;
      status_category: string;
      count: number;
    }[],
    recentIssues: recentIssuesRes.rows as {
      jira_key: string;
      summary: string;
      status: string;
      status_category: string;
      issue_type: string;
      priority: string;
      jira_updated_at: string;
      jira_created_at: string;
      project_name: string;
      project_key: string;
    }[],
  };
}

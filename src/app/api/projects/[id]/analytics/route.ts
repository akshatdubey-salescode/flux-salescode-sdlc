import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql, eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { jiraProjects } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id: projectId } = await props.params;
    const data = await fetchProjectAnalytics(projectId);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Project analytics error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchProjectAnalytics(projectId: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag("projects", `project:${projectId}`);

  const projectRes = await db
    .select({ jiraBaseUrl: jiraProjects.jiraBaseUrl })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId));

  const jiraBaseUrl = projectRes[0]?.jiraBaseUrl || "";

  const [
    activeIssuesRes,
    completedThisWeekRes,
    completedLastWeekRes,
    slaViolationsRes,
    assigneeWorkloadRes,
    throughputRes,
    cycleTimeRes,
    staleIssuesRes,
  ] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM jira_issues ji
      JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE psm.canonical_status NOT IN ('DONE', 'CANCELLED')
        AND ji.project_id = ${projectId}
    `),

    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM jira_issues ji
      WHERE ji.completed_at >= NOW() - INTERVAL '7 days'
        AND ji.project_id = ${projectId}
    `),

    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM jira_issues ji
      WHERE ji.completed_at >= NOW() - INTERVAL '14 days'
        AND ji.completed_at < NOW() - INTERVAL '7 days'
        AND ji.project_id = ${projectId}
    `),

    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM sla_violations sv
      JOIN jira_issues ji ON ji.id = sv.issue_id
      WHERE sv.resolved_at IS NULL AND ji.project_id = ${projectId}
    `),

    db.execute(sql`
      SELECT
        COALESCE(ji.assignee_name, 'Unassigned') AS assignee,
        COUNT(*)::int AS active_count
      FROM jira_issues ji
      JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE psm.canonical_status IN ('IN_PROGRESS', 'IN_REVIEW', 'IN_QA')
        AND ji.project_id = ${projectId}
      GROUP BY 1
      ORDER BY active_count DESC
    `),

    db.execute(sql`
      SELECT
        date_trunc('week', ji.completed_at) AS week,
        COUNT(*)::int AS completed
      FROM jira_issues ji
      WHERE ji.completed_at >= NOW() - INTERVAL '8 weeks'
        AND ji.project_id = ${projectId}
      GROUP BY 1
      ORDER BY 1
    `),

    db.execute(sql`
      WITH issue_cycle_times AS (
        SELECT
          ji.issue_type,
          ji.id AS issue_id,
          SUM(tis.secs::numeric) AS total_active_seconds
        FROM jira_issues ji
        CROSS JOIN LATERAL jsonb_each_text(ji.time_in_status) AS tis(status, secs)
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id
          AND psm.raw_status = tis.status
        WHERE psm.canonical_status IN ('IN_PROGRESS', 'IN_REVIEW', 'IN_QA')
          AND ji.completed_at IS NOT NULL
          AND ji.project_id = ${projectId}
        GROUP BY ji.issue_type, ji.id
      )
      SELECT
        issue_type,
        COALESCE(ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_active_seconds) / 3600)::numeric, 1), 0) AS p50_hours
      FROM issue_cycle_times
      GROUP BY issue_type
    `),

    db.execute(sql`
      SELECT
        ji.id,
        ji.jira_key,
        ji.summary,
        ji.assignee_name,
        date_part('day', NOW() - ji.jira_updated_at)::int AS days_stale
      FROM jira_issues ji
      JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id
        AND psm.raw_status = ji.status
      WHERE psm.canonical_status NOT IN ('DONE', 'CANCELLED', 'BACKLOG')
        AND ji.jira_updated_at < NOW() - INTERVAL '7 days'
        AND ji.project_id = ${projectId}
      ORDER BY days_stale DESC
      LIMIT 10
    `),
  ]);

  const activeIssues = Number(activeIssuesRes.rows[0]?.count || 0);
  const completedThisWeek = Number(completedThisWeekRes.rows[0]?.count || 0);
  const completedLastWeek = Number(completedLastWeekRes.rows[0]?.count || 0);
  const slaViolations = Number(slaViolationsRes.rows[0]?.count || 0);

  let compDelta = 0;
  if (completedLastWeek > 0) {
    compDelta = Math.round((completedThisWeek - completedLastWeek) / completedLastWeek * 100);
  }

  return {
    projectHealth: {
      activeIssues,
      completedThisWeek,
      completedDelta: compDelta,
      slaViolations,
    },
    assigneeWorkload: assigneeWorkloadRes.rows,
    throughput: throughputRes.rows,
    cycleTimeByType: cycleTimeRes.rows,
    staleIssues: staleIssuesRes.rows,
    jiraBaseUrl,
  };
}

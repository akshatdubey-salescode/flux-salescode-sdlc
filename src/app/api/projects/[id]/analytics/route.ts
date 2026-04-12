import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const params = await props.params;
    const projectId = params.id;

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
        SELECT COUNT(DISTINCT ji.id)::int AS count
        FROM jira_status_history jsh
        JOIN jira_issues ji ON ji.id = jsh.issue_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = jsh.to_status
        WHERE psm.canonical_status = 'DONE'
          AND jsh.changed_at >= NOW() - INTERVAL '7 days'
          AND ji.project_id = ${projectId}
      `),

      db.execute(sql`
        SELECT COUNT(DISTINCT ji.id)::int AS count
        FROM jira_status_history jsh
        JOIN jira_issues ji ON ji.id = jsh.issue_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = jsh.to_status
        WHERE psm.canonical_status = 'DONE'
          AND jsh.changed_at >= NOW() - INTERVAL '14 days'
           AND jsh.changed_at < NOW() - INTERVAL '7 days'
          AND ji.project_id = ${projectId}
      `),

      db.execute(sql`
        SELECT COUNT(*)::int AS count 
        FROM sla_violations sv
        JOIN jira_issues ji ON ji.id = sv.issue_id
        WHERE sv.resolved_at IS NULL AND ji.project_id = ${projectId}
      `),

      // Assignee Workload (WIP Issues)
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

      // Project Throughput (Weekly)
      db.execute(sql`
        SELECT
          date_trunc('week', jsh.changed_at) AS week,
          COUNT(DISTINCT ji.id)::int AS completed
        FROM jira_status_history jsh
        JOIN jira_issues ji ON ji.id = jsh.issue_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id
          AND psm.raw_status = jsh.to_status
        WHERE psm.canonical_status = 'DONE'
          AND jsh.changed_at >= NOW() - INTERVAL '8 weeks'
          AND ji.project_id = ${projectId}
        GROUP BY 1
        ORDER BY 1
      `),

      // Cycle Time by Issue Type
      db.execute(sql`
        WITH issue_cycle_times AS (
          SELECT
            ji.issue_type,
            ji.id AS issue_id,
            SUM(jsh.duration_seconds) AS total_active_seconds
          FROM jira_status_history jsh
          JOIN jira_issues ji ON ji.id = jsh.issue_id
          JOIN project_status_mappings psm
            ON psm.project_id = ji.project_id
            AND psm.raw_status = jsh.to_status
          WHERE psm.canonical_status IN ('IN_PROGRESS', 'IN_REVIEW', 'IN_QA')
            AND jsh.duration_seconds IS NOT NULL
            AND ji.project_id = ${projectId}
          GROUP BY ji.issue_type, ji.id
        )
        SELECT
          issue_type,
          COALESCE(ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_active_seconds) / 3600)::numeric, 1), 0) AS p50_hours
        FROM issue_cycle_times
        GROUP BY issue_type
      `),

      // Stale Issues
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

    return NextResponse.json({
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
    });
  } catch (error) {
    console.error("Project analytics error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

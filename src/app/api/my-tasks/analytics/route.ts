import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";

export async function GET() {
  try {
    const user = await requireAuth();
    return NextResponse.json(await fetchMyTasksAnalytics(user.email));
  } catch (error) {
    console.error("User analytics error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchMyTasksAnalytics(userEmail: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`my-tasks:${userEmail}`);

  const [
    activeIssuesRes,
    completedThisWeekRes,
    completedLastWeekRes,
    slaViolationsRes,
    cycleTimeRes,
    staleIssuesRes,
  ] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM jira_issues ji
      JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE psm.canonical_status NOT IN ('DONE', 'CANCELLED')
        AND (ji.assignee_email = ${userEmail} OR ${userEmail} = ANY(ji.additional_assignee_emails))
    `),

    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM jira_issues ji
      WHERE ji.completed_at >= NOW() - INTERVAL '7 days'
        AND (ji.assignee_email = ${userEmail} OR ${userEmail} = ANY(ji.additional_assignee_emails))
    `),

    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM jira_issues ji
      WHERE ji.completed_at >= NOW() - INTERVAL '14 days'
        AND ji.completed_at < NOW() - INTERVAL '7 days'
        AND (ji.assignee_email = ${userEmail} OR ${userEmail} = ANY(ji.additional_assignee_emails))
    `),

    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM sla_violations sv
      JOIN jira_issues ji ON ji.id = sv.issue_id
      WHERE sv.resolved_at IS NULL
        AND (ji.assignee_email = ${userEmail} OR ${userEmail} = ANY(ji.additional_assignee_emails))
    `),

    db.execute(sql`
      WITH issue_cycle_times AS (
        SELECT
          ji.id AS issue_id,
          (ji.assignee_email = ${userEmail} OR ${userEmail} = ANY(ji.additional_assignee_emails)) AS is_mine,
          SUM(tis.secs::numeric) AS total_active_seconds
        FROM jira_issues ji
        CROSS JOIN LATERAL jsonb_each_text(ji.time_in_status) AS tis(status, secs)
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id
          AND psm.raw_status = tis.status
        WHERE psm.canonical_status IN ('IN_PROGRESS', 'IN_REVIEW', 'IN_QA')
          AND ji.completed_at IS NOT NULL
        GROUP BY ji.id, (ji.assignee_email = ${userEmail} OR ${userEmail} = ANY(ji.additional_assignee_emails))
      ),
      cohorts AS (
        SELECT
          CASE WHEN is_mine THEN 'Me' ELSE 'Org Average' END AS cohort,
          total_active_seconds
        FROM issue_cycle_times
      )
      SELECT
        cohort,
        COALESCE(ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_active_seconds) / 3600)::numeric, 1), 0) AS p50_hours
      FROM cohorts
      GROUP BY cohort
    `),

    db.execute(sql`
      SELECT
        ji.id,
        ji.jira_key,
        ji.summary,
        jp.name AS project_name,
        jp.jira_base_url,
        date_part('day', NOW() - ji.jira_updated_at)::int AS days_stale
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id
        AND psm.raw_status = ji.status
      WHERE psm.canonical_status NOT IN ('DONE', 'CANCELLED', 'BACKLOG')
        AND ji.jira_updated_at < NOW() - INTERVAL '3 days'
        AND (ji.assignee_email = ${userEmail} OR ${userEmail} = ANY(ji.additional_assignee_emails))
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
    personalHealth: {
      activeIssues,
      completedThisWeek,
      completedDelta: compDelta,
      slaViolations,
    },
    cycleTimeComparison: cycleTimeRes.rows,
    staleIssues: staleIssuesRes.rows,
  };
}

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";
import { subDays } from "date-fns";

export async function GET(request: Request) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const toDate = searchParams.get("to") ? new Date(searchParams.get("to")!) : new Date();
    const fromDate = searchParams.get("from")
      ? new Date(searchParams.get("from")!)
      : subDays(toDate, 30);

    // Prior period of equal length (for delta comparisons)
    const durationMs = toDate.getTime() - fromDate.getTime();
    const prevFromDate = new Date(fromDate.getTime() - durationMs);

    // Run all queries concurrently
    const [
      activeIssuesRes,
      completedInRangeRes,
      completedPriorRes,
      slaViolationsRes,
      unmappedWarningRes,
      projectsSyncedTodayRes,
      throughputRes,
      wipHeatmapRes,
      cycleTimeRes,
      staleIssuesRes,
      flowEfficiencyRes,
      slaTopRulesRes,
      devWorkloadRes,
      devVelocityRes,
      issueTypeMixRes,
    ] = await Promise.all([
      // Total active issues — always live
      db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM jira_issues ji
        JOIN jira_projects jp ON jp.id = ji.project_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
        WHERE psm.canonical_status NOT IN ('DONE', 'CANCELLED')
          AND jp.is_active = true
      `),

      // Completed in selected range
      db.execute(sql`
        SELECT COUNT(DISTINCT ji.id)::int AS count
        FROM jira_status_history jsh
        JOIN jira_issues ji ON ji.id = jsh.issue_id
        JOIN jira_projects jp ON jp.id = ji.project_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = jsh.to_status
        WHERE psm.canonical_status = 'DONE'
          AND jsh.changed_at >= ${fromDate}
          AND jsh.changed_at <= ${toDate}
          AND jp.is_active = true
      `),

      // Completed in prior period (same duration)
      db.execute(sql`
        SELECT COUNT(DISTINCT ji.id)::int AS count
        FROM jira_status_history jsh
        JOIN jira_issues ji ON ji.id = jsh.issue_id
        JOIN jira_projects jp ON jp.id = ji.project_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = jsh.to_status
        WHERE psm.canonical_status = 'DONE'
          AND jsh.changed_at >= ${prevFromDate}
          AND jsh.changed_at < ${fromDate}
          AND jp.is_active = true
      `),

      // Active SLA violations — always live
      db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM sla_violations sv
        JOIN sla_rules sr ON sr.id = sv.rule_id
        JOIN jira_projects jp ON jp.id = sr.project_id
        WHERE sv.resolved_at IS NULL
          AND jp.is_active = true
      `),

      // Projects with unmapped statuses — always live
      db.execute(sql`
        SELECT COUNT(DISTINCT ji.project_id)::int AS count
        FROM jira_issues ji
        JOIN jira_projects jp ON jp.id = ji.project_id
        LEFT JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
        WHERE psm.id IS NULL AND ji.status IS NOT NULL
          AND jp.is_active = true
      `),

      // Projects synced today — always live
      db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM jira_projects
        WHERE last_synced_at > NOW() - INTERVAL '24h' AND is_active = true
      `),

      // Throughput in selected range
      db.execute(sql`
        SELECT
          date_trunc('week', jsh.changed_at) AS week,
          ji.project_id,
          jp.name AS project_name,
          COUNT(DISTINCT ji.id)::int AS completed
        FROM jira_status_history jsh
        JOIN jira_issues ji ON ji.id = jsh.issue_id
        JOIN jira_projects jp ON jp.id = ji.project_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id
          AND psm.raw_status = jsh.to_status
        WHERE psm.canonical_status = 'DONE'
          AND jsh.changed_at >= ${fromDate}
          AND jsh.changed_at <= ${toDate}
          AND jp.is_active = true
        GROUP BY 1, 2, 3
        ORDER BY 1, 3
      `),

      // WIP Heatmap — always live
      db.execute(sql`
        SELECT
          ji.project_id,
          jp.name,
          psm.canonical_status,
          COUNT(*)::int AS issue_count
        FROM jira_issues ji
        JOIN jira_projects jp ON jp.id = ji.project_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id
          AND psm.raw_status = ji.status
        WHERE jp.is_active = true
        GROUP BY ji.project_id, jp.name, psm.canonical_status
      `),

      // Cycle Time in selected range
      db.execute(sql`
        WITH issue_cycle_times AS (
          SELECT
            ji.project_id,
            ji.id AS issue_id,
            SUM(jsh.duration_seconds) AS total_active_seconds
          FROM jira_status_history jsh
          JOIN jira_issues ji ON ji.id = jsh.issue_id
          JOIN project_status_mappings psm
            ON psm.project_id = ji.project_id
            AND psm.raw_status = jsh.to_status
          WHERE psm.canonical_status IN ('IN_PROGRESS', 'IN_REVIEW', 'IN_QA')
            AND jsh.duration_seconds IS NOT NULL
            AND jsh.changed_at >= ${fromDate}
            AND jsh.changed_at <= ${toDate}
          GROUP BY ji.project_id, ji.id
        )
        SELECT
          ict.project_id,
          jp.name AS project_name,
          COALESCE(ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_active_seconds) / 3600)::numeric, 1), 0) AS p50_hours,
          COALESCE(ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY total_active_seconds) / 3600)::numeric, 1), 0) AS p75_hours,
          COALESCE(ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY total_active_seconds) / 3600)::numeric, 1), 0) AS p90_hours
        FROM issue_cycle_times ict
        JOIN jira_projects jp ON jp.id = ict.project_id
        WHERE jp.is_active = true
        GROUP BY ict.project_id, jp.name
      `),

      // Stale Issues — fixed 7-day staleness threshold relative to now
      db.execute(sql`
        SELECT
          ji.project_id,
          jp.name,
          COUNT(*)::int AS stale_count
        FROM jira_issues ji
        JOIN jira_projects jp ON jp.id = ji.project_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id
          AND psm.raw_status = ji.status
        WHERE psm.canonical_status NOT IN ('DONE', 'CANCELLED')
          AND ji.jira_updated_at < NOW() - INTERVAL '7 days'
          AND jp.is_active = true
        GROUP BY ji.project_id, jp.name
      `),

      // Flow Efficiency in selected range
      db.execute(sql`
        WITH per_issue AS (
          SELECT
            ji.project_id,
            ji.id,
            SUM(CASE WHEN psm.canonical_status IN ('IN_PROGRESS','IN_REVIEW','IN_QA')
                    THEN jsh.duration_seconds ELSE 0 END) AS active_seconds,
            SUM(jsh.duration_seconds) AS total_seconds
          FROM jira_status_history jsh
          JOIN jira_issues ji ON ji.id = jsh.issue_id
          JOIN project_status_mappings psm
            ON psm.project_id = ji.project_id
            AND psm.raw_status = jsh.to_status
          WHERE jsh.duration_seconds IS NOT NULL
            AND jsh.changed_at >= ${fromDate}
            AND jsh.changed_at <= ${toDate}
          GROUP BY ji.project_id, ji.id
        )
        SELECT
          pi.project_id,
          jp.name AS project_name,
          COALESCE(ROUND(
            (100.0 * SUM(active_seconds) / NULLIF(SUM(total_seconds), 0))::numeric,
            1
          ), 0) AS flow_efficiency_pct
        FROM per_issue pi
        JOIN jira_projects jp ON jp.id = pi.project_id
        WHERE jp.is_active = true
        GROUP BY pi.project_id, jp.name
      `),

      // Top SLA rules in selected range
      db.execute(sql`
        SELECT
          sr.name AS rule_name,
          jp.name AS project_name,
          COUNT(*)::int AS trigger_count
        FROM sla_violations sv
        JOIN sla_rules sr ON sr.id = sv.rule_id
        JOIN jira_projects jp ON jp.id = sr.project_id
        WHERE sv.entered_condition_at >= ${fromDate}
          AND sv.entered_condition_at <= ${toDate}
          AND jp.is_active = true
        GROUP BY sr.id, jp.id
        ORDER BY trigger_count DESC
        LIMIT 5
      `),

      // Developer workload — always live (current active assignments)
      db.execute(sql`
        WITH dev_cycle AS (
          SELECT
            ji.assignee_name,
            PERCENTILE_CONT(0.5) WITHIN GROUP (
              ORDER BY sub.active_seconds
            ) AS p50_seconds
          FROM (
            SELECT
              ji2.assignee_name,
              ji2.id AS issue_id,
              SUM(CASE WHEN psm2.canonical_status IN ('IN_PROGRESS','IN_REVIEW','IN_QA')
                       THEN jsh.duration_seconds ELSE 0 END) AS active_seconds
            FROM jira_issues ji2
            JOIN jira_projects jp2 ON jp2.id = ji2.project_id
            JOIN jira_status_history jsh ON jsh.issue_id = ji2.id
            JOIN project_status_mappings psm2
              ON psm2.project_id = ji2.project_id AND psm2.raw_status = jsh.to_status
            WHERE ji2.assignee_name IS NOT NULL
              AND jsh.duration_seconds IS NOT NULL
              AND jp2.is_active = true
            GROUP BY ji2.assignee_name, ji2.id
            HAVING SUM(CASE WHEN psm2.canonical_status IN ('IN_PROGRESS','IN_REVIEW','IN_QA')
                            THEN jsh.duration_seconds ELSE 0 END) > 0
          ) sub
          JOIN jira_issues ji ON ji.assignee_name = sub.assignee_name AND ji.id = sub.issue_id
          GROUP BY ji.assignee_name
        )
        SELECT
          ji.assignee_name,
          COUNT(*)::int AS active_total,
          COUNT(CASE WHEN ji.priority = 'P1' THEN 1 END)::int AS p1,
          COUNT(CASE WHEN ji.priority = 'P2' THEN 1 END)::int AS p2,
          COUNT(CASE WHEN ji.priority = 'P3' THEN 1 END)::int AS p3,
          COUNT(CASE WHEN psm.canonical_status = 'IN_PROGRESS' THEN 1 END)::int AS in_progress,
          COUNT(CASE WHEN psm.canonical_status = 'IN_REVIEW' THEN 1 END)::int AS in_review,
          COUNT(CASE WHEN psm.canonical_status = 'IN_QA' THEN 1 END)::int AS in_qa,
          COALESCE(ROUND((dc.p50_seconds / 3600)::numeric, 1), 0) AS p50_cycle_hours
        FROM jira_issues ji
        JOIN jira_projects jp ON jp.id = ji.project_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
        LEFT JOIN dev_cycle dc ON dc.assignee_name = ji.assignee_name
        WHERE psm.canonical_status NOT IN ('DONE','CANCELLED')
          AND ji.assignee_name IS NOT NULL
          AND jp.is_active = true
        GROUP BY ji.assignee_name, dc.p50_seconds
        HAVING COUNT(*) >= 2
        ORDER BY p1 DESC, p2 DESC, active_total DESC
        LIMIT 30
      `),

      // Developer velocity — current range vs prior range
      db.execute(sql`
        WITH weekly AS (
          SELECT
            ji.assignee_name,
            COUNT(DISTINCT CASE WHEN jsh.changed_at >= ${fromDate} AND jsh.changed_at <= ${toDate}
                                THEN ji.id END)::int AS this_week,
            COUNT(DISTINCT CASE WHEN jsh.changed_at >= ${prevFromDate} AND jsh.changed_at < ${fromDate}
                                THEN ji.id END)::int AS last_week
          FROM jira_status_history jsh
          JOIN jira_issues ji ON ji.id = jsh.issue_id
          JOIN jira_projects jp ON jp.id = ji.project_id
          JOIN project_status_mappings psm
            ON psm.project_id = ji.project_id AND psm.raw_status = jsh.to_status
          WHERE psm.canonical_status = 'DONE'
            AND jsh.changed_at >= ${prevFromDate}
            AND jsh.changed_at <= ${toDate}
            AND ji.assignee_name IS NOT NULL
            AND jp.is_active = true
          GROUP BY ji.assignee_name
        )
        SELECT
          assignee_name,
          this_week,
          last_week,
          (this_week - last_week) AS delta
        FROM weekly
        WHERE this_week > 0 OR last_week > 0
        ORDER BY this_week DESC
        LIMIT 15
      `),

      // Active issue type mix — always live
      db.execute(sql`
        SELECT
          issue_type,
          COUNT(*)::int AS count,
          ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)::float AS pct
        FROM jira_issues ji
        JOIN jira_projects jp ON jp.id = ji.project_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
        WHERE psm.canonical_status NOT IN ('DONE','CANCELLED')
          AND jp.is_active = true
        GROUP BY issue_type
        ORDER BY count DESC
      `),
    ]);

    const activeIssues = Number(activeIssuesRes.rows[0]?.count || 0);
    const completedThisWeek = Number(completedInRangeRes.rows[0]?.count || 0);
    const completedLastWeek = Number(completedPriorRes.rows[0]?.count || 0);
    const slaViolations = Number(slaViolationsRes.rows[0]?.count || 0);
    const unmappedWarnings = Number(unmappedWarningRes.rows[0]?.count || 0);
    const projectsSyncedToday = Number(projectsSyncedTodayRes.rows[0]?.count || 0);

    let compDelta = 0;
    if (completedLastWeek > 0) {
      compDelta = Math.round(((completedThisWeek - completedLastWeek) / completedLastWeek) * 100);
    }

    return NextResponse.json({
      orgHealth: {
        activeIssues,
        completedThisWeek,
        completedDelta: compDelta,
        slaViolations,
        unmappedWarnings,
        projectsSyncedToday,
      },
      throughput: throughputRes.rows,
      wipHeatmap: wipHeatmapRes.rows,
      cycleTime: cycleTimeRes.rows,
      staleIssues: staleIssuesRes.rows,
      flowEfficiency: flowEfficiencyRes.rows,
      slaTopRules: slaTopRulesRes.rows,
      devWorkload: devWorkloadRes.rows,
      devVelocity: devVelocityRes.rows,
      issueTypeMix: issueTypeMixRes.rows,
    });
  } catch (error) {
    console.error("Dashboard analytics error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

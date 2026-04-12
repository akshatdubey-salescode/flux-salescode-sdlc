import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";

export async function GET() {
  try {
    await requireAuth();

    // Run all queries concurrently
    const [
      activeIssuesRes,
      completedThisWeekRes,
      completedLastWeekRes,
      slaViolationsRes,
      unmappedWarningRes,
      projectsSyncedTodayRes,
      throughputRes,
      wipHeatmapRes,
      cycleTimeRes,
      staleIssuesRes,
      flowEfficiencyRes,
      slaTopRulesRes,
    ] = await Promise.all([
      // Total active issues
      db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM jira_issues ji
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
        WHERE psm.canonical_status NOT IN ('DONE', 'CANCELLED')
      `),

      // Completed this week
      db.execute(sql`
        SELECT COUNT(DISTINCT ji.id)::int AS count
        FROM jira_status_history jsh
        JOIN jira_issues ji ON ji.id = jsh.issue_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = jsh.to_status
        WHERE psm.canonical_status = 'DONE'
          AND jsh.changed_at >= NOW() - INTERVAL '7 days'
      `),

      // Completed last week
      db.execute(sql`
        SELECT COUNT(DISTINCT ji.id)::int AS count
        FROM jira_status_history jsh
        JOIN jira_issues ji ON ji.id = jsh.issue_id
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = jsh.to_status
        WHERE psm.canonical_status = 'DONE'
          AND jsh.changed_at >= NOW() - INTERVAL '14 days'
          AND jsh.changed_at < NOW() - INTERVAL '7 days'
      `),

      // Active SLA violations
      db.execute(sql`
        SELECT COUNT(*)::int AS count FROM sla_violations WHERE resolved_at IS NULL
      `),

      // Projects with unmapped statuses
      db.execute(sql`
        SELECT COUNT(DISTINCT ji.project_id)::int AS count
        FROM jira_issues ji
        LEFT JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
        WHERE psm.id IS NULL AND ji.status IS NOT NULL
      `),

      // Projects synced today
      db.execute(sql`
        SELECT COUNT(*)::int AS count 
        FROM jira_projects 
        WHERE last_synced_at > NOW() - INTERVAL '24h' AND is_active = true
      `),

      // Throughput (Weekly)
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
          AND jsh.changed_at >= NOW() - INTERVAL '8 weeks'
        GROUP BY 1, 2, 3
        ORDER BY 1, 3
      `),

      // WIP Heatmap
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
        GROUP BY ji.project_id, jp.name, psm.canonical_status
      `),

      // Cycle Time
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
        GROUP BY ict.project_id, jp.name
      `),

      // Stale Issues (no update > 7 days)
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
        GROUP BY ji.project_id, jp.name
      `),

      // Flow Efficiency
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
        GROUP BY pi.project_id, jp.name
      `),

      // Top SLA Rules Violations
      db.execute(sql`
        SELECT
          sr.name AS rule_name,
          jp.name AS project_name,
          COUNT(*)::int AS trigger_count
        FROM sla_violations sv
        JOIN sla_rules sr ON sr.id = sv.rule_id
        JOIN jira_projects jp ON jp.id = sr.project_id
        WHERE sv.entered_condition_at >= NOW() - INTERVAL '30 days'
        GROUP BY sr.id, jp.id
        ORDER BY trigger_count DESC
        LIMIT 5
      `),
    ]);

    const activeIssues = activeIssuesRes.rows[0]?.count || 0;
    const completedThisWeek = completedThisWeekRes.rows[0]?.count || 0;
    const completedLastWeek = completedLastWeekRes.rows[0]?.count || 0;
    const slaViolations = slaViolationsRes.rows[0]?.count || 0;
    const unmappedWarnings = unmappedWarningRes.rows[0]?.count || 0;
    const projectsSyncedToday = projectsSyncedTodayRes.rows[0]?.count || 0;

    let compDelta = 0;
    if (completedLastWeek > 0) {
      compDelta = Math.round(((completedThisWeek as number) - (completedLastWeek as number)) / (completedLastWeek as number) * 100);
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
    });
  } catch (error) {
    console.error("Dashboard analytics error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

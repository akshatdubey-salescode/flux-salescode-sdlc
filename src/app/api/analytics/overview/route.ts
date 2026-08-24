import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { stampCache, withCacheMetrics } from "@/lib/cache/metrics";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";
import { fiscalQuarterOf, bucketNowForCache } from "@/lib/date-utils";

// ── Working-hours helpers (identical to dashboard / timeline routes) ──────────

function totalWorkingHours(startDate: string, dueDate: string): number {
  const days = Math.max(
    0,
    Math.round(
      (new Date(dueDate + "T00:00:00").getTime() -
        new Date(startDate + "T00:00:00").getTime()) /
        86_400_000
    ) + 1
  );
  return days * 9;
}

function workingHoursRemaining(nowStr: string, dueDate: string): number {
  if (nowStr >= dueDate + "T19:00:00") return 0;
  let hours = 0;
  const todayDate = nowStr.slice(0, 10);
  const todayStart = todayDate + "T10:00:00";
  const todayEnd = todayDate + "T19:00:00";
  if (nowStr < todayStart) {
    hours += 9;
  } else if (nowStr < todayEnd) {
    hours +=
      (new Date(todayEnd).getTime() - new Date(nowStr).getTime()) / 3_600_000;
  }
  const tomorrowMs = new Date(todayDate + "T00:00:00").getTime() + 86_400_000;
  const dueMs = new Date(dueDate + "T00:00:00").getTime();
  hours += Math.max(0, Math.round((dueMs - tomorrowMs) / 86_400_000) + 1) * 9;
  return hours;
}

function classifyActive(
  startDate: string,
  dueDate: string,
  nowStr: string
): "on_track" | "at_risk" | "overdue" {
  const today = nowStr.slice(0, 10);
  if (dueDate < today) return "overdue";
  const total = totalWorkingHours(startDate, dueDate);
  const remaining = workingHoursRemaining(nowStr, dueDate);
  if (total > 0 && remaining / total <= 0.2) return "at_risk";
  return "on_track";
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type IssueRow = {
  canonical_status: string;
  status_category: string | null;
  assignee_name: string | null;
  custom_fields: Record<string, unknown>;
  completed_at: string | null;
  jira_created_at: string | null;
  issue_type: string;
  project_id: string;
  project_name: string;
  end_date_field_ids: string[] | null;
  start_date_field_ids: string[] | null;
};

export type TopProject = {
  projectId: string;
  projectName: string;
  /** Active, scheduled issues due in the quarter — counted directly per issue, never per assignee. */
  workload: number;
};

export type OverviewResponse = {
  /** Fiscal quarter the whole dashboard is scoped to. */
  quarter: { start: string; end: string };
  kpis: {
    totalActive: number;
    activeWip: number;
    completed: number;
    completedDeltaPct: number | null;
    overdue: number;
    atRisk: number;
    onTimeRatePct: number | null;
    unplannedPct: number;
    unplanned: number;
  };
  flow: { week: string; completed: number; created: number }[];
  cycleTimeByType: { issueType: string; p50Hours: number }[];
  topProjects: TopProject[];
};

const WIP = new Set(["IN_PROGRESS", "IN_REVIEW", "IN_QA"]);

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await requireAuth();
    const url = new URL(request.url);
    const rawNow =
      url.searchParams.get("now") ?? new Date().toISOString().slice(0, 19);
    // Bucketed, because nowStr is part of fetchOverview's cache key.
    const nowStr = bucketNowForCache(rawNow);
    const today = nowStr.slice(0, 10);

    // Whole dashboard is scoped to a fiscal quarter; default to the current one.
    const dq = fiscalQuarterOf(today);
    const qStart = url.searchParams.get("ustart") ?? dq.start;
    const qEnd = url.searchParams.get("uend") ?? dq.end;

    const { data, headers } = await withCacheMetrics("overview", () =>
      fetchOverview(nowStr, qStart, qEnd)
    );
    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error("Overview analytics error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function fetchOverview(
  nowStr: string,
  qStart: string,
  qEnd: string
): Promise<ReturnType<typeof stampCache>> {
  // "use cache" alone is in-memory only, and on Fluid Compute each request
  // can land on a different instance, so it effectively never hit -- every
  // request paid the full query cost. "remote" stores the entry in the shared
  // cache handler Vercel provides, so it is reused across instances.
  "use cache: remote";
  cacheLife("minutes");
  cacheTag("jira-issues", "overview");

  // Prior fiscal quarter, for the completed-throughput delta.
  const prior = fiscalQuarterOf(addDays(qStart, -1));
  const priorQStart = prior.start;
  const priorQEnd = prior.end;
  // Exclusive upper bound for timestamp comparisons (qEnd is an inclusive date).
  const qEndExclusive = addDays(qEnd, 1);

  const [issuesRes, flowRes, cycleRes] = await Promise.all([
    // A — issue-level fetch for KPIs + project health (app-code classification).
    // Open issues (any age) plus anything completed since the prior quarter
    // start, so we can compute this quarter's + last quarter's throughput.
    db.execute(sql`
      SELECT
        psm.canonical_status,
        ji.status_category,
        ji.assignee_name,
        ji.custom_fields,
        ji.completed_at,
        ji.jira_created_at,
        ji.issue_type,
        jp.id            AS project_id,
        jp.name          AS project_name,
        jp.end_date_field_ids,
        jp.start_date_field_ids
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE jp.is_active = true
        AND (
          NOT (
            lower(ji.status_category) = 'done'
            OR lower(ji.status_category) LIKE '%complete%'
            OR lower(ji.status_category) LIKE '%closed%'
          )
          OR ji.completed_at >= ${priorQStart}
        )
    `),

    // B — weekly created vs completed flow across the selected quarter
    db.execute(sql`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', ${qStart}::date),
          date_trunc('week', ${qEnd}::date),
          INTERVAL '1 week'
        ) AS week
      ),
      completed AS (
        SELECT date_trunc('week', ji.completed_at) AS week, COUNT(*)::int AS n
        FROM jira_issues ji
        JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
        WHERE ji.completed_at >= date_trunc('week', ${qStart}::date)
          AND ji.completed_at < ${qEndExclusive}::date
        GROUP BY 1
      ),
      created AS (
        SELECT date_trunc('week', ji.jira_created_at) AS week, COUNT(*)::int AS n
        FROM jira_issues ji
        JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
        WHERE ji.jira_created_at >= date_trunc('week', ${qStart}::date)
          AND ji.jira_created_at < ${qEndExclusive}::date
        GROUP BY 1
      )
      SELECT
        to_char(w.week, 'YYYY-MM-DD') AS week,
        COALESCE(c.n, 0) AS completed,
        COALESCE(cr.n, 0) AS created
      FROM weeks w
      LEFT JOIN completed c  ON c.week = w.week
      LEFT JOIN created cr   ON cr.week = w.week
      ORDER BY w.week
    `),

    // C — org-wide cycle time (p50 active hours) by issue type, completed in quarter
    db.execute(sql`
      WITH issue_cycle_times AS (
        SELECT
          ji.issue_type,
          ji.id AS issue_id,
          SUM(tis.secs::numeric) AS total_active_seconds
        FROM jira_issues ji
        CROSS JOIN LATERAL jsonb_each_text(ji.time_in_status) AS tis(status, secs)
        JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = tis.status
        WHERE psm.canonical_status IN ('IN_PROGRESS', 'IN_REVIEW', 'IN_QA')
          AND ji.completed_at IS NOT NULL
          AND ji.completed_at >= ${qStart}
          AND ji.completed_at < ${qEndExclusive}::date
        GROUP BY ji.issue_type, ji.id
      )
      SELECT
        issue_type,
        COALESCE(ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_active_seconds) / 3600)::numeric, 1), 0) AS p50_hours,
        COUNT(*)::int AS n
      FROM issue_cycle_times
      GROUP BY issue_type
      HAVING COUNT(*) >= 3
      ORDER BY p50_hours DESC
      LIMIT 6
    `),
  ]);

  // ── App-code classification over issue rows ──────────────────────────────────
  // Everything is scoped to the selected quarter:
  //  • Completed / on-time / cycle  → completed_at within the quarter
  //  • Active / overdue / at-risk   → OPEN issues whose due date falls in the quarter
  //  • Unplanned                    → OPEN issues created in the quarter, missing dates
  let totalActive = 0;
  let activeWip = 0;
  let overdue = 0;
  let atRisk = 0;
  let unplanned = 0;
  let completedInQ = 0;
  let completedPriorQ = 0;
  let onTimeNum = 0;
  let onTimeDenom = 0;

  const projectMap = new Map<string, TopProject>();
  const ensureProject = (row: IssueRow): TopProject => {
    let p = projectMap.get(row.project_id);
    if (!p) {
      p = {
        projectId: row.project_id,
        projectName: row.project_name,
        workload: 0,
      };
      projectMap.set(row.project_id, p);
    }
    return p;
  };

  for (const raw of issuesRes.rows as IssueRow[]) {
    const cs = raw.canonical_status;
    if (cs === "CANCELLED") continue;

    const cat = (raw.status_category ?? "").toLowerCase();
    const isDone =
      cat === "done" || cat.includes("complete") || cat.includes("closed");

    const cf = (raw.custom_fields as Record<string, unknown>) ?? {};
    const dueDate = extractDueDate(cf, raw.end_date_field_ids);

    if (isDone) {
      const completedDate = raw.completed_at?.slice(0, 10);
      if (!completedDate) continue;
      if (completedDate >= qStart && completedDate <= qEnd) {
        completedInQ++;
        // On-time delivery among issues completed this quarter that had a due date
        if (dueDate) {
          onTimeDenom++;
          if (completedDate <= dueDate) onTimeNum++;
        }
      } else if (completedDate >= priorQStart && completedDate <= priorQEnd) {
        completedPriorQ++;
      }
      continue;
    }

    // Open (non-done, non-cancelled)
    const startDate = extractStartDate(cf, raw.start_date_field_ids);
    const createdDate = raw.jira_created_at?.slice(0, 10) ?? null;

    // Unplanned: missing start or due date, created within the quarter
    if (!startDate || !dueDate) {
      if (createdDate && createdDate >= qStart && createdDate <= qEnd) unplanned++;
      continue;
    }

    // Only count open work whose deadline falls in the selected quarter
    if (dueDate < qStart || dueDate > qEnd) continue;

    const proj = ensureProject(raw);
    totalActive++;
    proj.workload++;
    if (WIP.has(cs)) activeWip++;

    const label = classifyActive(startDate, dueDate, nowStr);
    if (label === "overdue") {
      overdue++;
    } else if (label === "at_risk") {
      atRisk++;
    }
  }

  const completedDeltaPct =
    completedPriorQ > 0
      ? Math.round(((completedInQ - completedPriorQ) / completedPriorQ) * 100)
      : null;

  const onTimeRatePct =
    onTimeDenom > 0 ? Math.round((onTimeNum / onTimeDenom) * 100) : null;

  const plannedTotal = totalActive + unplanned;
  const unplannedPct =
    plannedTotal > 0 ? Math.round((unplanned / plannedTotal) * 100) : 0;

  // Top projects by raw active workload (per issue, never per assignee).
  const topProjects = Array.from(projectMap.values())
    .filter((p) => p.workload > 0)
    .sort(
      (a, b) =>
        b.workload - a.workload || a.projectName.localeCompare(b.projectName)
    )
    .slice(0, 10);

  // 12-week skeleton is generated by SQL (generate_series), so the series is dense
  const flow = (flowRes.rows as { week: string; completed: number; created: number }[]).map(
    (r) => ({
      week: r.week,
      completed: Number(r.completed),
      created: Number(r.created),
    })
  );

  const response: OverviewResponse = {
    quarter: { start: qStart, end: qEnd },
    kpis: {
      totalActive,
      activeWip,
      completed: completedInQ,
      completedDeltaPct,
      overdue,
      atRisk,
      onTimeRatePct,
      unplannedPct,
      unplanned,
    },
    flow,
    cycleTimeByType: (cycleRes.rows as { issue_type: string; p50_hours: string }[]).map(
      (r) => ({ issueType: r.issue_type, p50Hours: Number(r.p50_hours) })
    ),
    topProjects,
  };

  return stampCache(response);
}

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { stampCache, withCacheMetrics } from "@/lib/cache/metrics";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";

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
  issue_type: string;
  project_id: string;
  project_name: string;
  end_date_field_ids: string[] | null;
  start_date_field_ids: string[] | null;
};

export type ProjectHealth = {
  projectId: string;
  projectName: string;
  active: number;
  overdue: number;
  atRisk: number;
  onTrack: number;
  completed30d: number;
  riskScore: number;
  health: "healthy" | "watch" | "critical";
};

export type OverviewResponse = {
  kpis: {
    totalActive: number;
    activeWip: number;
    completed30d: number;
    completedDeltaPct: number | null;
    overdue: number;
    atRisk: number;
    onTimeRatePct: number | null;
    unplannedPct: number;
    unplanned: number;
  };
  flow: { week: string; completed: number; created: number }[];
  cycleTimeByType: { issueType: string; p50Hours: number }[];
  projectHealth: ProjectHealth[];
  staleWip: {
    id: string;
    jiraKey: string;
    summary: string;
    assigneeName: string | null;
    projectName: string;
    daysStale: number;
    jiraBaseUrl: string;
  }[];
};

const WIP = new Set(["IN_PROGRESS", "IN_REVIEW", "IN_QA"]);

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await requireAuth();
    const url = new URL(request.url);
    const rawNow =
      url.searchParams.get("now") ?? new Date().toISOString().slice(0, 19);
    const nowStr = rawNow.slice(0, 16) + ":00";

    const { data, headers } = await withCacheMetrics("overview", () =>
      fetchOverview(nowStr)
    );
    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error("Overview analytics error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function fetchOverview(nowStr: string): Promise<ReturnType<typeof stampCache>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues", "overview");

  const today = nowStr.slice(0, 10);
  const d30 = addDays(today, -30);
  const d60 = addDays(today, -60);
  const d90 = addDays(today, -90);

  const [issuesRes, flowRes, cycleRes, staleRes] = await Promise.all([
    // A — issue-level fetch for KPIs + project health (app-code classification)
    db.execute(sql`
      SELECT
        psm.canonical_status,
        ji.status_category,
        ji.assignee_name,
        ji.custom_fields,
        ji.completed_at,
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
          OR ji.completed_at >= ${d90}
        )
    `),

    // B — weekly created vs completed flow, last 12 weeks
    db.execute(sql`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', NOW()) - INTERVAL '11 weeks',
          date_trunc('week', NOW()),
          INTERVAL '1 week'
        ) AS week
      ),
      completed AS (
        SELECT date_trunc('week', ji.completed_at) AS week, COUNT(*)::int AS n
        FROM jira_issues ji
        JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
        WHERE ji.completed_at >= date_trunc('week', NOW()) - INTERVAL '11 weeks'
        GROUP BY 1
      ),
      created AS (
        SELECT date_trunc('week', ji.jira_created_at) AS week, COUNT(*)::int AS n
        FROM jira_issues ji
        JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
        WHERE ji.jira_created_at >= date_trunc('week', NOW()) - INTERVAL '11 weeks'
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

    // C — org-wide cycle time (p50 active hours) by issue type
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
          AND ji.completed_at >= ${d90}
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

    // D — oldest stuck WIP org-wide (bottleneck signal)
    db.execute(sql`
      SELECT
        ji.id,
        ji.jira_key,
        ji.summary,
        ji.assignee_name,
        jp.name AS project_name,
        jp.jira_base_url,
        date_part('day', NOW() - ji.jira_updated_at)::int AS days_stale
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
      JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE psm.canonical_status IN ('IN_PROGRESS', 'IN_REVIEW', 'IN_QA')
        AND ji.jira_updated_at < NOW() - INTERVAL '7 days'
      ORDER BY days_stale DESC
      LIMIT 8
    `),
  ]);

  // ── App-code classification over issue rows ──────────────────────────────────
  let totalActive = 0;
  let activeWip = 0;
  let overdue = 0;
  let atRisk = 0;
  let unplanned = 0;
  let completed30d = 0;
  let completedPrior30d = 0;
  let onTimeNum = 0;
  let onTimeDenom = 0;

  const projectMap = new Map<string, ProjectHealth>();
  const ensureProject = (row: IssueRow): ProjectHealth => {
    let p = projectMap.get(row.project_id);
    if (!p) {
      p = {
        projectId: row.project_id,
        projectName: row.project_name,
        active: 0,
        overdue: 0,
        atRisk: 0,
        onTrack: 0,
        completed30d: 0,
        riskScore: 0,
        health: "healthy",
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
      const proj = ensureProject(raw);
      if (completedDate >= d30) {
        completed30d++;
        proj.completed30d++;
      } else if (completedDate >= d60 && completedDate < d30) {
        completedPrior30d++;
      }
      // On-time delivery rate over the last 90 days (issues that had a due date)
      if (completedDate >= d90 && dueDate) {
        onTimeDenom++;
        if (completedDate <= dueDate) onTimeNum++;
      }
      continue;
    }

    // Active (non-done, non-cancelled)
    const proj = ensureProject(raw);
    totalActive++;
    proj.active++;
    if (WIP.has(cs)) activeWip++;

    const startDate = extractStartDate(cf, raw.start_date_field_ids);
    if (!startDate || !dueDate) {
      unplanned++;
      continue;
    }

    const label = classifyActive(startDate, dueDate, nowStr);
    if (label === "overdue") {
      overdue++;
      proj.overdue++;
    } else if (label === "at_risk") {
      atRisk++;
      proj.atRisk++;
    } else {
      proj.onTrack++;
    }
  }

  const completedDeltaPct =
    completedPrior30d > 0
      ? Math.round(((completed30d - completedPrior30d) / completedPrior30d) * 100)
      : null;

  const onTimeRatePct =
    onTimeDenom > 0 ? Math.round((onTimeNum / onTimeDenom) * 100) : null;

  const unplannedPct =
    totalActive > 0 ? Math.round((unplanned / totalActive) * 100) : 0;

  // Project health scoring
  const projectHealth = Array.from(projectMap.values())
    .map((p) => {
      const riskScore = p.overdue * 2 + p.atRisk;
      let health: ProjectHealth["health"] = "healthy";
      if (p.overdue >= 3 || riskScore >= 8) health = "critical";
      else if (riskScore > 0) health = "watch";
      return { ...p, riskScore, health };
    })
    .filter((p) => p.active > 0 || p.completed30d > 0)
    .sort(
      (a, b) =>
        b.riskScore - a.riskScore ||
        b.active - a.active ||
        a.projectName.localeCompare(b.projectName)
    );

  // 12-week skeleton is generated by SQL (generate_series), so the series is dense
  const flow = (flowRes.rows as { week: string; completed: number; created: number }[]).map(
    (r) => ({
      week: r.week,
      completed: Number(r.completed),
      created: Number(r.created),
    })
  );

  const response: OverviewResponse = {
    kpis: {
      totalActive,
      activeWip,
      completed30d,
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
    projectHealth,
    staleWip: (
      staleRes.rows as {
        id: string;
        jira_key: string;
        summary: string;
        assignee_name: string | null;
        project_name: string;
        jira_base_url: string;
        days_stale: number;
      }[]
    ).map((r) => ({
      id: r.id,
      jiraKey: r.jira_key,
      summary: r.summary,
      assigneeName: r.assignee_name,
      projectName: r.project_name,
      jiraBaseUrl: r.jira_base_url,
      daysStale: Number(r.days_stale),
    })),
  };

  return stampCache(response);
}

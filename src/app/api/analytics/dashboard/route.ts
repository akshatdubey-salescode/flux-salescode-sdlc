import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { stampCache, withCacheMetrics } from "@/lib/cache/metrics";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";

// ── Working-hours helpers (identical to timeline route) ───────────────────────

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
  const tomorrowMs =
    new Date(todayDate + "T00:00:00").getTime() + 86_400_000;
  const dueMs = new Date(dueDate + "T00:00:00").getTime();
  hours +=
    Math.max(0, Math.round((dueMs - tomorrowMs) / 86_400_000) + 1) * 9;
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

// ── Types ─────────────────────────────────────────────────────────────────────

type IssueRow = {
  canonical_status: string;
  status_category: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  additional_assignee_emails: string[] | null;
  custom_fields: Record<string, unknown>;
  jira_created_at: string | null;
  completed_at: string | null;
  project_id: string;
  project_name: string;
  end_date_field_ids: string[] | null;
  start_date_field_ids: string[] | null;
};

/**
 * Number of project members actively working an issue — its primary assignee
 * plus anyone in the multi-assignee picker, deduped and restricted to people
 * who assign work in this project (mirrors the Team Tracking timeline route's
 * member_issue_emails CTE). An issue with N assignees counts N times toward
 * workload; an unassigned issue counts zero.
 */
function effectiveSeatCount(
  row: IssueRow,
  members: Set<string> | undefined
): number {
  if (!members || members.size === 0) return 0;
  const seats = new Set<string>();
  const primary = row.assignee_email?.trim().toLowerCase();
  if (primary && members.has(primary)) seats.add(primary);
  for (const ae of row.additional_assignee_emails ?? []) {
    const e = ae?.trim().toLowerCase();
    if (e && members.has(e)) seats.add(e);
  }
  return seats.size;
}

export type ProjectSummary = {
  projectId: string;
  projectName: string;
  /** Open issues spanning the filter window, counted per assignee working them */
  workload: number;
  /** workload + overdue, per assignee */
  active: number;
  /** workload seats with >20% working time remaining */
  onTrack: number;
  /** workload seats with ≤20% working time remaining */
  atRisk: number;
  /** assigned issues not done/cancelled with due date in the past, per assignee */
  overdue: number;
  /** done issues with completed_at in the filter window */
  completed: number;
  /** active issues missing start or due date, scoped to quarter filter */
  unplanned: number;
  /** non-done, non-cancelled issues with no assignee */
  unassigned: number;
};

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await requireAuth();
    const url = new URL(request.url);

    const rawNow =
      url.searchParams.get("now") ?? new Date().toISOString().slice(0, 19);
    const nowStr = rawNow.slice(0, 16) + ":00"; // bucket to minute for stable cache key
    const today = nowStr.slice(0, 10);

    const singleDate = url.searchParams.get("date");
    const filterStart = url.searchParams.get("start") ?? singleDate ?? today;
    const filterEnd = url.searchParams.get("end") ?? singleDate ?? today;
    const uFilterStart = url.searchParams.get("ustart") ?? null;
    const uFilterEnd = url.searchParams.get("uend") ?? null;

    const { data, headers } = await withCacheMetrics("dashboard", () =>
      fetchProjectWorkload(
        filterStart,
        filterEnd,
        nowStr,
        uFilterStart,
        uFilterEnd
      )
    );
    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error("Dashboard analytics error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function fetchProjectWorkload(
  filterStart: string,
  filterEnd: string,
  nowStr: string,
  uFilterStart: string | null,
  uFilterEnd: string | null
) {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues", "dashboard");

  const today = nowStr.slice(0, 10);

  // Active issues + done issues completed in the last 90 days
  const completedFrom = new Date(today + "T00:00:00");
  completedFrom.setDate(completedFrom.getDate() - 90);
  const completedFromIso = completedFrom.toISOString().slice(0, 10);

  const issuesRes = await db.execute(sql`
    SELECT
      psm.canonical_status,
      ji.status_category,
      ji.assignee_name,
      ji.assignee_email,
      ji.additional_assignee_emails,
      ji.custom_fields,
      ji.jira_created_at,
      ji.completed_at,
      jp.id            AS project_id,
      jp.name          AS project_name,
      jp.end_date_field_ids,
      jp.start_date_field_ids
    FROM jira_issues ji
    JOIN jira_projects jp  ON jp.id = ji.project_id
    JOIN project_status_mappings psm
      ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
    WHERE jp.is_active = true
      AND (
        -- Use status_category to match timeline route's "done" detection exactly
        NOT (
          lower(ji.status_category) = 'done'
          OR lower(ji.status_category) LIKE '%complete%'
          OR lower(ji.status_category) LIKE '%closed%'
        )
        OR ji.completed_at >= ${completedFromIso}
      )
    ORDER BY jp.name
  `);

  // Project members = everyone who is a primary assignee somewhere in the
  // project. Workload seats are counted only for these people, so a multi-
  // assignee picker entry for a non-member doesn't inflate the count — matching
  // the Team Tracking timeline route exactly.
  const membersRes = await db.execute(sql`
    SELECT DISTINCT ji.project_id, lower(ji.assignee_email) AS email
    FROM jira_issues ji
    JOIN jira_projects jp ON jp.id = ji.project_id
    WHERE jp.is_active = true
      AND ji.assignee_email IS NOT NULL
      AND ji.assignee_email != ''
  `);

  const memberSet = new Map<string, Set<string>>();
  for (const r of membersRes.rows as { project_id: string; email: string }[]) {
    let s = memberSet.get(r.project_id);
    if (!s) {
      s = new Set<string>();
      memberSet.set(r.project_id, s);
    }
    s.add(r.email);
  }

  const projectMap = new Map<string, ProjectSummary>();

  for (const raw of issuesRes.rows as IssueRow[]) {
    if (!projectMap.has(raw.project_id)) {
      projectMap.set(raw.project_id, {
        projectId: raw.project_id,
        projectName: raw.project_name,
        workload: 0,
        active: 0,
        onTrack: 0,
        atRisk: 0,
        overdue: 0,
        completed: 0,
        unplanned: 0,
        unassigned: 0,
      });
    }
    const proj = projectMap.get(raw.project_id)!;
    const cs = raw.canonical_status;

    // Cancelled: skip entirely (canonical mapping is authoritative for this)
    if (cs === "CANCELLED") continue;

    // Done: same status_category check as the timeline route's classifyIssue
    const cat = (raw.status_category ?? "").toLowerCase();
    const isDoneStatus = cat === "done" || cat.includes("complete") || cat.includes("closed");
    if (isDoneStatus) {
      const completedDate = raw.completed_at?.slice(0, 10);
      if (cs === "DONE" && completedDate && completedDate >= filterStart && completedDate <= filterEnd) {
        proj.completed++;
      }
      continue;
    }

    // Non-done, non-cancelled from here on
    // Unassigned: no assignee at all (mirrors project Team Tracking tab)
    if (!raw.assignee_name) proj.unassigned++;

    const cf = (raw.custom_fields as Record<string, unknown>) ?? {};
    const startDate = extractStartDate(cf, raw.start_date_field_ids);
    const dueDate = extractDueDate(cf, raw.end_date_field_ids);

    // Unplanned: missing start or due date
    if (!startDate || !dueDate) {
      if (uFilterStart && uFilterEnd) {
        if (!raw.jira_created_at) continue;
        const createdDate = raw.jira_created_at.slice(0, 10);
        if (createdDate >= uFilterStart && createdDate <= uFilterEnd) {
          proj.unplanned++;
        }
      } else {
        proj.unplanned++;
      }
      continue;
    }

    // Per-assignee counting: an issue counts once for each project member
    // working it (multi-assignee counted per person); unassigned issues have
    // zero seats and so never enter workload/active/overdue.
    const seats = effectiveSeatCount(raw, memberSet.get(raw.project_id));

    // Classify by date
    const label = classifyActive(startDate, dueDate, nowStr);

    if (label === "overdue") {
      // Exclude if due date predates the quarter start (same guard as timeline route)
      if (uFilterStart && dueDate < uFilterStart) continue;
      proj.overdue += seats;
      proj.active += seats;
      continue;
    }

    // Workload: issue must overlap the filter date window
    if (startDate > filterEnd || dueDate < filterStart) continue;

    if (label === "on_track") {
      proj.onTrack += seats;
      proj.workload += seats;
      proj.active += seats;
    } else if (label === "at_risk") {
      proj.atRisk += seats;
      proj.workload += seats;
      proj.active += seats;
    }
  }

  const projects = Array.from(projectMap.values())
    .filter(
      (p) =>
        p.workload > 0 ||
        p.active > 0 ||
        p.overdue > 0 ||
        p.unplanned > 0 ||
        p.unassigned > 0
    )
    .sort(
      (a, b) =>
        b.active - a.active ||
        b.workload - a.workload ||
        a.projectName.localeCompare(b.projectName)
    );

  return stampCache({ projects });
}

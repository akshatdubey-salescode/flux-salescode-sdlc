import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { stampCache, withCacheMetrics } from "@/lib/cache/metrics";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";
import { fiscalQuarterOf } from "@/lib/date-utils";

// ── Working-hours helpers (identical to the overview route) ───────────────────

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
    hours += (new Date(todayEnd).getTime() - new Date(nowStr).getTime()) / 3_600_000;
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

// ── Types ─────────────────────────────────────────────────────────────────────

export type OverviewBucket =
  | "active"
  | "overdue"
  | "at_risk"
  | "on_track"
  | "unplanned";

type IssueRow = {
  id: string;
  jira_key: string;
  summary: string;
  status: string;
  assignee_name: string | null;
  status_category: string | null;
  canonical_status: string;
  custom_fields: Record<string, unknown>;
  jira_created_at: string | null;
  project_name: string;
  jira_base_url: string;
  end_date_field_ids: string[] | null;
  start_date_field_ids: string[] | null;
};

export type OverviewIssue = {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  assigneeName: string | null;
  projectName: string;
  jiraUrl: string;
  dueDate: string | null;
  label: OverviewBucket;
  /** Negative = overdue by N days, positive = N days remaining, null = unplanned. */
  daysToDue: number | null;
};

export type OverviewIssuesResponse = { issues: OverviewIssue[]; truncated: boolean };

const MAX_ISSUES = 500;

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await requireAuth();
    const url = new URL(request.url);
    const rawNow =
      url.searchParams.get("now") ?? new Date().toISOString().slice(0, 19);
    const nowStr = rawNow.slice(0, 16) + ":00";
    const today = nowStr.slice(0, 10);

    const bucket = (url.searchParams.get("bucket") ?? "active") as OverviewBucket;
    const dq = fiscalQuarterOf(today);
    const qStart = url.searchParams.get("ustart") ?? dq.start;
    const qEnd = url.searchParams.get("uend") ?? dq.end;

    const { data, headers } = await withCacheMetrics("overview-issues", () =>
      fetchBucketIssues(nowStr, qStart, qEnd, bucket)
    );
    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error("Overview issues error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchBucketIssues(
  nowStr: string,
  qStart: string,
  qEnd: string,
  bucket: OverviewBucket
): Promise<ReturnType<typeof stampCache>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues", "overview");

  const today = nowStr.slice(0, 10);

  const res = await db.execute(sql`
    SELECT
      ji.id,
      ji.jira_key,
      ji.summary,
      ji.status,
      ji.assignee_name,
      ji.status_category,
      psm.canonical_status,
      ji.custom_fields,
      ji.jira_created_at,
      jp.name AS project_name,
      jp.jira_base_url,
      jp.end_date_field_ids,
      jp.start_date_field_ids
    FROM jira_issues ji
    JOIN jira_projects jp ON jp.id = ji.project_id
    JOIN project_status_mappings psm
      ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
    WHERE jp.is_active = true
      AND NOT (
        lower(ji.status_category) = 'done'
        OR lower(ji.status_category) LIKE '%complete%'
        OR lower(ji.status_category) LIKE '%closed%'
      )
  `);

  const issues: OverviewIssue[] = [];

  for (const raw of res.rows as IssueRow[]) {
    if (raw.canonical_status === "CANCELLED") continue;

    const cf = (raw.custom_fields as Record<string, unknown>) ?? {};
    const dueDate = extractDueDate(cf, raw.end_date_field_ids);
    const startDate = extractStartDate(cf, raw.start_date_field_ids);

    const base = {
      id: raw.id,
      jiraKey: raw.jira_key,
      summary: raw.summary,
      status: raw.status,
      assigneeName: raw.assignee_name,
      projectName: raw.project_name,
      jiraUrl: `${raw.jira_base_url.replace(/\/$/, "")}/browse/${raw.jira_key}`,
    };

    // Unplanned: missing start or due, created within the quarter
    if (!startDate || !dueDate) {
      if (bucket !== "unplanned") continue;
      const createdDate = raw.jira_created_at?.slice(0, 10) ?? null;
      if (!createdDate || createdDate < qStart || createdDate > qEnd) continue;
      issues.push({ ...base, dueDate: null, label: "unplanned", daysToDue: null });
      continue;
    }

    // Only open work due in the selected quarter
    if (dueDate < qStart || dueDate > qEnd) continue;

    const label = classifyActive(startDate, dueDate, nowStr);
    const match =
      bucket === "active"
        ? true
        : bucket === "unplanned"
        ? false
        : label === bucket;
    if (!match) continue;

    const daysToDue = Math.round(
      (new Date(dueDate + "T00:00:00").getTime() -
        new Date(today + "T00:00:00").getTime()) /
        86_400_000
    );
    issues.push({ ...base, dueDate, label, daysToDue });
  }

  // Most urgent first: overdue (most negative) → soonest due.
  issues.sort((a, b) => {
    if (a.daysToDue == null) return b.daysToDue == null ? 0 : 1;
    if (b.daysToDue == null) return -1;
    return a.daysToDue - b.daysToDue;
  });

  const truncated = issues.length > MAX_ISSUES;
  return stampCache({ issues: issues.slice(0, MAX_ISSUES), truncated });
}

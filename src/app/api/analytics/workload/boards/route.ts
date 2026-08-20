import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { stampCache, withCacheMetrics } from "@/lib/cache/metrics";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { bucketNowForCache } from "@/lib/date-utils";

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
  issue_id: string;
  effective_email: string;
  canonical_status: string;
  status_category: string | null;
  custom_fields: Record<string, unknown>;
  jira_created_at: string | null;
  completed_at: string | null;
  end_date_field_ids: string[] | null;
  start_date_field_ids: string[] | null;
};

export type BoardSummary = {
  boardId: string;
  boardName: string;
  memberCount: number;
  workload: number;
  active: number;
  onTrack: number;
  atRisk: number;
  overdue: number;
  completed: number;
  unplanned: number;
};

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await requireAuth();
    const url = new URL(request.url);

    const rawNow =
      url.searchParams.get("now") ?? new Date().toISOString().slice(0, 19);
    // Bucketed, because nowStr is part of fetchBoardWorkload's cache key.
    const nowStr = bucketNowForCache(rawNow);
    const today = nowStr.slice(0, 10);

    const singleDate = url.searchParams.get("date");
    const filterStart = url.searchParams.get("start") ?? singleDate ?? today;
    const filterEnd = url.searchParams.get("end") ?? singleDate ?? today;
    const uFilterStart = url.searchParams.get("ustart") ?? null;
    const uFilterEnd = url.searchParams.get("uend") ?? null;

    const { data, headers } = await withCacheMetrics("workload-boards", () =>
      fetchBoardWorkload(filterStart, filterEnd, nowStr, uFilterStart, uFilterEnd)
    );
    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error("Board workload analytics error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function fetchBoardWorkload(
  filterStart: string,
  filterEnd: string,
  nowStr: string,
  uFilterStart: string | null,
  uFilterEnd: string | null
) {
  // See the note in analytics/overview: plain "use cache" is in-memory only and
  // never survived between serverless instances, so this recomputed every time.
  "use cache: remote";
  cacheLife("minutes");
  cacheTag("jira-issues", "observer-boards", "workload-boards");

  // Load all boards and their members
  const [allBoards, allMembers] = await Promise.all([
    db.select().from(observerBoards),
    db.select().from(observerBoardMembers),
  ]);

  if (allBoards.length === 0) return stampCache({ boards: [] });

  // Build board → email set and email → boardIds mappings
  const boardEmailMap = new Map<string, Set<string>>();
  for (const board of allBoards) {
    const emails = new Set<string>();
    if (board.managerEmail) emails.add(board.managerEmail.toLowerCase());
    boardEmailMap.set(board.id, emails);
  }
  for (const member of allMembers) {
    const emails = boardEmailMap.get(member.boardId);
    if (emails) emails.add(member.email.toLowerCase());
  }

  // Collect all unique emails across all boards
  const allEmails = new Set<string>();
  for (const emails of boardEmailMap.values()) {
    for (const e of emails) allEmails.add(e);
  }

  if (allEmails.size === 0) return stampCache({ boards: [] });

  const emailList = [...allEmails];
  const emailsIn = sql.join(
    emailList.map((e) => sql`${e}`),
    sql`, `
  );

  // email → boardIds reverse mapping
  const emailBoardMap = new Map<string, string[]>();
  for (const [boardId, emails] of boardEmailMap.entries()) {
    for (const email of emails) {
      const boards = emailBoardMap.get(email) ?? [];
      boards.push(boardId);
      emailBoardMap.set(email, boards);
    }
  }

  const today = nowStr.slice(0, 10);
  const completedFrom = new Date(today + "T00:00:00");
  completedFrom.setDate(completedFrom.getDate() - 90);
  const completedFromIso = completedFrom.toISOString().slice(0, 10);

  // Fetch all relevant issues for board members (primary + additional assignees)
  const issuesRes = await db.execute(sql`
    WITH issue_emails AS (
      SELECT ji.id, lower(ji.assignee_email) AS effective_email
      FROM jira_issues ji
      WHERE lower(ji.assignee_email) IN (${emailsIn})
      -- UNION ALL, not UNION: an issue that lists the same person as both primary
      -- and additional assignee yields two rows, but boardSeenIssues already
      -- dedupes per board, so the distinct sort over the whole set was wasted work.
      UNION ALL
      SELECT ji.id, lower(ae) AS effective_email
      FROM jira_issues ji
      CROSS JOIN LATERAL unnest(ji.additional_assignee_emails) AS ae
      WHERE lower(ae) IN (${emailsIn})
    )
    SELECT
      ie.id            AS issue_id,
      ie.effective_email,
      psm.canonical_status,
      ji.status_category,
      ji.custom_fields,
      ji.jira_created_at,
      ji.completed_at,
      jp.end_date_field_ids,
      jp.start_date_field_ids
    FROM issue_emails ie
    JOIN jira_issues ji  ON ji.id = ie.id
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
        OR ji.completed_at >= ${completedFromIso}
      )
  `);

  // Initialise per-board summary + dedup set
  const boardSummaryMap = new Map<string, BoardSummary>();
  const boardSeenIssues = new Map<string, Set<string>>();

  for (const board of allBoards) {
    boardSummaryMap.set(board.id, {
      boardId: board.id,
      boardName: board.name,
      memberCount: boardEmailMap.get(board.id)?.size ?? 0,
      workload: 0,
      active: 0,
      onTrack: 0,
      atRisk: 0,
      overdue: 0,
      completed: 0,
      unplanned: 0,
    });
    boardSeenIssues.set(board.id, new Set());
  }

  for (const raw of issuesRes.rows as IssueRow[]) {
    const targetBoards = emailBoardMap.get(raw.effective_email) ?? [];
    if (targetBoards.length === 0) continue;

    const cat = (raw.status_category ?? "").toLowerCase();
    const isDoneStatus =
      cat === "done" || cat.includes("complete") || cat.includes("closed");
    const cs = raw.canonical_status;

    const cf = (raw.custom_fields as Record<string, unknown>) ?? {};
    const startDate = extractStartDate(cf, raw.start_date_field_ids);
    const dueDate = extractDueDate(cf, raw.end_date_field_ids);
    const completedDate = raw.completed_at?.slice(0, 10);

    for (const boardId of targetBoards) {
      const seen = boardSeenIssues.get(boardId)!;
      // Deduplicate: each issue counts at most once per board
      if (seen.has(raw.issue_id)) continue;
      seen.add(raw.issue_id);

      const board = boardSummaryMap.get(boardId)!;

      if (cs === "CANCELLED") continue;

      if (isDoneStatus) {
        if (
          cs === "DONE" &&
          completedDate &&
          completedDate >= filterStart &&
          completedDate <= filterEnd
        ) {
          board.completed++;
        }
        continue;
      }

      // Unplanned
      if (!startDate || !dueDate) {
        if (uFilterStart && uFilterEnd) {
          if (!raw.jira_created_at) continue;
          const createdDate = raw.jira_created_at.slice(0, 10);
          if (createdDate >= uFilterStart && createdDate <= uFilterEnd) {
            board.unplanned++;
          }
        } else {
          board.unplanned++;
        }
        continue;
      }

      const label = classifyActive(startDate, dueDate, nowStr);

      if (label === "overdue") {
        if (uFilterStart && dueDate < uFilterStart) continue;
        board.overdue++;
        board.active++;
        continue;
      }

      if (startDate > filterEnd || dueDate < filterStart) continue;

      if (label === "on_track") {
        board.onTrack++;
        board.workload++;
        board.active++;
      } else {
        board.atRisk++;
        board.workload++;
        board.active++;
      }
    }
  }

  const boards = Array.from(boardSummaryMap.values())
    .filter(
      (b) =>
        b.workload > 0 ||
        b.active > 0 ||
        b.overdue > 0 ||
        b.unplanned > 0
    )
    .sort(
      (a, b) =>
        b.active - a.active ||
        b.workload - a.workload ||
        a.boardName.localeCompare(b.boardName)
    );

  return stampCache({ boards });
}

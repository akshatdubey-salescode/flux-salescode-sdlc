import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";
import { KEKA_LEAVE_TAG, KEKA_DIRECTORY_TAG } from "@/lib/keka/cache-tags";
import { loadLeaveByEmail } from "@/lib/keka/absence";
import { loadKekaDirectory } from "@/lib/keka/directory";
import {
  workingDaysBetween,
  workingDaysRemainingFromToday,
  totalWorkingHours,
  workingHoursRemaining,
  classifyIssue as classifyIssueFn,
  safeThreshold,
} from "@/lib/jira/estimate";

type Params = { params: Promise<{ boardId: string }> };

export type IssueLabel = "on_track" | "at_risk" | "overdue" | "done";

export type TimelineIssue = {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  statusCategory: string | null;
  priority: string | null;
  issueType: string;
  startDate: string;
  dueDate: string;
  /** Calendar days remaining (legacy field kept for sort/filter logic). */
  daysRemaining: number | null;
  /** Working days remaining (Mon–Fri). 0 = due today, negative = overdue. */
  workingDaysRemaining: number | null;
  label: IssueLabel;
  projectName: string;
  jiraBaseUrl: string;
  /** Working days of total estimated span (start → due). Null if dates missing. */
  estWorkingDays: number | null;
};

export type UnplannedIssue = {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  statusCategory: string | null;
  priority: string | null;
  issueType: string;
  projectName: string;
  jiraBaseUrl: string;
  missingStart: boolean;
  missingDue: boolean;
  createdAt: string | null;
  assignedAt: string | null;
};

export type TimelineMember = {
  memberId: string;
  name: string;
  email: string;
  issues: TimelineIssue[];
  overdueIssues: TimelineIssue[];
  counts: { active: number; atRisk: number; overdue: number; done: number };
  unplannedCount: number;
  unplannedPreview: UnplannedIssue[];
  /** YYYY-MM-DD dates within [filterStart, filterEnd] the member is on approved
   *  Keka leave. Empty when no leave / no Keka record. */
  absentDates: string[];
  /** Distinct approved leave-type names in the window (e.g. "Comp Offs"). */
  leaveTypes: string[];
  /** Number of direct reports this member has in Keka (0 = not a manager).
   *  Drives the "View team" cross-navigation affordance. Optional: only the
   *  board timeline populates it (the project timeline reuses this type). */
  kekaReportCount?: number;
  /** Id of a Team Pulse board this member already owns/manages, if any (so the
   *  affordance links straight to it instead of offering to build one). */
  ownedBoardId?: string | null;
};

export type UnplannedMember = {
  memberId: string;
  name: string;
  email: string;
  issues: UnplannedIssue[];
};

export type TimelineResponse = {
  filterStart: string;
  filterEnd: string;
  estimateThresholdDays: number;
  summary: {
    active: number;
    onTrack: number;
    atRisk: number;
    overdue: number;
    completed: number;
    unplanned: number;
  };
  members: TimelineMember[];
  unplanned: {
    totalCount: number;
    byMember: UnplannedMember[];
  };
};

// All working-day / classification helpers live in @/lib/jira/estimate.
// Use the re-exported alias so call-sites below don't need renaming.
const classifyIssue = classifyIssueFn;

type IssueRow = {
  id: string;
  jira_key: string;
  summary: string;
  status: string;
  status_category: string | null;
  priority: string | null;
  issue_type: string;
  assignee_email: string;
  custom_fields: Record<string, unknown>;
  project_name: string;
  jira_base_url: string;
  jira_created_at: string | null;
  assignee_since: string | null;
  end_date_field_ids: string[] | null;
  start_date_field_ids: string[] | null;
};

export async function GET(req: Request, { params }: Params) {
  try {
    await requireAuth();
    const { boardId } = await params;
    const url = new URL(req.url);
    // `now` is the client's local datetime string "YYYY-MM-DDTHH:MM:SS" (no timezone).
    // Falls back to server UTC if not provided.
    const nowStr = url.searchParams.get("now") ?? new Date().toISOString().slice(0, 19);
    const today = nowStr.slice(0, 10);
    const singleDate = url.searchParams.get("date");
    const filterStart = url.searchParams.get("start") ?? singleDate ?? today;
    const filterEnd = url.searchParams.get("end") ?? singleDate ?? today;

    const data = await fetchBoardTimeline(boardId, filterStart, filterEnd, nowStr);
    if (data === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[timeline] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchBoardTimeline(
  boardId: string,
  filterStart: string,
  filterEnd: string,
  nowStr: string,
) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`board:${boardId}`);
  cacheTag(KEKA_LEAVE_TAG);
  // The per-member "View team" affordance reads the Keka org tree and the set
  // of existing boards, so refresh when either changes.
  cacheTag(KEKA_DIRECTORY_TAG);
  cacheTag("boards");

  const [board] = await db
    .select()
    .from(observerBoards)
    .where(eq(observerBoards.id, boardId));

  if (!board) return null;

  const members = await db
    .select()
    .from(observerBoardMembers)
    .where(eq(observerBoardMembers.boardId, boardId));

  if (members.length === 0) {
    return {
      filterStart,
      filterEnd,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      estimateThresholdDays: safeThreshold((board as any).estimateThresholdDays, "board/timeline"),
      summary: { active: 0, onTrack: 0, atRisk: 0, overdue: 0, completed: 0, unplanned: 0 },
      members: [],
      unplanned: { totalCount: 0, byMember: [] },
    } satisfies TimelineResponse;
  }

  const emailSet = new Set(members.map((m) => m.email.toLowerCase()));
  if (board.managerEmail) emailSet.add(board.managerEmail.toLowerCase());
  const emails = [...emailSet];
  const emailsIn = sql.join(emails.map((e) => sql`${e}`), sql`, `);

  const issuesRes = await db.execute(sql`
    WITH member_issue_emails AS (
      SELECT ji.id, lower(ji.assignee_email) AS effective_email
      FROM jira_issues ji
      WHERE lower(ji.assignee_email) IN (${emailsIn})
      UNION
      SELECT ji.id, lower(ae) AS effective_email
      FROM jira_issues ji
      CROSS JOIN LATERAL unnest(ji.additional_assignee_emails) AS ae
      WHERE lower(ae) IN (${emailsIn})
    )
    SELECT
      ji.id,
      ji.jira_key,
      ji.summary,
      ji.status,
      ji.status_category,
      ji.priority,
      ji.issue_type,
      mie.effective_email AS assignee_email,
      ji.custom_fields,
      jp.name          AS project_name,
      jp.jira_base_url AS jira_base_url,
      ji.jira_created_at,
      ji.assignee_since,
      jp.end_date_field_ids,
      jp.start_date_field_ids
    FROM member_issue_emails mie
    JOIN jira_issues ji ON ji.id = mie.id
    JOIN jira_projects jp ON jp.id = ji.project_id
    ORDER BY mie.effective_email, ji.jira_key
  `);

  const timelineByEmail = new Map<string, TimelineIssue[]>();
  const overdueByEmail = new Map<string, TimelineIssue[]>();
  const unplannedByEmail = new Map<string, UnplannedIssue[]>();

  for (const raw of issuesRes.rows as IssueRow[]) {
    const cf = (raw.custom_fields as Record<string, unknown>) ?? {};
    const startDate = extractStartDate(cf, raw.start_date_field_ids);
    const dueDate = extractDueDate(cf, raw.end_date_field_ids);
    const email = raw.assignee_email;

    if (!startDate || !dueDate) {
      if (!raw.jira_created_at) continue;
      const createdDate = raw.jira_created_at.slice(0, 10);
      if (createdDate < filterStart || createdDate > filterEnd) continue;
      const list = unplannedByEmail.get(email) ?? [];
      list.push({
        id: raw.id,
        jiraKey: raw.jira_key,
        summary: raw.summary,
        status: raw.status,
        statusCategory: raw.status_category,
        priority: raw.priority,
        issueType: raw.issue_type,
        projectName: raw.project_name,
        jiraBaseUrl: raw.jira_base_url,
        missingStart: !startDate,
        missingDue: !dueDate,
        createdAt: raw.jira_created_at ?? null,
        assignedAt: raw.assignee_since ?? null,
      });
      unplannedByEmail.set(email, list);
      continue;
    }

    const cat = (raw.status_category ?? "").toLowerCase();
    const isDoneStatus =
      cat === "done" || cat.includes("complete") || cat.includes("closed");
    const today = nowStr.slice(0, 10);

    // Overdue tasks: collect per-member for Active tab, exclude from Workload display
    if (!isDoneStatus && dueDate < today) {
      if (dueDate >= filterStart && dueDate <= filterEnd) {
        const daysRemaining = Math.ceil(
          (new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000
        );
        const list = overdueByEmail.get(email) ?? [];
        list.push({
          id: raw.id,
          jiraKey: raw.jira_key,
          summary: raw.summary,
          status: raw.status,
          statusCategory: raw.status_category,
          priority: raw.priority,
          issueType: raw.issue_type,
          startDate: startDate ?? "",
          dueDate,
          daysRemaining,
          workingDaysRemaining: workingDaysRemainingFromToday(today, dueDate),
          label: "overdue",
          projectName: raw.project_name,
          jiraBaseUrl: raw.jira_base_url,
          estWorkingDays: startDate ? workingDaysBetween(startDate, dueDate) : null,
        });
        overdueByEmail.set(email, list);
      }
      continue; // overdue tasks belong in the Overdue/Active tab, not Workload
    }

    // Skip tasks outside the date overlap window
    if (startDate > filterEnd || dueDate < filterStart) continue;

    // Skip done tasks that predate the filter window
    if (isDoneStatus && dueDate < filterStart) continue;

    const label = classifyIssue(raw.status_category, startDate, dueDate, nowStr);
    const isDone = label === "done";
    const daysRemaining = isDone
      ? null
      : Math.ceil(
          (new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000
        );

    const list = timelineByEmail.get(email) ?? [];
    list.push({
      id: raw.id,
      jiraKey: raw.jira_key,
      summary: raw.summary,
      status: raw.status,
      statusCategory: raw.status_category,
      priority: raw.priority,
      issueType: raw.issue_type,
      startDate,
      dueDate,
      daysRemaining,
      workingDaysRemaining: isDone ? null : workingDaysRemainingFromToday(today, dueDate),
      label,
      projectName: raw.project_name,
      jiraBaseUrl: raw.jira_base_url,
      estWorkingDays: workingDaysBetween(startDate, dueDate),
    });
    timelineByEmail.set(email, list);
  }

  const labelOrder: Record<IssueLabel, number> = {
    overdue: 0,
    at_risk: 1,
    on_track: 2,
    done: 3,
  };

  // Keka leave overlay — approved on-leave dates + types per member in window.
  const leave = await loadLeaveByEmail(filterStart, filterEnd);

  // Cross-navigation: does each member manage their own team?
  //  - kekaReportCount: # of direct reports in the Keka org tree (0 = not a manager)
  //  - ownedBoardId: a board they already manage (so we link straight to it)
  const directory = await loadKekaDirectory();
  const ownedBoardByEmail = new Map<string, string>();
  const ownerRows = await db.execute(sql`
    SELECT id, lower(manager_email) AS manager_email, lower(created_by) AS created_by
    FROM observer_boards
    WHERE id <> ${boardId}
      AND (lower(manager_email) IN (${emailsIn}) OR lower(created_by) IN (${emailsIn}))
  `);
  for (const row of ownerRows.rows as { id: string; manager_email: string | null; created_by: string | null }[]) {
    if (row.manager_email && !ownedBoardByEmail.has(row.manager_email)) {
      ownedBoardByEmail.set(row.manager_email, row.id);
    }
    if (row.created_by && !ownedBoardByEmail.has(row.created_by)) {
      ownedBoardByEmail.set(row.created_by, row.id);
    }
  }

  const memberResults: TimelineMember[] = members.map((member) => {
    const emailKey = member.email.toLowerCase();
    const li = leave.get(emailKey);
    const issues = timelineByEmail.get(emailKey) ?? [];
    issues.sort((a, b) => labelOrder[a.label] - labelOrder[b.label]);

    const overdueIssues = (overdueByEmail.get(emailKey) ?? [])
      .sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0));

    const unplanned = unplannedByEmail.get(emailKey) ?? [];
    const unplannedPreview = [...unplanned]
      .sort((a, b) => {
        if (!a.createdAt && !b.createdAt) return 0;
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.localeCompare(a.createdAt);
      })
      .slice(0, 5);

    return {
      memberId: member.id,
      name: member.name,
      email: member.email,
      issues,
      overdueIssues,
      counts: {
        active: issues.filter((i) => i.label !== "done").length,
        atRisk: issues.filter((i) => i.label === "at_risk").length,
        overdue: overdueIssues.length,
        done: issues.filter((i) => i.label === "done").length,
      },
      unplannedCount: unplanned.length,
      unplannedPreview,
      absentDates: [...(li?.dates ?? [])].sort(),
      leaveTypes: [...(li?.types ?? [])].sort(),
      kekaReportCount: directory.directReports(emailKey).length,
      ownedBoardId: ownedBoardByEmail.get(emailKey) ?? null,
    };
  });

  memberResults.sort((a, b) => {
    // Group 0: has current tasks running in the date window
    // Group 1: has unplanned tasks but no current tasks
    // Group 2: nothing current (overdue-only or empty)
    const group = (m: TimelineMember) =>
      m.issues.length > 0 ? 0 : m.unplannedCount > 0 ? 1 : 2;
    const gDiff = group(a) - group(b);
    if (gDiff !== 0) return gDiff;
    return (b.counts.overdue * 10 + b.counts.atRisk) - (a.counts.overdue * 10 + a.counts.atRisk);
  });

  // Use all fetched issues (including manager if not in members) so summary counts match the dedicated tabs.
  const allIssues = [...timelineByEmail.values()].flat();
  const allUnplanned = [...unplannedByEmail.values()].flat();

  const overdueCount = [...overdueByEmail.values()].reduce((s, a) => s + a.length, 0);
  const onTrack = allIssues.filter((i) => i.label === "on_track").length;
  const atRisk = allIssues.filter((i) => i.label === "at_risk").length;
  const summary = {
    active: onTrack + atRisk + overdueCount,
    onTrack,
    atRisk,
    overdue: overdueCount,
    completed: allIssues.filter((i) => i.label === "done").length,
    unplanned: allUnplanned.length,
  };

  const unplannedByMember: UnplannedMember[] = members
    .map((m) => ({
      memberId: m.id,
      name: m.name,
      email: m.email,
      issues: unplannedByEmail.get(m.email.toLowerCase()) ?? [],
    }))
    .filter((m) => m.issues.length > 0);

  return {
    filterStart,
    filterEnd,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    estimateThresholdDays: safeThreshold((board as any).estimateThresholdDays, "board/timeline"),
    summary,
    members: memberResults,
    unplanned: {
      totalCount: allUnplanned.length,
      byMember: unplannedByMember,
    },
  } satisfies TimelineResponse;
}

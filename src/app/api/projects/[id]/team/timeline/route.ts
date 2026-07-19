import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";
import { KEKA_LEAVE_TAG } from "@/lib/keka/cache-tags";
import { loadLeaveByEmail } from "@/lib/keka/absence";
import {
  workingDaysBetween,
  workingDaysRemainingFromToday,
  totalWorkingHours,
  workingHoursRemaining,
  classifyIssue as classifyIssueFn,
} from "@/lib/jira/estimate";

// Re-export the same types as the board timeline so client components are interchangeable.
export type {
  IssueLabel,
  TimelineIssue,
  UnplannedIssue,
  TimelineMember,
  UnplannedMember,
  TimelineResponse,
} from "@/app/api/observer/boards/[boardId]/timeline/route";

import type {
  IssueLabel,
  TimelineIssue,
  UnplannedIssue,
  TimelineMember,
  TimelineResponse,
} from "@/app/api/observer/boards/[boardId]/timeline/route";

type Params = { params: Promise<{ id: string }> };

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

// All working-day / classification helpers imported from @/lib/jira/estimate.
const classifyIssue = classifyIssueFn;

export async function GET(req: Request, { params }: Params) {
  try {
    await requireAuth();
    const { id: projectId } = await params;
    const url = new URL(req.url);
    const nowStr = url.searchParams.get("now") ?? new Date().toISOString().slice(0, 19);
    const today = nowStr.slice(0, 10);
    const singleDate = url.searchParams.get("date");
    const filterStart = url.searchParams.get("start") ?? singleDate ?? today;
    const filterEnd = url.searchParams.get("end") ?? singleDate ?? today;
    const data = await fetchProjectTeamTimeline(projectId, filterStart, filterEnd, nowStr);
    if (data === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[project-team-timeline] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchProjectTeamTimeline(
  projectId: string,
  filterStart: string,
  filterEnd: string,
  nowStr: string,
) {
  "use cache";
  cacheLife("minutes");
  cacheTag("projects", `project:${projectId}`);
  cacheTag(KEKA_LEAVE_TAG);

  const [project] = await db.select().from(jiraProjects).where(eq(jiraProjects.id, projectId));
  if (!project) return null;

  // Derive members from assignees in this project
  const membersRes = await db.execute(sql`
    SELECT DISTINCT
      lower(ji.assignee_email) AS email,
      COALESCE(MIN(ji.assignee_name), lower(ji.assignee_email)) AS name
    FROM jira_issues ji
    WHERE ji.project_id = ${projectId}
      AND ji.assignee_email IS NOT NULL
      AND ji.assignee_email != ''
    GROUP BY lower(ji.assignee_email)
    ORDER BY name
  `);

  type MemberRow = { email: string; name: string };
  const members = membersRes.rows as MemberRow[];

  if (members.length === 0) {
    return {
      filterStart, filterEnd,
      estimateThresholdDays: 2,
      summary: { active: 0, onTrack: 0, atRisk: 0, overdue: 0, completed: 0, unplanned: 0 },
      members: [],
      unplanned: { totalCount: 0, byMember: [] },
    } satisfies TimelineResponse;
  }

  const emailsIn = sql.join(members.map((m) => sql`${m.email}`), sql`, `);

  const issuesRes = await db.execute(sql`
    WITH member_issue_emails AS (
      SELECT ji.id, lower(ji.assignee_email) AS effective_email
      FROM jira_issues ji
      WHERE lower(ji.assignee_email) IN (${emailsIn})
        AND ji.project_id = ${projectId}
      UNION
      SELECT ji.id, lower(ae) AS effective_email
      FROM jira_issues ji
      CROSS JOIN LATERAL unnest(ji.additional_assignee_emails) AS ae
      WHERE lower(ae) IN (${emailsIn})
        AND ji.project_id = ${projectId}
    )
    SELECT
      ji.id, ji.jira_key, ji.summary, ji.status, ji.status_category,
      ji.priority, ji.issue_type, mie.effective_email AS assignee_email,
      ji.custom_fields, jp.name AS project_name, jp.jira_base_url,
      ji.jira_created_at, ji.assignee_since, jp.end_date_field_ids, jp.start_date_field_ids
    FROM member_issue_emails mie
    JOIN jira_issues ji ON ji.id = mie.id
    JOIN jira_projects jp ON jp.id = ji.project_id
    ORDER BY mie.effective_email, ji.jira_key
  `);

  const timelineByEmail = new Map<string, TimelineIssue[]>();
  const overdueByEmail = new Map<string, TimelineIssue[]>();
  const unplannedByEmail = new Map<string, UnplannedIssue[]>();
  const today = nowStr.slice(0, 10);

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
        id: raw.id, jiraKey: raw.jira_key, summary: raw.summary,
        status: raw.status, statusCategory: raw.status_category,
        priority: raw.priority, issueType: raw.issue_type,
        projectName: raw.project_name, jiraBaseUrl: raw.jira_base_url,
        missingStart: !startDate, missingDue: !dueDate,
        createdAt: raw.jira_created_at ?? null,
        assignedAt: raw.assignee_since ?? null,
      });
      unplannedByEmail.set(email, list);
      continue;
    }

    const cat = (raw.status_category ?? "").toLowerCase();
    const isDoneStatus = cat === "done" || cat.includes("complete") || cat.includes("closed");

    if (!isDoneStatus && dueDate < today) {
      if (dueDate >= filterStart && dueDate <= filterEnd) {
        const daysRemaining = Math.ceil(
          (new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000
        );
        const list = overdueByEmail.get(email) ?? [];
        list.push({
          id: raw.id, jiraKey: raw.jira_key, summary: raw.summary,
          status: raw.status, statusCategory: raw.status_category,
          priority: raw.priority, issueType: raw.issue_type,
          startDate: startDate ?? "", dueDate, daysRemaining,
          workingDaysRemaining: workingDaysRemainingFromToday(today, dueDate),
          label: "overdue", projectName: raw.project_name, jiraBaseUrl: raw.jira_base_url,
          estWorkingDays: startDate ? workingDaysBetween(startDate, dueDate) : null,
        });
        overdueByEmail.set(email, list);
      }
      continue;
    }

    if (startDate > filterEnd || dueDate < filterStart) continue;
    if (isDoneStatus && dueDate < filterStart) continue;

    const label = classifyIssue(raw.status_category, startDate, dueDate, nowStr);
    const isDone = label === "done";
    const daysRemaining = isDone ? null : Math.ceil(
      (new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000
    );

    const list = timelineByEmail.get(email) ?? [];
    list.push({
      id: raw.id, jiraKey: raw.jira_key, summary: raw.summary,
      status: raw.status, statusCategory: raw.status_category,
      priority: raw.priority, issueType: raw.issue_type,
      startDate, dueDate, daysRemaining,
      workingDaysRemaining: isDone ? null : workingDaysRemainingFromToday(today, dueDate),
      label,
      projectName: raw.project_name, jiraBaseUrl: raw.jira_base_url,
      estWorkingDays: workingDaysBetween(startDate, dueDate),
    });
    timelineByEmail.set(email, list);
  }

  const labelOrder: Record<IssueLabel, number> = { overdue: 0, at_risk: 1, on_track: 2, done: 3 };

  // Keka leave overlay — approved on-leave dates + types per member in window.
  const leave = await loadLeaveByEmail(filterStart, filterEnd);

  const memberResults: TimelineMember[] = members.map((member, idx) => {
    const emailKey = member.email;
    const li = leave.get(emailKey);
    const issues = timelineByEmail.get(emailKey) ?? [];
    issues.sort((a, b) => labelOrder[a.label] - labelOrder[b.label]);
    const overdueIssues = (overdueByEmail.get(emailKey) ?? [])
      .sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0));
    const unplanned = unplannedByEmail.get(emailKey) ?? [];
    const unplannedPreview = [...unplanned]
      .sort((a, b) => {
        if (!a.createdAt && !b.createdAt) return 0;
        if (!a.createdAt) return 1; if (!b.createdAt) return -1;
        return b.createdAt.localeCompare(a.createdAt);
      }).slice(0, 5);
    return {
      memberId: `proj-member-${idx}`,
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
    };
  });

  memberResults.sort((a, b) => {
    const group = (m: typeof memberResults[number]) =>
      m.issues.length > 0 ? 0 : m.unplannedCount > 0 ? 1 : 2;
    const gDiff = group(a) - group(b);
    if (gDiff !== 0) return gDiff;
    return (b.counts.overdue * 10 + b.counts.atRisk) - (a.counts.overdue * 10 + a.counts.atRisk);
  });

  const allIssues = [...timelineByEmail.values()].flat();
  const allUnplanned = [...unplannedByEmail.values()].flat();
  const overdueCount = [...overdueByEmail.values()].reduce((s, a) => s + a.length, 0);
  const onTrack = allIssues.filter((i) => i.label === "on_track").length;
  const atRisk = allIssues.filter((i) => i.label === "at_risk").length;

  return {
    filterStart, filterEnd,
    estimateThresholdDays: 2,
    summary: {
      active: onTrack + atRisk + overdueCount,
      onTrack, atRisk, overdue: overdueCount,
      completed: allIssues.filter((i) => i.label === "done").length,
      unplanned: allUnplanned.length,
    },
    members: memberResults,
    unplanned: {
      totalCount: allUnplanned.length,
      byMember: members
        .map((m, idx) => ({ memberId: `proj-member-${idx}`, name: m.name, email: m.email, issues: unplannedByEmail.get(m.email) ?? [] }))
        .filter((m) => m.issues.length > 0),
    },
  } satisfies TimelineResponse;
}

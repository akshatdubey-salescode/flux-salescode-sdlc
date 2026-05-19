import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

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
  daysRemaining: number | null;
  label: IssueLabel;
  projectName: string;
  jiraBaseUrl: string;
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
};

export type TimelineMember = {
  memberId: string;
  name: string;
  email: string;
  issues: TimelineIssue[];
  counts: { active: number; atRisk: number; overdue: number; done: number };
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
  summary: {
    active: number;
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

function extractStartDate(cf: Record<string, unknown>): string | null {
  // Jira Software "Start date" field — most common IDs
  const val =
    cf["customfield_10015"] ??
    cf["customfield_10014"] ??
    cf["startdate"] ??
    cf["start_date"];
  return typeof val === "string" && val ? val.slice(0, 10) : null;
}

function extractDueDate(cf: Record<string, unknown>): string | null {
  const val = cf["duedate"] ?? cf["due_date"] ?? cf["customfield_10021"];
  return typeof val === "string" && val ? val.slice(0, 10) : null;
}

function classifyIssue(
  statusCategory: string | null,
  dueDate: string,
  selectedDate: string
): IssueLabel {
  const cat = (statusCategory ?? "").toLowerCase();
  if (cat === "done" || cat.includes("complete")) return "done";

  const daysRemaining = Math.ceil(
    (new Date(dueDate).getTime() - new Date(selectedDate).getTime()) / 86400000
  );
  if (daysRemaining < 0) return "overdue";
  if (daysRemaining <= 3) return "at_risk";
  return "on_track";
}

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
};

export async function GET(req: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { boardId } = await params;
    const url = new URL(req.url);
    const today = new Date().toISOString().split("T")[0];
    // Support both single-date (?date=) and range (?start=&end=) modes
    const singleDate = url.searchParams.get("date");
    const filterStart = url.searchParams.get("start") ?? singleDate ?? today;
    const filterEnd = url.searchParams.get("end") ?? singleDate ?? today;
    // Classification (overdue / at-risk) is always relative to today
    const referenceDate = today;

    const [board] = await db
      .select()
      .from(observerBoards)
      .where(
        and(
          eq(observerBoards.id, boardId),
          eq(observerBoards.createdBy, user.id)
        )
      );

    if (!board) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const members = await db
      .select()
      .from(observerBoardMembers)
      .where(eq(observerBoardMembers.boardId, boardId));

    if (members.length === 0) {
      return NextResponse.json({
        filterStart,
        filterEnd,
        summary: { active: 0, atRisk: 0, overdue: 0, completed: 0, unplanned: 0 },
        members: [],
        unplanned: { totalCount: 0, byMember: [] },
      } satisfies TimelineResponse);
    }

    const emails = members.map((m) => m.email);
    const emailsIn = sql.join(
      emails.map((e) => sql`${e}`),
      sql`, `
    );

    const issuesRes = await db.execute(sql`
      SELECT
        ji.id,
        ji.jira_key,
        ji.summary,
        ji.status,
        ji.status_category,
        ji.priority,
        ji.issue_type,
        ji.assignee_email,
        ji.custom_fields,
        jp.name          AS project_name,
        jp.jira_base_url AS jira_base_url
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      WHERE ji.assignee_email IN (${emailsIn})
      ORDER BY ji.assignee_email, ji.jira_key
    `);

    const timelineByEmail = new Map<string, TimelineIssue[]>();
    const unplannedByEmail = new Map<string, UnplannedIssue[]>();

    for (const raw of issuesRes.rows as IssueRow[]) {
      const cf = (raw.custom_fields as Record<string, unknown>) ?? {};
      const startDate = extractStartDate(cf);
      const dueDate = extractDueDate(cf);
      const email = raw.assignee_email;

      if (!startDate || !dueDate) {
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
        });
        unplannedByEmail.set(email, list);
        continue;
      }

      // Range overlap: issue window must intersect the filter window
      // issue.startDate <= filterEnd  AND  issue.dueDate >= filterStart
      if (startDate > filterEnd || dueDate < filterStart) continue;

      const cat = (raw.status_category ?? "").toLowerCase();
      const isDoneStatus =
        cat === "done" || cat.includes("complete") || cat.includes("closed");

      // Drop completed issues whose window ended before the filter range starts
      if (isDoneStatus && dueDate < filterStart) continue;

      // Classify overdue/at-risk always relative to today, not the filter window
      const label = classifyIssue(raw.status_category, dueDate, referenceDate);
      const isDone = label === "done";
      const daysRemaining = isDone
        ? null
        : Math.ceil(
            (new Date(dueDate).getTime() - new Date(referenceDate).getTime()) /
              86400000
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
        label,
        projectName: raw.project_name,
        jiraBaseUrl: raw.jira_base_url,
      });
      timelineByEmail.set(email, list);
    }

    const labelOrder: Record<IssueLabel, number> = {
      overdue: 0,
      at_risk: 1,
      on_track: 2,
      done: 3,
    };

    const memberResults: TimelineMember[] = members.map((member) => {
      const issues = timelineByEmail.get(member.email) ?? [];
      issues.sort((a, b) => labelOrder[a.label] - labelOrder[b.label]);

      return {
        memberId: member.id,
        name: member.name,
        email: member.email,
        issues,
        counts: {
          active: issues.filter((i) => i.label !== "done").length,
          atRisk: issues.filter((i) => i.label === "at_risk").length,
          overdue: issues.filter((i) => i.label === "overdue").length,
          done: issues.filter((i) => i.label === "done").length,
        },
      };
    });

    // Most urgent members first
    memberResults.sort((a, b) => {
      const scoreA = a.counts.overdue * 10 + a.counts.atRisk;
      const scoreB = b.counts.overdue * 10 + b.counts.atRisk;
      return scoreB - scoreA;
    });

    const allIssues = memberResults.flatMap((m) => m.issues);
    const allUnplanned = [...unplannedByEmail.values()].flat();

    const summary = {
      active: allIssues.filter((i) => i.label !== "done").length,
      atRisk: allIssues.filter((i) => i.label === "at_risk").length,
      overdue: allIssues.filter((i) => i.label === "overdue").length,
      completed: allIssues.filter((i) => i.label === "done").length,
      unplanned: allUnplanned.length,
    };

    const unplannedByMember: UnplannedMember[] = members
      .map((m) => ({
        memberId: m.id,
        name: m.name,
        email: m.email,
        issues: unplannedByEmail.get(m.email) ?? [],
      }))
      .filter((m) => m.issues.length > 0);

    return NextResponse.json({
      filterStart,
      filterEnd,
      summary,
      members: memberResults,
      unplanned: {
        totalCount: allUnplanned.length,
        byMember: unplannedByMember,
      },
    } satisfies TimelineResponse);
  } catch (err) {
    console.error("[timeline] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

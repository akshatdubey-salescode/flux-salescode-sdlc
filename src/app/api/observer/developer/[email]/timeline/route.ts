import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/server";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";

type Params = { params: Promise<{ email: string }> };

export type DeveloperIssueLabel = "on_track" | "at_risk" | "overdue" | "done";

export type DeveloperTimelineIssue = {
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
  label: DeveloperIssueLabel;
  projectName: string;
  projectKey: string;
  jiraBaseUrl: string;
};

export type DeveloperUnplannedIssue = {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  priority: string | null;
  issueType: string;
  projectName: string;
  jiraBaseUrl: string;
};

export type DeveloperTimelineResponse = {
  filterStart: string;
  filterEnd: string;
  issues: DeveloperTimelineIssue[];
  unplanned: DeveloperUnplannedIssue[];
};

function classifyIssue(
  statusCategory: string | null,
  dueDate: string,
  referenceDate: string,
): DeveloperIssueLabel {
  const cat = (statusCategory ?? "").toLowerCase();
  if (cat === "done" || cat.includes("complete")) return "done";
  const daysRemaining = Math.ceil(
    (new Date(dueDate).getTime() - new Date(referenceDate).getTime()) / 86400000,
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
  custom_fields: Record<string, unknown>;
  project_name: string;
  project_key: string;
  jira_base_url: string;
  end_date_field_ids: string[] | null;
  start_date_field_ids: string[] | null;
};

export async function GET(req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { email } = await params;
    const decodedEmail = decodeURIComponent(email).toLowerCase();
    const url = new URL(req.url);
    const today = new Date().toISOString().split("T")[0];
    const filterStart = url.searchParams.get("start") ?? today;
    const filterEnd = url.searchParams.get("end") ?? today;
    const data = await fetchDeveloperTimeline(decodedEmail, filterStart, filterEnd, today);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[developer-timeline] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchDeveloperTimeline(
  email: string,
  filterStart: string,
  filterEnd: string,
  referenceDate: string,
) {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues", `developer:${email}`);

  const issuesRes = await db.execute(sql`
    SELECT
      ji.id,
      ji.jira_key,
      ji.summary,
      ji.status,
      ji.status_category,
      ji.priority,
      ji.issue_type,
      ji.custom_fields,
      jp.name              AS project_name,
      jp.jira_project_key  AS project_key,
      jp.jira_base_url     AS jira_base_url,
      jp.end_date_field_ids,
      jp.start_date_field_ids
    FROM jira_issues ji
    JOIN jira_projects jp ON jp.id = ji.project_id
    WHERE (ji.assignee_email = ${email} OR ${email} = ANY(ji.additional_assignee_emails))
    ORDER BY ji.jira_key
  `);

  const timelineIssues: DeveloperTimelineIssue[] = [];
  const unplannedIssues: DeveloperUnplannedIssue[] = [];

  for (const raw of issuesRes.rows as IssueRow[]) {
    const cf = (raw.custom_fields as Record<string, unknown>) ?? {};
    const startDate = extractStartDate(cf, raw.start_date_field_ids);
    const dueDate = extractDueDate(cf, raw.end_date_field_ids);

    if (!startDate || !dueDate) {
      unplannedIssues.push({
        id: raw.id,
        jiraKey: raw.jira_key,
        summary: raw.summary,
        status: raw.status,
        priority: raw.priority,
        issueType: raw.issue_type,
        projectName: raw.project_name,
        jiraBaseUrl: raw.jira_base_url,
      });
      continue;
    }

    // Skip if entirely outside range
    if (startDate > filterEnd || dueDate < filterStart) continue;

    const cat = (raw.status_category ?? "").toLowerCase();
    const isDoneStatus = cat === "done" || cat.includes("complete") || cat.includes("closed");
    if (isDoneStatus && dueDate < filterStart) continue;

    const label = classifyIssue(raw.status_category, dueDate, referenceDate);
    const isDone = label === "done";
    const daysRemaining = isDone
      ? null
      : Math.ceil(
          (new Date(dueDate).getTime() - new Date(referenceDate).getTime()) / 86400000,
        );

    timelineIssues.push({
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
      projectKey: raw.project_key,
      jiraBaseUrl: raw.jira_base_url,
    });
  }

  // Sort: overdue first, then at_risk, then on_track, then done
  const labelOrder: Record<DeveloperIssueLabel, number> = {
    overdue: 0,
    at_risk: 1,
    on_track: 2,
    done: 3,
  };
  timelineIssues.sort((a, b) => labelOrder[a.label] - labelOrder[b.label]);

  return {
    filterStart,
    filterEnd,
    issues: timelineIssues,
    unplanned: unplannedIssues,
  } satisfies DeveloperTimelineResponse;
}

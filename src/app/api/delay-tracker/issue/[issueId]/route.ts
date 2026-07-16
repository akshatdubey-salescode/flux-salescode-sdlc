import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/server";
import { loadAccountIdEmailMap } from "@/lib/jira/identity";
import { extractIssueOwnerEmail, extractIssueOwnerName } from "@/lib/jira/scorecard-fields";
import { fetchDelayLogHistory, type DelayLogEntry } from "@/lib/delay-tracker/entries";

export type { DelayLogEntry };

type Params = { params: Promise<{ issueId: string }> };

export type DelayTrackerIssueDetail = {
  issue: {
    id: string;
    jiraKey: string;
    summary: string;
    status: string;
    statusCategory: string | null;
    priority: string | null;
    issueType: string;
    projectId: string;
    projectName: string;
    jiraBaseUrl: string;
  };
  defaultResponsible: { email: string | null; name: string | null };
  history: DelayLogEntry[];
};

/**
 * Everything the delay-log popup needs, resolved server-side from just the
 * issue id: Jira details, the default responsible person (the same Issue
 * Owner resolution used by the bug board / performance review — including
 * the accountId→email fallback for masked emails — falling back to the
 * assignee when no Issue Owner field is set), and the full delay history.
 * Nothing runs until a user opens the popup for this issue — no per-row cost
 * on the surfaces that list issues.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  await requireAuth();
  const { issueId } = await params;

  const [issueRes, history, accountIdEmailMap] = await Promise.all([
    db.execute(sql`
      SELECT
        ji.id, ji.jira_key, ji.summary, ji.status, ji.status_category,
        ji.priority, ji.issue_type, ji.assignee_email, ji.assignee_name,
        ji.custom_fields, jp.issue_owner_field_ids,
        jp.id AS project_id, jp.name AS project_name, jp.jira_base_url
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      WHERE ji.id = ${issueId}
      LIMIT 1
    `),
    fetchDelayLogHistory(issueId),
    loadAccountIdEmailMap(),
  ]);

  const row = issueRes.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const customFields = (row.custom_fields as Record<string, unknown>) ?? {};
  const ownerFieldIds = row.issue_owner_field_ids as string[] | null;
  const resolvedOwnerEmail =
    extractIssueOwnerEmail(customFields, ownerFieldIds, accountIdEmailMap) ??
    (row.assignee_email as string | null) ??
    null;
  const resolvedOwnerName =
    extractIssueOwnerName(customFields, ownerFieldIds) ?? (row.assignee_name as string | null) ?? null;

  const detail: DelayTrackerIssueDetail = {
    issue: {
      id: row.id as string,
      jiraKey: row.jira_key as string,
      summary: row.summary as string,
      status: row.status as string,
      statusCategory: (row.status_category as string | null) ?? null,
      priority: (row.priority as string | null) ?? null,
      issueType: row.issue_type as string,
      projectId: row.project_id as string,
      projectName: row.project_name as string,
      jiraBaseUrl: row.jira_base_url as string,
    },
    defaultResponsible: { email: resolvedOwnerEmail, name: resolvedOwnerName },
    history,
  };

  return NextResponse.json(detail);
}

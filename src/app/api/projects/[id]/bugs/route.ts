import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { loadAccountIdEmailMap } from "@/lib/jira/identity";
import {
  extractIssueOwnerEmail,
  extractIssueOwnerName,
  normalizeEmail,
} from "@/lib/jira/scorecard-fields";
import { BUG_ISSUE_TYPES } from "@/lib/scorecard/config";
import {
  resolveEnvironment,
  priorityBucket,
  UNASSIGNED_OWNER,
  type BugRow,
  type BugSummaryResponse,
} from "@/lib/bug-summary";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id: projectId } = await props.params;
    const data = await fetchProjectBugs(projectId);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Project bugs error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchProjectBugs(projectId: string): Promise<BugSummaryResponse> {
  "use cache";
  cacheLife("minutes");
  cacheTag("projects", `project:${projectId}`);

  const [project] = await db
    .select({
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
      issueOwnerFieldIds: jiraProjects.issueOwnerFieldIds,
      environmentFieldIds: jiraProjects.environmentFieldIds,
    })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId))
    .limit(1);

  if (!project) return { bugs: [], jiraBaseUrl: "" };

  const accountIdEmailMap = await loadAccountIdEmailMap();

  const rows = await db
    .select({
      id: jiraIssues.id,
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      status: jiraIssues.status,
      statusCategory: jiraIssues.statusCategory,
      issueType: jiraIssues.issueType,
      priority: jiraIssues.priority,
      assigneeEmail: jiraIssues.assigneeEmail,
      assigneeName: jiraIssues.assigneeName,
      customFields: jiraIssues.customFields,
      jiraCreatedAt: jiraIssues.jiraCreatedAt,
      jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
    })
    .from(jiraIssues)
    .where(
      and(
        eq(jiraIssues.projectId, projectId),
        // Bug-family issue types only (bug / defect / sub-bug), case-insensitive.
        sql`lower(trim(${jiraIssues.issueType})) in (${sql.join(
          [...BUG_ISSUE_TYPES].map((t) => sql`${t}`),
          sql`, `
        )})`
      )
    );

  const bugs: BugRow[] = rows.map((r) => {
    // Owner attribution mirrors the performance-review engine: Issue Owner
    // field first, then the Jira assignee.
    const ownerEmail =
      extractIssueOwnerEmail(r.customFields, project.issueOwnerFieldIds, accountIdEmailMap) ??
      normalizeEmail(r.assigneeEmail);
    const ownerName =
      extractIssueOwnerName(r.customFields, project.issueOwnerFieldIds) ??
      r.assigneeName ??
      UNASSIGNED_OWNER;

    const env = resolveEnvironment(
      r.customFields as Record<string, unknown> | null,
      project.environmentFieldIds
    );

    const isOpen = (r.statusCategory ?? "").trim().toLowerCase() !== "done";

    return {
      id: r.id,
      jiraKey: r.jiraKey,
      summary: r.summary,
      status: r.status,
      statusCategory: r.statusCategory,
      priority: r.priority,
      priorityBucket: priorityBucket(r.priority),
      environment: env,
      ownerName,
      ownerEmail,
      isOpen,
      jiraCreatedAt: r.jiraCreatedAt ? r.jiraCreatedAt.toISOString() : null,
      jiraUpdatedAt: r.jiraUpdatedAt ? r.jiraUpdatedAt.toISOString() : null,
    };
  });

  return { bugs, jiraBaseUrl: project.jiraBaseUrl ?? "" };
}

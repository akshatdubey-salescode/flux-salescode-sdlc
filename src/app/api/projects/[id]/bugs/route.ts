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
import { localDateStr } from "@/lib/date-utils";
import {
  resolveEnvironment,
  priorityBucket,
  UNASSIGNED_OWNER,
  type BugRow,
  type BugSummaryResponse,
} from "@/lib/bug-summary";

/** Fallback window when the request omits an explicit range: last 30 days. */
function defaultRange(): { start: string; end: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 29);
  return { start: localDateStr(from), end: localDateStr(now) };
}

// Accept only YYYY-MM-DD; anything else falls back so a malformed query param
// can't poison the cache key or the SQL date cast.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id: projectId } = await props.params;
    const url = new URL(request.url);
    const fallback = defaultRange();
    const rawStart = url.searchParams.get("start");
    const rawEnd = url.searchParams.get("end");
    const start = rawStart && ISO_DATE.test(rawStart) ? rawStart : fallback.start;
    const end = rawEnd && ISO_DATE.test(rawEnd) ? rawEnd : fallback.end;
    const data = await fetchProjectBugs(projectId, start, end);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Project bugs error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchProjectBugs(
  projectId: string,
  start: string,
  end: string
): Promise<BugSummaryResponse> {
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
        )})`,
        // Bugs raised within the selected range (by Jira creation date).
        sql`${jiraIssues.jiraCreatedAt} is not null`,
        sql`${jiraIssues.jiraCreatedAt}::date >= ${start}::date`,
        sql`${jiraIssues.jiraCreatedAt}::date <= ${end}::date`
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

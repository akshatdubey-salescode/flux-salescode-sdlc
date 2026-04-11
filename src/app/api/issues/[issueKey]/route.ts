import type { NextRequest } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraIssues,
  jiraProjects,
  jiraStatusHistory,
  jiraComments,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ issueKey: string }> }
) {
  await requireAuth();
  const { issueKey } = await params;

  const [issue] = await db
    .select({
      id: jiraIssues.id,
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      status: jiraIssues.status,
      statusCategory: jiraIssues.statusCategory,
      issueType: jiraIssues.issueType,
      priority: jiraIssues.priority,
      assigneeName: jiraIssues.assigneeName,
      assigneeEmail: jiraIssues.assigneeEmail,
      reporterName: jiraIssues.reporterName,
      labels: jiraIssues.labels,
      jiraCreatedAt: jiraIssues.jiraCreatedAt,
      jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
      projectId: jiraIssues.projectId,
    })
    .from(jiraIssues)
    .where(eq(jiraIssues.jiraKey, issueKey))
    .limit(1);

  if (!issue) {
    return Response.json({ error: "Issue not found" }, { status: 404 });
  }

  const [project] = await db
    .select({ name: jiraProjects.name, jiraProjectKey: jiraProjects.jiraProjectKey })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, issue.projectId))
    .limit(1);

  const [statusHistory, comments] = await Promise.all([
    db
      .select({
        id: jiraStatusHistory.id,
        fromStatus: jiraStatusHistory.fromStatus,
        toStatus: jiraStatusHistory.toStatus,
        changedAt: jiraStatusHistory.changedAt,
        changedByName: jiraStatusHistory.changedByName,
        changedByEmail: jiraStatusHistory.changedByEmail,
        durationSeconds: jiraStatusHistory.durationSeconds,
      })
      .from(jiraStatusHistory)
      .where(eq(jiraStatusHistory.issueId, issue.id))
      .orderBy(asc(jiraStatusHistory.changedAt)),

    db
      .select({
        id: jiraComments.id,
        authorName: jiraComments.authorName,
        authorEmail: jiraComments.authorEmail,
        body: jiraComments.body,
        jiraCreatedAt: jiraComments.jiraCreatedAt,
        jiraUpdatedAt: jiraComments.jiraUpdatedAt,
      })
      .from(jiraComments)
      .where(eq(jiraComments.issueId, issue.id))
      .orderBy(asc(jiraComments.jiraCreatedAt)),
  ]);

  return Response.json({ issue, project, statusHistory, comments });
}

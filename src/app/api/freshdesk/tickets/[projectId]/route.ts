import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { freshdeskTickets, jiraIssues, jiraProjects } from "@/lib/db/schema";

export async function GET(
  _req: Request,
  props: { params: Promise<{ projectId: string }> }
) {
  await requireAuth();
  const { projectId } = await props.params;

  const [project] = await db
    .select({ jiraBaseUrl: jiraProjects.jiraBaseUrl })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId))
    .limit(1);

  const tickets = await db
    .select()
    .from(freshdeskTickets)
    .where(eq(freshdeskTickets.projectId, projectId))
    .orderBy(desc(freshdeskTickets.fdCreatedAt));

  // Batch-fetch Jira fields for all linked issues in one query
  const linkedIds = tickets
    .map((t) => t.linkedJiraIssueId)
    .filter((id): id is string => id !== null);

  type JiraExtra = { jiraCreatedAt: Date | null; jiraPriority: string | null };
  const jiraExtraMap = new Map<string, JiraExtra>();
  if (linkedIds.length > 0) {
    const jiraRows = await db
      .select({
        id: jiraIssues.id,
        jiraCreatedAt: jiraIssues.jiraCreatedAt,
        priority: jiraIssues.priority,
      })
      .from(jiraIssues)
      .where(inArray(jiraIssues.id, linkedIds));
    for (const row of jiraRows) {
      jiraExtraMap.set(row.id, {
        jiraCreatedAt: row.jiraCreatedAt ?? null,
        jiraPriority: row.priority ?? null,
      });
    }
  }

  const enriched = tickets.map((t) => ({
    ...t,
    jiraCreatedAt: t.linkedJiraIssueId ? (jiraExtraMap.get(t.linkedJiraIssueId)?.jiraCreatedAt ?? null) : null,
    jiraPriority:  t.linkedJiraIssueId ? (jiraExtraMap.get(t.linkedJiraIssueId)?.jiraPriority  ?? null) : null,
  }));

  return NextResponse.json({
    tickets: enriched,
    jiraBaseUrl: project?.jiraBaseUrl ?? null,
  });
}

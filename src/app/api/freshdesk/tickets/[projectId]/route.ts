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

  // Batch-fetch jiraCreatedAt for all linked issues in one query
  const linkedIds = tickets
    .map((t) => t.linkedJiraIssueId)
    .filter((id): id is string => id !== null);

  const jiraCreatedAtMap = new Map<string, Date | null>();
  if (linkedIds.length > 0) {
    const jiraRows = await db
      .select({ id: jiraIssues.id, jiraCreatedAt: jiraIssues.jiraCreatedAt })
      .from(jiraIssues)
      .where(inArray(jiraIssues.id, linkedIds));
    for (const row of jiraRows) {
      jiraCreatedAtMap.set(row.id, row.jiraCreatedAt ?? null);
    }
  }

  const enriched = tickets.map((t) => ({
    ...t,
    jiraCreatedAt: t.linkedJiraIssueId
      ? (jiraCreatedAtMap.get(t.linkedJiraIssueId) ?? null)
      : null,
  }));

  return NextResponse.json({
    tickets: enriched,
    jiraBaseUrl: project?.jiraBaseUrl ?? null,
  });
}

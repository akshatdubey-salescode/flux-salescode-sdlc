import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { freshdeskTickets, jiraIssues, jiraProjects } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export async function GET(
  _req: Request,
  props: { params: Promise<{ projectId: string }> }
) {
  await requireAuth();
  const { projectId } = await props.params;

  const [project, stats, ticketTypeRows, jiraStatusRows, jiraAssigneeRows, jiraPriorityRows] =
    await Promise.all([
      db
        .select({ jiraBaseUrl: jiraProjects.jiraBaseUrl })
        .from(jiraProjects)
        .where(eq(jiraProjects.id, projectId))
        .limit(1),

      db
        .select({
          open: sql<number>`cast(count(*) filter (where ${freshdeskTickets.fdStatus} = 2) as integer)`,
          unlinked: sql<number>`cast(count(*) filter (where ${freshdeskTickets.linkedJiraKey} is null and ${freshdeskTickets.fdStatus} not in (4, 5)) as integer)`,
          slaBreached: sql<number>`cast(count(*) filter (where ${freshdeskTickets.dueBy} < now() and ${freshdeskTickets.fdStatus} not in (4, 5)) as integer)`,
          resolved: sql<number>`cast(count(*) filter (where ${freshdeskTickets.fdStatus} in (4, 5)) as integer)`,
        })
        .from(freshdeskTickets)
        .where(eq(freshdeskTickets.projectId, projectId)),

      db
        .selectDistinct({ value: freshdeskTickets.ticketType })
        .from(freshdeskTickets)
        .where(and(eq(freshdeskTickets.projectId, projectId), isNotNull(freshdeskTickets.ticketType)))
        .orderBy(freshdeskTickets.ticketType),

      db
        .selectDistinct({ value: freshdeskTickets.linkedJiraStatus })
        .from(freshdeskTickets)
        .where(and(eq(freshdeskTickets.projectId, projectId), isNotNull(freshdeskTickets.linkedJiraStatus)))
        .orderBy(freshdeskTickets.linkedJiraStatus),

      db
        .selectDistinct({ value: freshdeskTickets.linkedJiraAssigneeName })
        .from(freshdeskTickets)
        .where(and(eq(freshdeskTickets.projectId, projectId), isNotNull(freshdeskTickets.linkedJiraAssigneeName)))
        .orderBy(freshdeskTickets.linkedJiraAssigneeName),

      db
        .selectDistinct({ value: jiraIssues.priority })
        .from(freshdeskTickets)
        .innerJoin(jiraIssues, eq(freshdeskTickets.linkedJiraIssueId, jiraIssues.id))
        .where(and(eq(freshdeskTickets.projectId, projectId), isNotNull(jiraIssues.priority)))
        .orderBy(jiraIssues.priority),
    ]);

  return NextResponse.json({
    stats: stats[0] ?? { open: 0, unlinked: 0, slaBreached: 0, resolved: 0 },
    filterOptions: {
      ticketTypes: ticketTypeRows.map((r) => r.value).filter((v): v is string => v !== null),
      jiraStatuses: jiraStatusRows.map((r) => r.value).filter((v): v is string => v !== null),
      jiraAssignees: jiraAssigneeRows.map((r) => r.value).filter((v): v is string => v !== null),
      jiraPriorities: jiraPriorityRows.map((r) => r.value).filter((v): v is string => v !== null),
    },
    jiraBaseUrl: project[0]?.jiraBaseUrl ?? null,
  });
}

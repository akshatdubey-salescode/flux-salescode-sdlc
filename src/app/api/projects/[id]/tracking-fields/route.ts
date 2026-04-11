import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/projects/[id]/tracking-fields">
) {
  await requireAuth();
  const { id } = await ctx.params;

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, id), eq(jiraProjects.isActive, true)))
    .limit(1);

  if (!project)
    return Response.json({ error: "Project not found" }, { status: 404 });

  const [statuses, priorities, issueTypes, assigneeRows, reporterRows, labelRows] =
    await Promise.all([
      db
        .selectDistinct({
          status: jiraIssues.status,
          statusCategory: jiraIssues.statusCategory,
        })
        .from(jiraIssues)
        .where(eq(jiraIssues.projectId, id)),
      db
        .selectDistinct({ value: jiraIssues.priority })
        .from(jiraIssues)
        .where(and(eq(jiraIssues.projectId, id), isNotNull(jiraIssues.priority))),
      db
        .selectDistinct({ value: jiraIssues.issueType })
        .from(jiraIssues)
        .where(eq(jiraIssues.projectId, id)),
      db
        .selectDistinct({
          email: jiraIssues.assigneeEmail,
          name: jiraIssues.assigneeName,
        })
        .from(jiraIssues)
        .where(
          and(eq(jiraIssues.projectId, id), isNotNull(jiraIssues.assigneeEmail))
        ),
      db
        .selectDistinct({
          email: jiraIssues.reporterEmail,
          name: jiraIssues.reporterName,
        })
        .from(jiraIssues)
        .where(
          and(eq(jiraIssues.projectId, id), isNotNull(jiraIssues.reporterEmail))
        ),
      db
        .selectDistinct({ labels: jiraIssues.labels })
        .from(jiraIssues)
        .where(eq(jiraIssues.projectId, id)),
    ]);

  const labels = [
    ...new Set(labelRows.flatMap((r) => r.labels ?? [])),
  ].sort();

  const priorityOrder: Record<string, number> = {
    Highest: 0,
    High: 1,
    Medium: 2,
    Low: 3,
    Lowest: 4,
  };
  const sortedPriorities = priorities
    .map((r) => r.value!)
    .sort((a, b) => (priorityOrder[a] ?? 99) - (priorityOrder[b] ?? 99));

  return Response.json({
    statuses: statuses.sort((a, b) => a.status.localeCompare(b.status)),
    priorities: sortedPriorities,
    issueTypes: issueTypes.map((r) => r.value).sort(),
    assignees: assigneeRows
      .filter((r) => r.email)
      .map((r) => ({ email: r.email!, name: r.name ?? r.email! }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    reporters: reporterRows
      .filter((r) => r.email)
      .map((r) => ({ email: r.email!, name: r.name ?? r.email! }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    labels,
  });
}

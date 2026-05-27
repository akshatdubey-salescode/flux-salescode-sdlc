import { and, eq, isNotNull, inArray, or, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

export async function GET(req: Request) {
  const user = await requireAuth();

  const { searchParams } = new URL(req.url);
  const forEmail = searchParams.get("forEmail")?.trim();
  const targetEmail = forEmail || user.email;

  return Response.json(await fetchMyTasksFields(targetEmail));
}

async function fetchMyTasksFields(targetEmail: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`my-tasks:${targetEmail}`);

  const isAssignee = or(
    eq(jiraIssues.assigneeEmail, targetEmail),
    sql`${targetEmail} = ANY(${jiraIssues.additionalAssigneeEmails})`
  )!;

  const [statuses, priorities, issueTypes, reporterRows, labelRows, projectRows] =
    await Promise.all([
      db
        .selectDistinct({
          status: jiraIssues.status,
          statusCategory: jiraIssues.statusCategory,
        })
        .from(jiraIssues)
        .where(isAssignee),
      db
        .selectDistinct({ value: jiraIssues.priority })
        .from(jiraIssues)
        .where(and(isAssignee, isNotNull(jiraIssues.priority))),
      db
        .selectDistinct({ value: jiraIssues.issueType })
        .from(jiraIssues)
        .where(isAssignee),
      db
        .selectDistinct({
          email: jiraIssues.reporterEmail,
          name: jiraIssues.reporterName,
        })
        .from(jiraIssues)
        .where(and(isAssignee, isNotNull(jiraIssues.reporterEmail))),
      db
        .selectDistinct({ labels: jiraIssues.labels })
        .from(jiraIssues)
        .where(isAssignee),
      db
        .selectDistinct({
          id: jiraProjects.id,
          name: jiraProjects.name,
          key: jiraProjects.jiraProjectKey,
        })
        .from(jiraProjects)
        .innerJoin(jiraIssues, eq(jiraIssues.projectId, jiraProjects.id))
        .where(isAssignee),
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

  return {
    statuses: statuses.sort((a, b) => a.status.localeCompare(b.status)),
    priorities: sortedPriorities,
    issueTypes: issueTypes.map((r) => r.value).sort(),
    reporters: reporterRows
      .filter((r) => r.email)
      .map((r) => ({ email: r.email!, name: r.name ?? r.email! }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    labels,
    projects: projectRows.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

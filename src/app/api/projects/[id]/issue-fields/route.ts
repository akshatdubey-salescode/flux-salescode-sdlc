import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/projects/[id]/issue-fields">
) {
  await requireRole("ADMIN");
  const { id } = await ctx.params;

  const [statuses, statusCategories, issueTypes, priorities] = await Promise.all([
    db.selectDistinct({ value: jiraIssues.status })
      .from(jiraIssues)
      .where(eq(jiraIssues.projectId, id)),
    db.selectDistinct({ value: jiraIssues.statusCategory })
      .from(jiraIssues)
      .where(eq(jiraIssues.projectId, id)),
    db.selectDistinct({ value: jiraIssues.issueType })
      .from(jiraIssues)
      .where(eq(jiraIssues.projectId, id)),
    db.selectDistinct({ value: jiraIssues.priority })
      .from(jiraIssues)
      .where(eq(jiraIssues.projectId, id)),
  ]);

  return Response.json({
    status: statuses.map((r) => r.value).filter(Boolean).sort() as string[],
    status_category: statusCategories.map((r) => r.value).filter(Boolean).sort() as string[],
    issue_type: issueTypes.map((r) => r.value).filter(Boolean).sort() as string[],
    priority: priorities.map((r) => r.value).filter(Boolean).sort() as string[],
  });
}

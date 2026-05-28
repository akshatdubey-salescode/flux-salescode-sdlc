import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraProjects, requirements } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole("SUPERUSER");

  const { id } = await params;

  const [project] = await db
    .select({ id: jiraProjects.id, name: jiraProjects.name, jiraProjectKey: jiraProjects.jiraProjectKey })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, id))
    .limit(1);

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  // requirements uses onDelete: "restrict" — must be removed before the project row
  await db.delete(requirements).where(eq(requirements.jiraProjectId, id));

  // Everything else (jira_issues, sla_rules, sla_violations, email_notifications,
  // project_status_mappings, project_stakeholders, jira_sync_jobs, freshdesk_tickets)
  // cascades from jira_projects.
  await db.delete(jiraProjects).where(eq(jiraProjects.id, id));

  revalidateTag("projects", "max");
  revalidateTag(`project:${id}`, "max");
  revalidateTag("jira-issues", "max");

  return Response.json({ ok: true, deleted: { id, name: project.name } });
}

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirements, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { JiraClient } from "@/lib/jira/client";
import { decrypt } from "@/lib/crypto";

// Fetches Jira project metadata (issue types + assignees) using the site admin
// token. Read-only operations don't need the user's OAuth token — that is
// reserved exclusively for writing (issue creation in publish-to-jira).
export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await props.params;

  const [req] = await db
    .select({ jiraProjectId: requirements.jiraProjectId })
    .from(requirements)
    .where(and(eq(requirements.id, id), eq(requirements.createdBy, user.id)))
    .limit(1);

  if (!req) {
    return Response.json({ error: "Requirement not found" }, { status: 404 });
  }

  const [project] = await db
    .select({
      jiraProjectKey: jiraProjects.jiraProjectKey,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
      jiraEmail: jiraProjects.jiraEmail,
      jiraApiToken: jiraProjects.jiraApiToken,
    })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, req.jiraProjectId))
    .limit(1);

  if (!project) {
    return Response.json({ error: "Jira project not found" }, { status: 422 });
  }

  const client = new JiraClient({
    baseUrl: project.jiraBaseUrl,
    email: project.jiraEmail,
    apiToken: decrypt(project.jiraApiToken),
  });

  const [issueTypes, assignees, priorities] = await Promise.all([
    client.fetchIssueTypes(project.jiraProjectKey),
    client.fetchAssignableUsers(project.jiraProjectKey),
    client.fetchPriorities(),
  ]);

  return Response.json({ issueTypes, assignees, priorities });
}

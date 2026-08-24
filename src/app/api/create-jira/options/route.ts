import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";
import {
  getCloudIdForJiraSite,
  getValidCredentials,
} from "@/lib/atlassian/oauth";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { JiraClient } from "@/lib/jira/client";
import { selectCreateDateFields } from "@/lib/jira/create-fields";

export async function GET(request: Request) {
  const user = await requireAuth();
  const searchParams = new URL(request.url).searchParams;
  const projectId = searchParams.get("projectId");
  const issueTypeId = searchParams.get("issueTypeId");

  if (!projectId) {
    return Response.json({ error: "projectId is required" }, { status: 400 });
  }

  const credentials = await getValidCredentials(user.id);
  if (!credentials) {
    return Response.json(
      {
        error:
          "Your Atlassian connection expired. Reconnect it from Settings.",
        code: "ATLASSIAN_RECONNECT_REQUIRED",
      },
      { status: 422 }
    );
  }

  const [project] = await db
    .select({
      jiraProjectKey: jiraProjects.jiraProjectKey,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
      jiraEmail: jiraProjects.jiraEmail,
      jiraApiToken: jiraProjects.jiraApiToken,
      isActive: jiraProjects.isActive,
      startDateFieldIds: jiraProjects.startDateFieldIds,
      endDateFieldIds: jiraProjects.endDateFieldIds,
    })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId))
    .limit(1);

  if (!project || !project.isActive) {
    return Response.json({ error: "Jira project not found" }, { status: 404 });
  }

  let projectCloudId: string | null;
  try {
    projectCloudId = await getCloudIdForJiraSite(
      credentials.accessToken,
      project.jiraBaseUrl
    );
  } catch (error) {
    console.error("[create-jira-options] Could not resolve Jira site:", error);
    return Response.json(
      { error: "Could not verify access to this Jira site. Please try again." },
      { status: 502 }
    );
  }

  if (!projectCloudId) {
    return Response.json(
      {
        error:
          "Your connected Atlassian account does not have access to this Jira site. Reconnect it from Settings and select the correct site.",
        code: "ATLASSIAN_SITE_ACCESS_REQUIRED",
      },
      { status: 403 }
    );
  }

  const client = new JiraClient({
    baseUrl: project.jiraBaseUrl,
    email: project.jiraEmail,
    apiToken: decrypt(project.jiraApiToken),
  });

  try {
    if (issueTypeId) {
      const fields = await client.fetchCreateFields(
        project.jiraProjectKey,
        issueTypeId
      );
      return Response.json({
        dateFields: selectCreateDateFields(
          fields,
          project.startDateFieldIds,
          project.endDateFieldIds
        ),
      });
    }

    const [issueTypes, priorities, assignees] = await Promise.all([
      client.fetchIssueTypes(project.jiraProjectKey),
      client.fetchPriorities(),
      client.fetchAssignableUsers(project.jiraProjectKey),
    ]);

    if (issueTypes.length === 0 || priorities.length === 0) {
      throw new Error("Jira returned incomplete create metadata");
    }

    return Response.json({
      issueTypes,
      priorities,
      assignees,
      currentAccountId: credentials.accountId,
    });
  } catch (error) {
    console.error("[create-jira-options] Failed to load Jira metadata:", error);
    return Response.json(
      { error: "Could not load fields for this Jira project." },
      { status: 502 }
    );
  }
}

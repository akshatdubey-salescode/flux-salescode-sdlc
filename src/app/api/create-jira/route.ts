import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";
import { getValidCredentials } from "@/lib/atlassian/oauth";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { JiraClient } from "@/lib/jira/client";
import { selectCreateDateFields } from "@/lib/jira/create-fields";
import { markdownToAdf } from "@/lib/markdown-to-adf";

const JIRA_API_BASE = "https://api.atlassian.com/ex/jira";
const MAX_LABELS = 20;

type CreateJiraBody = {
  projectId?: string;
  summary?: string;
  description?: string;
  issueTypeName?: string;
  issueTypeId?: string;
  priorityName?: string;
  assigneeAccountId?: string;
  labels?: string[];
  startDate?: string;
  dueDate?: string;
};

function jiraErrorMessage(
  body: { errors?: Record<string, string>; errorMessages?: string[] },
  status: number
) {
  const fieldErrors = body.errors ? Object.values(body.errors) : [];
  return (
    fieldErrors[0] ??
    body.errorMessages?.[0] ??
    `Jira could not create the issue (${status}).`
  );
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export async function POST(request: Request) {
  const user = await requireAuth();

  let body: CreateJiraBody;
  try {
    body = (await request.json()) as CreateJiraBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const projectId = body.projectId?.trim();
  const summary = body.summary?.trim();
  const description = body.description?.trim() ?? "";
  const issueTypeName = body.issueTypeName?.trim();
  const issueTypeId = body.issueTypeId?.trim();
  const priorityName = body.priorityName?.trim();
  const assigneeAccountId = body.assigneeAccountId?.trim();
  const labels = Array.isArray(body.labels)
    ? [...new Set(body.labels.map((label) => label.trim()).filter(Boolean))]
    : [];
  const startDate = body.startDate?.trim() ?? "";
  const dueDate = body.dueDate?.trim() ?? "";

  if (
    !projectId ||
    !summary ||
    !issueTypeName ||
    !issueTypeId ||
    !priorityName
  ) {
    return Response.json(
      { error: "Project, summary, issue type, and priority are required." },
      { status: 400 }
    );
  }
  if (summary.length > 255) {
    return Response.json(
      { error: "Summary must be 255 characters or fewer." },
      { status: 400 }
    );
  }
  if (labels.length > MAX_LABELS) {
    return Response.json(
      { error: `Use no more than ${MAX_LABELS} labels.` },
      { status: 400 }
    );
  }
  if (labels.some((label) => label.length > 255 || /\s/.test(label))) {
    return Response.json(
      { error: "Labels cannot contain spaces and must be 255 characters or fewer." },
      { status: 400 }
    );
  }
  if (
    (startDate && !isIsoDate(startDate)) ||
    (dueDate && !isIsoDate(dueDate))
  ) {
    return Response.json(
      { error: "Start and due dates must be valid calendar dates." },
      { status: 400 }
    );
  }
  if (startDate && dueDate && startDate > dueDate) {
    return Response.json(
      { error: "Due date cannot be before the start date." },
      { status: 400 }
    );
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
    return Response.json({ error: "Jira project not found." }, { status: 404 });
  }

  const fields: Record<string, unknown> = {
    project: { key: project.jiraProjectKey },
    summary,
    issuetype: { id: issueTypeId },
    priority: { name: priorityName },
  };

  if (startDate || dueDate) {
    const client = new JiraClient({
      baseUrl: project.jiraBaseUrl,
      email: project.jiraEmail,
      apiToken: decrypt(project.jiraApiToken),
    });
    let dateFields: ReturnType<typeof selectCreateDateFields>;
    try {
      const createFields = await client.fetchCreateFields(
        project.jiraProjectKey,
        issueTypeId
      );
      dateFields = selectCreateDateFields(
        createFields,
        project.startDateFieldIds,
        project.endDateFieldIds
      );
    } catch (error) {
      console.error("[create-jira] Could not load create metadata:", error);
      return Response.json(
        { error: "Could not verify Jira scheduling fields. Please try again." },
        { status: 502 }
      );
    }

    if (startDate && !dateFields.start) {
      return Response.json(
        {
          error: `Start date is not available for the selected ${issueTypeName}.`,
        },
        { status: 422 }
      );
    }
    if (dueDate && !dateFields.due) {
      return Response.json(
        {
          error: `Due or end date is not available for the selected ${issueTypeName}.`,
        },
        { status: 422 }
      );
    }
    if (startDate && dateFields.start) fields[dateFields.start.id] = startDate;
    if (dueDate && dateFields.due) fields[dateFields.due.id] = dueDate;
  }

  if (description) fields.description = markdownToAdf(description);
  if (labels.length > 0) fields.labels = labels;
  if (assigneeAccountId) fields.assignee = { id: assigneeAccountId };

  console.info(
    `[create-jira] user=${user.id} atlassianAccountId=${credentials.accountId} ` +
      `project=${project.jiraProjectKey}`
  );

  const jiraResponse = await fetch(
    `${JIRA_API_BASE}/${credentials.cloudId}/rest/api/3/issue`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ fields }),
    }
  );

  if (!jiraResponse.ok) {
    const jiraBody = (await jiraResponse.json().catch(() => ({}))) as {
      errors?: Record<string, string>;
      errorMessages?: string[];
    };
    console.error("[create-jira] Jira API error:", jiraBody);
    return Response.json(
      { error: jiraErrorMessage(jiraBody, jiraResponse.status) },
      { status: jiraResponse.status }
    );
  }

  const created = (await jiraResponse.json()) as { key?: string };
  if (!created.key) {
    console.error("[create-jira] Jira response did not include an issue key");
    return Response.json(
      { error: "Jira created the issue but did not return its key." },
      { status: 502 }
    );
  }

  const issueUrl = `${project.jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(created.key)}`;

  console.info(
    `[create-jira] Success: ${created.key} created by user=${user.id} ` +
      `atlassianAccountId=${credentials.accountId}`
  );

  return Response.json(
    { jiraIssueKey: created.key, issueUrl },
    { status: 201 }
  );
}

import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { getCloudIdForJiraSite, getValidCredentials } from "@/lib/atlassian/oauth";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { markdownToAdf } from "@/lib/markdown-to-adf";

const JIRA_API_BASE = "https://api.atlassian.com/ex/jira";
const MAX_COMMENT_LENGTH = 8000;

/**
 * Post a comment onto the Jira issue AS THE LOGGED-IN USER, via their
 * connected Atlassian OAuth account — the same write path create-jira uses
 * (JiraClient itself is deliberately GET-only; per-user OAuth is the one
 * sanctioned way to write, and it gives the comment its true author in Jira
 * instead of a service account). Comments live in Jira only — Flux re-reads
 * them through getIssueDetail, so Jira stays the single source of truth.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ issueKey: string }> }) {
  const user = await requireAuth();
  const { issueKey: rawKey } = await params;
  const issueKey = rawKey.toUpperCase();

  let body: { body?: unknown };
  try {
    body = (await req.json()) as { body?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) {
    return Response.json({ error: "Comment body is required" }, { status: 400 });
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    return Response.json({ error: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer` }, { status: 400 });
  }

  const [issue] = await db
    .select({ id: jiraIssues.id, projectId: jiraIssues.projectId })
    .from(jiraIssues)
    .where(eq(jiraIssues.jiraKey, issueKey))
    .limit(1);
  if (!issue) {
    return Response.json({ error: "Issue not found" }, { status: 404 });
  }
  const [project] = await db
    .select({ jiraBaseUrl: jiraProjects.jiraBaseUrl })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, issue.projectId))
    .limit(1);
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const credentials = await getValidCredentials(user.id);
  if (!credentials) {
    return Response.json(
      {
        error: "Connect your Atlassian account from Settings to comment on Jira issues.",
        code: "ATLASSIAN_RECONNECT_REQUIRED",
      },
      { status: 422 }
    );
  }

  let cloudId: string | null;
  try {
    cloudId = await getCloudIdForJiraSite(credentials.accessToken, project.jiraBaseUrl);
  } catch (error) {
    console.error("[issue-comments] Could not resolve Jira site:", error);
    return Response.json({ error: "Could not verify access to this Jira site. Please try again." }, { status: 502 });
  }
  if (!cloudId) {
    return Response.json(
      {
        error: "Your connected Atlassian account does not have access to this Jira site.",
        code: "ATLASSIAN_SITE_ACCESS_REQUIRED",
      },
      { status: 403 }
    );
  }

  const jiraResponse = await fetch(
    `${JIRA_API_BASE}/${cloudId}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ body: markdownToAdf(text) }),
    }
  );
  if (!jiraResponse.ok) {
    const jiraBody = (await jiraResponse.json().catch(() => ({}))) as { errorMessages?: string[] };
    console.error("[issue-comments] Jira API error:", jiraResponse.status, jiraBody);
    return Response.json(
      { error: jiraBody.errorMessages?.[0] ?? `Jira could not add the comment (${jiraResponse.status}).` },
      { status: jiraResponse.status }
    );
  }

  // getIssueDetail caches per issue key — drop it so the modal's refetch
  // shows the new comment immediately instead of after cacheLife expires.
  revalidateTag(`issue:${issueKey}`, "max");

  return Response.json({ ok: true }, { status: 201 });
}

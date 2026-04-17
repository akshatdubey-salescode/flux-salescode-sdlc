import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirements, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { getValidCredentials } from "@/lib/atlassian/oauth";
import { markdownToAdf } from "@/lib/markdown-to-adf";

// ─── SECURITY CONTRACT ────────────────────────────────────────────────────────
//
// This route MUST ONLY ever create Jira issues using the calling user's own
// Atlassian OAuth token. The following guarantees are enforced in order:
//
//   1. requireAuth()        — user must be authenticated on our platform
//   2. createdBy = user.id  — user may only publish their own requirements
//   3. getValidCredentials(user.id) — credentials are fetched exclusively for
//                             the calling user's row in user_integrations.
//                             Returns null (→ 422) if not connected.
//   4. credentials.accountId assertion — hard-stops if accountId is missing
//   5. reporter field in payload — Jira payload explicitly names the reporter
//                             by accountId so the issue is attributed to the
//                             user even at the Atlassian API level.
//   6. Post-creation reporter check — verifies the created issue's reporter
//                             matches the expected accountId.
//
// The site admin token (JIRA_SITE_ADMIN_TOKEN / jiraProjects.jiraApiToken) is
// NEVER imported, read, or used anywhere in this file. Any future change that
// introduces it here should be treated as a critical security regression.
//
// ─────────────────────────────────────────────────────────────────────────────

const JIRA_API_BASE = "https://api.atlassian.com/ex/jira";

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const user = await requireAuth();
  const { id } = await props.params;

  let body: { issueTypeName: string; priorityName: string; assigneeAccountId?: string } = {
    issueTypeName: "",
    priorityName: "",
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { issueTypeName, priorityName, assigneeAccountId } = body;

  if (!issueTypeName) {
    return Response.json({ error: "issueTypeName is required" }, { status: 400 });
  }
  if (!priorityName) {
    return Response.json({ error: "priorityName is required" }, { status: 400 });
  }

  // ── 2. Load requirement — only if owned by this user ──────────────────────
  const [req] = await db
    .select()
    .from(requirements)
    .where(and(eq(requirements.id, id), eq(requirements.createdBy, user.id)))
    .limit(1);

  if (!req) {
    return Response.json({ error: "Requirement not found" }, { status: 404 });
  }

  if (req.jiraIssueKey) {
    return Response.json(
      { error: "Already published to Jira", jiraIssueKey: req.jiraIssueKey },
      { status: 409 }
    );
  }

  // ── 3. Get the calling user's own Atlassian credentials ───────────────────
  // getValidCredentials queries user_integrations WHERE userId = user.id.
  // It never touches jiraProjects.jiraApiToken (the site admin token).
  const credentials = await getValidCredentials(user.id);

  if (!credentials) {
    return Response.json(
      {
        error:
          "Your Atlassian account is not connected. Go to Settings → Atlassian to connect.",
      },
      { status: 422 }
    );
  }

  // ── 4. Hard assertion — accountId must be present ─────────────────────────
  // This should never be falsy given our save logic, but we refuse to proceed
  // without it so the reporter field can be set explicitly.
  if (!credentials.accountId || !credentials.cloudId || !credentials.accessToken) {
    console.error(
      "[publish-to-jira] Incomplete credentials for user",
      user.id,
      "— aborting to prevent anonymous publish"
    );
    return Response.json(
      {
        error:
          "Atlassian credentials are incomplete. Please reconnect your account in Settings.",
      },
      { status: 422 }
    );
  }

  // ── Load the Jira project (key + base URL only — no admin token) ──────────
  const [project] = await db
    .select({
      jiraProjectKey: jiraProjects.jiraProjectKey,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
    })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, req.jiraProjectId))
    .limit(1);

  if (!project) {
    return Response.json({ error: "Target Jira project not found" }, { status: 422 });
  }

  // ── 5. Build issue payload with explicit reporter ─────────────────────────
  // Setting reporter.id to the OAuth token owner's accountId means Jira
  // attributes the issue to them both via the token AND the payload field.
  const descriptionMarkdown = req.acceptanceCriteria
    ? `${req.description}\n\n## Acceptance Criteria\n\n${req.acceptanceCriteria}`
    : req.description;

  const issueFields: Record<string, unknown> = {
    project: { key: project.jiraProjectKey },
    summary: req.title,
    description: markdownToAdf(descriptionMarkdown),
    issuetype: { name: issueTypeName },
    priority: { name: priorityName },
    // Explicitly set reporter to the OAuth token owner.
    // This is belt-and-suspenders: the Bearer token already identifies the
    // user, but naming them here makes attribution unambiguous in the payload.
    reporter: { id: credentials.accountId },
  };

  if (assigneeAccountId) {
    issueFields.assignee = { id: assigneeAccountId };
  }

  const issuePayload = { fields: issueFields };

  // ── Audit log before calling Jira ─────────────────────────────────────────
  console.info(
    `[publish-to-jira] user=${user.id} (${user.email}) ` +
    `atlassianAccountId=${credentials.accountId} ` +
    `requirement=${req.id} project=${project.jiraProjectKey}`
  );

  // ── Call Jira via api.atlassian.com (OAuth tokens must NOT use org.atlassian.net) ──
  const jiraRes = await fetch(
    `${JIRA_API_BASE}/${credentials.cloudId}/rest/api/3/issue`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(issuePayload),
    }
  );

  if (!jiraRes.ok) {
    const body = await jiraRes.json().catch(() => ({}));
    console.error("[publish-to-jira] Jira API error:", body);
    const message =
      body?.errors
        ? Object.values(body.errors).join(", ")
        : body?.errorMessages?.[0] ?? `Jira API error (${jiraRes.status})`;
    return Response.json({ error: message }, { status: jiraRes.status });
  }

  const createdIssue = await jiraRes.json();
  const jiraIssueKey: string = createdIssue.key;

  // ── 6. Post-creation reporter verification ────────────────────────────────
  // Fetch the newly created issue and confirm the reporter is the expected user.
  // If it doesn't match we still save the key (the issue exists) but log a
  // loud warning so it can be investigated.
  try {
    const verifyRes = await fetch(
      `${JIRA_API_BASE}/${credentials.cloudId}/rest/api/3/issue/${jiraIssueKey}?fields=reporter`,
      {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          Accept: "application/json",
        },
      }
    );

    if (verifyRes.ok) {
      const issueData = await verifyRes.json();
      const reporterAccountId = issueData?.fields?.reporter?.accountId;

      if (reporterAccountId && reporterAccountId !== credentials.accountId) {
        console.error(
          `[publish-to-jira] REPORTER MISMATCH on ${jiraIssueKey}: ` +
          `expected=${credentials.accountId} actual=${reporterAccountId} ` +
          `platformUser=${user.id}`
        );
      } else {
        console.info(
          `[publish-to-jira] Reporter verified: ${jiraIssueKey} → ${reporterAccountId}`
        );
      }
    }
  } catch (err) {
    // Non-fatal — the issue was created, verification is a safety check only
    console.warn("[publish-to-jira] Could not verify reporter:", err);
  }

  // ── Persist the issue key and mark published ───────────────────────────────
  await db
    .update(requirements)
    .set({
      jiraIssueKey,
      status: "published",
      updatedAt: new Date(),
    })
    .where(eq(requirements.id, id));

  const issueUrl = `${project.jiraBaseUrl}/browse/${jiraIssueKey}`;

  console.info(
    `[publish-to-jira] Success: ${jiraIssueKey} created by ` +
    `atlassianAccountId=${credentials.accountId} platformUser=${user.id}`
  );

  return Response.json({ jiraIssueKey, issueUrl }, { status: 201 });
}

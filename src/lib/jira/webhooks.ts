const WEBHOOK_EVENTS = [
  "jira:issue_created",
  "jira:issue_updated",
  "jira:issue_deleted",
  "comment_created",
  "comment_updated",
  "comment_deleted",
];

function buildAdminAuth(): string {
  const email = process.env.JIRA_SITE_ADMIN_EMAIL;
  const token = process.env.JIRA_SITE_ADMIN_TOKEN;
  if (!email || !token) {
    throw new Error("JIRA_SITE_ADMIN_EMAIL and JIRA_SITE_ADMIN_TOKEN must be set");
  }
  return Buffer.from(`${email}:${token}`).toString("base64");
}

/**
 * Registers a scoped Jira webhook for a single project.
 * Uses the site admin token — regular user tokens cannot manage webhooks.
 *
 * The webhook URL embeds the internal projectId and webhookSecret so the
 * handler can authenticate and route without any global state.
 *
 * Idempotent: deletes any existing webhook pointing to this projectId first.
 */
export async function registerJiraWebhook(
  jiraBaseUrl: string,
  jiraProjectKey: string,
  projectId: string,
  webhookSecret: string
): Promise<{ webhookId: string } | { error: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return { error: "NEXT_PUBLIC_APP_URL is not set" };

  let auth: string;
  try {
    auth = buildAdminAuth();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const baseUrl = jiraBaseUrl.replace(/\/$/, "");
  const webhookUrl = `${appUrl}/api/webhooks/jira/${projectId}?secret=${webhookSecret}`;
  const authHeader = { Authorization: `Basic ${auth}` };

  // Idempotency: remove any existing webhook pointing to this projectId
  try {
    const listRes = await fetch(`${baseUrl}/rest/webhooks/1.0/webhook`, {
      headers: { ...authHeader, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (listRes.ok) {
      const existing: Array<{ url?: string; self?: string; id?: string }> =
        await listRes.json();
      const stale = (Array.isArray(existing) ? existing : []).filter((wh) =>
        wh.url?.includes(`/api/webhooks/jira/${projectId}`)
      );
      for (const wh of stale) {
        const deleteUrl =
          wh.self ?? `${baseUrl}/rest/webhooks/1.0/webhook/${wh.id}`;
        await fetch(deleteUrl, {
          method: "DELETE",
          headers: authHeader,
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      }
    }
  } catch {
    // Best-effort cleanup — proceed to create even if this fails
  }

  // Create the webhook scoped to this project via JQL filter
  const res = await fetch(`${baseUrl}/rest/webhooks/1.0/webhook`, {
    method: "POST",
    headers: {
      ...authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      name: `Flux - ${jiraProjectKey}`,
      url: webhookUrl,
      events: WEBHOOK_EVENTS,
      filters: {
        "issue-related-events-section": `project = "${jiraProjectKey}"`,
      },
      excludeBody: false,
      enabled: true,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      error: `Jira webhook registration failed (${res.status}): ${text.slice(0, 300)}`,
    };
  }

  const created = await res.json();
  return { webhookId: String(created.self ?? created.id) };
}

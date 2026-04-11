import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { requireAuth, requireRole } from "@/lib/auth/server";
import { JiraClient } from "@/lib/jira/client";
import { syncProject } from "@/lib/jira/sync";
import { randomBytes } from "crypto";
import { randomPaletteColor } from "@/lib/header-palette";
import { encrypt, decrypt } from "@/lib/crypto";
import { registerJiraWebhook } from "@/lib/jira/webhooks";

export async function GET() {
  await requireAuth();

  const projects = await db
    .select({
      id: jiraProjects.id,
      name: jiraProjects.name,
      jiraProjectKey: jiraProjects.jiraProjectKey,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
      isActive: jiraProjects.isActive,
      lastSyncedAt: jiraProjects.lastSyncedAt,
      createdAt: jiraProjects.createdAt,
    })
    .from(jiraProjects)
    .where(eq(jiraProjects.isActive, true))
    .orderBy(jiraProjects.createdAt);

  return Response.json(projects);
}

export async function POST(request: Request) {
  const user = await requireRole("SUPERUSER");

  let body: {
    jiraBaseUrl: string;
    jiraProjectKey: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { jiraBaseUrl, jiraProjectKey } = body;

  if (!jiraBaseUrl || !jiraProjectKey) {
    return Response.json({ error: "jiraBaseUrl and jiraProjectKey are required" }, { status: 400 });
  }

  const jiraEmail = process.env.JIRA_SITE_ADMIN_EMAIL;
  const jiraApiToken = process.env.JIRA_SITE_ADMIN_TOKEN;

  if (!jiraEmail || !jiraApiToken) {
    return Response.json({ error: "Server is missing Jira admin credentials" }, { status: 500 });
  }

  const client = new JiraClient({ baseUrl: jiraBaseUrl, email: jiraEmail, apiToken: jiraApiToken });

  const connected = await client.testConnection();
  if (!connected) {
    return Response.json(
      { error: "Could not connect to Jira. Check your base URL and API token." },
      { status: 422 }
    );
  }

  let projectInfo: { name: string; key: string };
  try {
    projectInfo = await client.fetchProjectInfo(jiraProjectKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 422 });
  }

  const webhookSecret = randomBytes(32).toString("hex");

  const [project] = await db
    .insert(jiraProjects)
    .values({
      name: projectInfo.name,
      jiraBaseUrl: jiraBaseUrl.replace(/\/$/, ""),
      jiraProjectKey: jiraProjectKey.toUpperCase(),
      jiraEmail,
      jiraApiToken: encrypt(jiraApiToken),
      webhookSecret: encrypt(webhookSecret),
      isActive: true,
      headerColor: randomPaletteColor(),
      createdBy: user.id,
    })
    .returning();

  // Register webhook in Jira (non-fatal — project still onboards if this fails)
  const webhookResult = await registerJiraWebhook(
    jiraBaseUrl,
    jiraProjectKey.toUpperCase(),
    project.id,
    webhookSecret
  );
  if ("error" in webhookResult) {
    console.warn("[jira-webhook] Auto-registration failed:", webhookResult.error);
  }

  // Initial sync (synchronous — bounded by Jira pagination; large projects
  // can be re-synced via the /sync endpoint afterward)
  const syncResult = await syncProject(project.id);

  return Response.json(
    {
      project: {
        id: project.id,
        name: project.name,
        jiraProjectKey: project.jiraProjectKey,
        webhookSecret: decrypt(project.webhookSecret),
      },
      sync: syncResult,
    },
    { status: 201 }
  );
}

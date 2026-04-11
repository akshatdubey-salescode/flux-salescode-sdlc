import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { requireAuth, requireRole } from "@/lib/auth/server";
import { JiraClient } from "@/lib/jira/client";
import { syncProject } from "@/lib/jira/sync";
import { randomBytes } from "crypto";
import { randomPaletteColor } from "@/lib/header-palette";

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
    jiraEmail: string;
    jiraApiToken: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { jiraBaseUrl, jiraProjectKey, jiraEmail, jiraApiToken } = body;

  if (!jiraBaseUrl || !jiraProjectKey || !jiraEmail || !jiraApiToken) {
    return Response.json({ error: "All fields are required" }, { status: 400 });
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
      jiraApiToken,
      webhookSecret,
      isActive: true,
      headerColor: randomPaletteColor(),
      createdBy: user.id,
    })
    .returning();

  // Initial sync (synchronous — bounded by Jira pagination; large projects
  // can be re-synced via the /sync endpoint afterward)
  const syncResult = await syncProject(project.id);

  return Response.json(
    {
      project: {
        id: project.id,
        name: project.name,
        jiraProjectKey: project.jiraProjectKey,
        webhookSecret: project.webhookSecret,
      },
      sync: syncResult,
    },
    { status: 201 }
  );
}

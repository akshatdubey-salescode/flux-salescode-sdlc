"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { JiraClient } from "@/lib/jira/client";
import { encrypt } from "@/lib/crypto";
import { registerJiraWebhook } from "@/lib/jira/webhooks";

export type CreateProjectState = {
  error?: string;
};

export async function createProject(
  _prev: CreateProjectState,
  formData: FormData
): Promise<CreateProjectState> {
  const user = await requireRole("SUPERUSER");

  const jiraBaseUrl = (formData.get("jiraBaseUrl") as string)?.trim();
  const jiraProjectKey = (formData.get("jiraProjectKey") as string)
    ?.trim()
    .toUpperCase();

  if (!jiraBaseUrl || !jiraProjectKey) {
    return { error: "All fields are required." };
  }

  const jiraEmail = process.env.JIRA_SITE_ADMIN_EMAIL;
  const jiraApiToken = process.env.JIRA_SITE_ADMIN_TOKEN;

  if (!jiraEmail || !jiraApiToken) {
    return { error: "Server is missing Jira admin credentials. Contact your administrator." };
  }

  // Validate URL format
  try {
    new URL(jiraBaseUrl);
  } catch {
    return { error: "Jira Base URL must be a valid URL (e.g. https://org.atlassian.net)." };
  }

  const client = new JiraClient({
    baseUrl: jiraBaseUrl,
    email: jiraEmail,
    apiToken: jiraApiToken,
  });

  const connected = await client.testConnection().catch(() => false);
  if (!connected) {
    return {
      error:
        "Could not connect to Jira. Check your base URL, email, and API token.",
    };
  }

  let projectName: string;
  try {
    const info = await client.fetchProjectInfo(jiraProjectKey);
    projectName = info.name;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Project key "${jiraProjectKey}" not found: ${msg}` };
  }

  const webhookSecret = randomBytes(32).toString("hex");

  const [project] = await db
    .insert(jiraProjects)
    .values({
      name: projectName,
      jiraBaseUrl: jiraBaseUrl.replace(/\/$/, ""),
      jiraProjectKey,
      jiraEmail,
      jiraApiToken: encrypt(jiraApiToken),
      webhookSecret: encrypt(webhookSecret),
      isActive: true,
      createdBy: user.id,
    })
    .returning();

  // Register webhook in Jira (non-fatal — project still onboards if this fails)
  const webhookResult = await registerJiraWebhook(
    jiraBaseUrl,
    jiraProjectKey,
    project.id,
    webhookSecret
  );
  if ("error" in webhookResult) {
    console.warn("[jira-webhook] Auto-registration failed:", webhookResult.error);
  } else {
    console.log("[jira-webhook] Registered webhook:", webhookResult.webhookId);
  }

  revalidatePath("/projects");
  redirect(`/projects/${project.id}/status-mapping?onboarding=1`);
}

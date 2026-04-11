"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { JiraClient } from "@/lib/jira/client";
import { syncProject } from "@/lib/jira/sync";

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
  const jiraEmail = (formData.get("jiraEmail") as string)?.trim();
  const jiraApiToken = (formData.get("jiraApiToken") as string)?.trim();

  if (!jiraBaseUrl || !jiraProjectKey || !jiraEmail || !jiraApiToken) {
    return { error: "All fields are required." };
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
      jiraApiToken,
      webhookSecret,
      isActive: true,
      createdBy: user.id,
    })
    .returning();

  // Initial sync — first 500 issues synchronously
  await syncProject(project.id);

  revalidatePath("/projects");
  redirect(`/projects/${project.id}/status-mapping?onboarding=1`);
}

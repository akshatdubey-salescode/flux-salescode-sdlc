import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects, jiraSyncJobs } from "@/lib/db/schema";
import { JiraClient } from "./client";
import { decrypt } from "@/lib/crypto";
import { upsertIssue, resolveProjectFieldConfig } from "./sync";

// ---------------------------------------------------------------------------
// Semaphore configuration
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_SYNCS = 3;

// ---------------------------------------------------------------------------
// Enqueue — per-project dedup + global concurrency cap
// ---------------------------------------------------------------------------

export type EnqueueResult =
  | { jobId: string; queued: true }
  | { jobId: string; existing: true }
  | { error: "rate_limited" };

export async function enqueueSyncJob(
  projectId: string
): Promise<EnqueueResult> {
  // If there's already an active job for this project, return it
  const [existing] = await db
    .select({ id: jiraSyncJobs.id })
    .from(jiraSyncJobs)
    .where(
      and(
        eq(jiraSyncJobs.projectId, projectId),
        inArray(jiraSyncJobs.status, ["pending", "running"])
      )
    )
    .limit(1);

  if (existing) return { jobId: existing.id, existing: true };

  // Check global concurrency cap
  const [{ running }] = await db
    .select({ running: sql<number>`count(*)::int` })
    .from(jiraSyncJobs)
    .where(eq(jiraSyncJobs.status, "running"));

  if (running >= MAX_CONCURRENT_SYNCS) return { error: "rate_limited" };

  const [job] = await db
    .insert(jiraSyncJobs)
    .values({ projectId, status: "pending" })
    .returning();

  return { jobId: job.id, queued: true };
}

// ---------------------------------------------------------------------------
// Run — executes the sync job, updating progress in the DB as it goes.
// Called inside after() so it runs decoupled from the HTTP request lifetime.
// ---------------------------------------------------------------------------

export async function runSyncJob(jobId: string): Promise<void> {
  await db
    .update(jiraSyncJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(jiraSyncJobs.id, jobId));

  const [job] = await db
    .select()
    .from(jiraSyncJobs)
    .where(eq(jiraSyncJobs.id, jobId))
    .limit(1);

  if (!job) return;

  const [project] = await db
    .select()
    .from(jiraProjects)
    .where(eq(jiraProjects.id, job.projectId))
    .limit(1);

  if (!project) {
    await db
      .update(jiraSyncJobs)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessages: ["Project not found"],
      })
      .where(eq(jiraSyncJobs.id, jobId));
    return;
  }

  const client = new JiraClient({
    baseUrl: project.jiraBaseUrl,
    email: project.jiraEmail,
    apiToken: decrypt(project.jiraApiToken),
  });

  const { multiAssigneeFieldId, extraFields } = await resolveProjectFieldConfig(
    client,
    project
  );

  let synced = 0;
  let errors = 0;
  const errorMessages: string[] = [];
  let nextPageToken: string | undefined = undefined;
  const maxResults = 100;

  try {
    for (;;) {
      const result = await client.fetchIssues(
        project.jiraProjectKey,
        nextPageToken,
        maxResults,
        extraFields
      );

      for (const issue of result.issues) {
        try {
          await upsertIssue(job.projectId, issue, multiAssigneeFieldId || undefined);
          synced++;
        } catch (err) {
          errors++;
          const msg = err instanceof Error ? err.message : String(err);
          errorMessages.push(`${issue.key}: ${msg}`);
        }
      }

      // Write progress after every page so the polling endpoint reflects it
      await db
        .update(jiraSyncJobs)
        .set({ syncedCount: synced, errorCount: errors, errorMessages })
        .where(eq(jiraSyncJobs.id, jobId));

      // nextPageToken absent = last page
      if (!result.nextPageToken || result.issues.length === 0) break;
      nextPageToken = result.nextPageToken;
    }

    await db
      .update(jiraProjects)
      .set({ lastSyncedAt: new Date() })
      .where(eq(jiraProjects.id, job.projectId));

    await db
      .update(jiraSyncJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        syncedCount: synced,
        errorCount: errors,
        errorMessages,
      })
      .where(eq(jiraSyncJobs.id, jobId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(jiraSyncJobs)
      .set({
        status: "failed",
        completedAt: new Date(),
        syncedCount: synced,
        errorCount: errors + 1,
        errorMessages: [...errorMessages, `Fatal: ${msg}`],
      })
      .where(eq(jiraSyncJobs.id, jobId));
  }
}

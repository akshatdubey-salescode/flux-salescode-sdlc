import { eq, inArray, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { githubSyncJobs } from "@/lib/db/schema";
import { syncRepos, getTrackedRepos } from "./repos";
import { syncRepoStats } from "./stats-sync";
import { resolveGithubIdentities } from "./identity";
import { buildOrgClients } from "./orgs";
import { githubStatsTag } from "./cache-tags";

// Contributor-stats calls can each block on GitHub's async 202 compute, so keep
// the fan-out modest to stay well under the REST rate limit.
const STATS_CONCURRENCY = 4;

// Org-wide job, so there's no per-project key — at most one runs at a time.
const MAX_CONCURRENT_SYNCS = 1;

export type EnqueueResult =
  | { jobId: string; queued: true }
  | { jobId: string; existing: true }
  | { error: "rate_limited" };

/** Dedup: return the active job if one exists, else enqueue a new one. */
export async function enqueueSyncJob(): Promise<EnqueueResult> {
  const [existing] = await db
    .select({ id: githubSyncJobs.id })
    .from(githubSyncJobs)
    .where(inArray(githubSyncJobs.status, ["pending", "running"]))
    .limit(1);

  if (existing) return { jobId: existing.id, existing: true };

  const [{ running }] = await db
    .select({ running: sql<number>`count(*)::int` })
    .from(githubSyncJobs)
    .where(eq(githubSyncJobs.status, "running"));

  if (running >= MAX_CONCURRENT_SYNCS) return { error: "rate_limited" };

  const [job] = await db
    .insert(githubSyncJobs)
    .values({ status: "pending" })
    .returning();

  return { jobId: job.id, queued: true };
}

/**
 * Execute the full GitHub sync, updating github_sync_jobs progress as it goes.
 * Called inside after() so it's decoupled from the HTTP request lifetime.
 *
 * Order: refresh the repo mirror → pull contributor stats for every tracked
 * repo → resolve any new logins to app users → invalidate the dashboard cache.
 */
export async function runSyncJob(jobId: string): Promise<void> {
  await db
    .update(githubSyncJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(githubSyncJobs.id, jobId));

  let syncedRepos = 0;
  let statsRowsUpserted = 0;
  let errors = 0;
  const errorMessages: string[] = [];

  try {
    const repoResult = await syncRepos();
    for (const e of repoResult.orgErrors) {
      errors++;
      errorMessages.push(e);
    }

    const orgClients = await buildOrgClients();
    const repos = await getTrackedRepos();

    await db
      .update(githubSyncJobs)
      .set({ totalRepos: repos.length, errorCount: errors, errorMessages })
      .where(eq(githubSyncJobs.id, jobId));

    for (let i = 0; i < repos.length; i += STATS_CONCURRENCY) {
      const chunk = repos.slice(i, i + STATS_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((repo) => {
          const oc = repo.orgId ? orgClients.get(repo.orgId) : undefined;
          if (!oc) {
            // Repo's org is inactive/missing — no token to read it with.
            return Promise.reject(new Error("no active org/token for repo"));
          }
          return syncRepoStats(repo.id, repo.fullName, oc.client);
        })
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled") {
          syncedRepos++;
          statsRowsUpserted += r.value.rowsUpserted;
        } else {
          errors++;
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          errorMessages.push(`${chunk[j].fullName}: ${msg}`);
        }
      }

      // Persist progress after each batch so the polling UI reflects it.
      await db
        .update(githubSyncJobs)
        .set({ syncedRepos, statsRowsUpserted, errorCount: errors, errorMessages })
        .where(eq(githubSyncJobs.id, jobId));
    }

    // Resolve any newly-seen logins to app users (per-org clients internally).
    const { resolved } = await resolveGithubIdentities();

    await db
      .update(githubSyncJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        syncedRepos,
        statsRowsUpserted,
        accountsResolved: resolved,
        errorCount: errors,
        errorMessages,
      })
      .where(eq(githubSyncJobs.id, jobId));

    // Refresh the lines-of-code dashboard without waiting for the cacheLife TTL.
    revalidateTag(githubStatsTag(), "max");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(githubSyncJobs)
      .set({
        status: "failed",
        completedAt: new Date(),
        syncedRepos,
        statsRowsUpserted,
        errorCount: errors + 1,
        errorMessages: [...errorMessages, `Fatal: ${msg}`],
      })
      .where(eq(githubSyncJobs.id, jobId));
  }
}

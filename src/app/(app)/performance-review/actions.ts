"use server";

import { revalidateTag } from "next/cache";
import { requireRole } from "@/lib/auth/server";
import { buildScorecards } from "@/lib/scorecard/build";
import { PERFORMANCE_SCORECARDS_TAG } from "@/lib/scorecard/cache-tags";
import { quarterFromKey } from "@/lib/scorecard/quarter";
import { enqueueLocSyncJob, runLocSyncJob } from "@/lib/github/loc-sync";

export type RecomputeResult = {
  error?: string;
  developersScored?: number;
};

/**
 * Recompute and persist every developer's scorecard for the given quarter,
 * then invalidate the cached leaderboard/breakdown reads. Superuser-only.
 */
export async function recomputeScorecards(
  quarterKey: string
): Promise<RecomputeResult> {
  await requireRole("SUPERUSER");

  if (!quarterFromKey(quarterKey)) {
    return { error: "Invalid quarter." };
  }

  try {
    const { developersScored } = await buildScorecards(quarterKey);
    revalidateTag(PERFORMANCE_SCORECARDS_TAG, "max");
    return { developersScored };
  } catch (err) {
    console.error("[performance-review] recompute failed:", err);
    return { error: err instanceof Error ? err.message : "Recompute failed." };
  }
}

export type LocSyncActionResult = {
  error?: string;
  prsScanned?: number;
  matchesFound?: number;
  rateLimited?: boolean;
};

/**
 * Trigger a loc-sync run for the given quarter — the same core job the
 * `loc-sync` cron calls. Superuser-only. Dedup'd against an already-running
 * job for the quarter (enqueueLocSyncJob), so a double-click doesn't race
 * GitHub twice. Recompute scorecards afterward to pick up the fresh LOC.
 */
export async function syncJiraLoc(quarterKey: string): Promise<LocSyncActionResult> {
  await requireRole("SUPERUSER");

  if (!quarterFromKey(quarterKey)) {
    return { error: "Invalid quarter." };
  }

  try {
    const enqueued = await enqueueLocSyncJob(quarterKey);
    if ("existing" in enqueued) {
      return { error: "A LOC sync for this quarter is already running." };
    }
    const result = await runLocSyncJob(enqueued.jobId, quarterKey);
    await buildScorecards(quarterKey);
    revalidateTag(PERFORMANCE_SCORECARDS_TAG, "max");
    return {
      prsScanned: result.prsScanned,
      matchesFound: result.matchesFound,
      rateLimited: result.rateLimited,
    };
  } catch (err) {
    console.error("[performance-review] loc-sync failed:", err);
    return { error: err instanceof Error ? err.message : "LOC sync failed." };
  }
}

"use server";

import { revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { jiraSelfAssignedOverrides, featureFlags } from "@/lib/db/schema";
import { buildScorecards } from "@/lib/scorecard/build";
import { PERFORMANCE_SCORECARDS_TAG } from "@/lib/scorecard/cache-tags";
import { quarterFromKey } from "@/lib/scorecard/quarter";
import { enqueueLocSyncJob, runLocSyncJob } from "@/lib/github/loc-sync";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { parseVisibleColumns } from "./visible-columns";
import type { SortKey } from "./rating-sort";

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
 * Trigger a loc-sync run for the given quarter — manual-only, no cron.
 * Superuser-only. Dedup'd against an already-running job for the quarter
 * (enqueueLocSyncJob), so a double-click doesn't race GitHub twice. Recompute
 * scorecards afterward to pick up the fresh LOC.
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

export type SelfAssignedOverrideActionResult = { error?: string };

/**
 * Force a specific Jira to count (or not count) as self-assigned, overriding
 * the computed reporter === credited-person comparison — see
 * resolveSelfAssigned in build.ts. Keyed by jiraKey alone (not per-quarter):
 * the override applies wherever that Jira is ever encountered. Superuser-
 * only. Recomputes quarterKey immediately (rather than requiring a separate
 * manual Recompute click) so the correction is visible right away for the
 * quarter the superuser was looking at when they made it.
 */
export async function setSelfAssignedOverride(
  jiraKey: string,
  selfAssigned: boolean,
  quarterKey: string,
  note?: string
): Promise<SelfAssignedOverrideActionResult> {
  const user = await requireRole("SUPERUSER");

  const key = jiraKey.trim().toUpperCase();
  if (!key) return { error: "Missing Jira key." };

  try {
    await db
      .insert(jiraSelfAssignedOverrides)
      .values({ jiraKey: key, selfAssigned, note: note?.trim() || null, setBy: user.id })
      .onConflictDoUpdate({
        target: jiraSelfAssignedOverrides.jiraKey,
        set: {
          selfAssigned,
          note: note?.trim() || null,
          setBy: user.id,
          updatedAt: new Date(),
        },
      });

    if (quarterFromKey(quarterKey)) {
      await buildScorecards(quarterKey);
    }
    revalidateTag(PERFORMANCE_SCORECARDS_TAG, "max");
    return {};
  } catch (err) {
    console.error("[performance-review] setSelfAssignedOverride failed:", err);
    return { error: err instanceof Error ? err.message : "Failed to set override." };
  }
}

/** Removes a self-assigned override, reverting that Jira to the computed
 * reporter === credited-person comparison. Superuser-only; same
 * immediate-recompute behavior as setSelfAssignedOverride. */
export async function clearSelfAssignedOverride(
  jiraKey: string,
  quarterKey: string
): Promise<SelfAssignedOverrideActionResult> {
  await requireRole("SUPERUSER");

  const key = jiraKey.trim().toUpperCase();
  if (!key) return { error: "Missing Jira key." };

  try {
    await db
      .delete(jiraSelfAssignedOverrides)
      .where(eq(jiraSelfAssignedOverrides.jiraKey, key));

    if (quarterFromKey(quarterKey)) {
      await buildScorecards(quarterKey);
    }
    revalidateTag(PERFORMANCE_SCORECARDS_TAG, "max");
    return {};
  } catch (err) {
    console.error("[performance-review] clearSelfAssignedOverride failed:", err);
    return { error: err instanceof Error ? err.message : "Failed to clear override." };
  }
}

export type UpdateVisibleColumnsResult = { error?: string };

/**
 * Persists which numeric leaderboard columns are visible — writes straight to
 * feature_flags.performanceReviewVisibleColumns (see visible-columns.ts,
 * read uncached, so this takes effect on the very next page load for
 * everyone). Superuser-only: this is a shared, org-wide default, not a
 * personal preference.
 */
export async function updateVisibleColumns(
  columns: SortKey[]
): Promise<UpdateVisibleColumnsResult> {
  await requireRole("SUPERUSER");

  if (!parseVisibleColumns(columns)) {
    return { error: "Select at least one column." };
  }

  await db
    .insert(featureFlags)
    .values({
      key: FEATURE_FLAGS.PERFORMANCE_REVIEW_VISIBLE_COLUMNS,
      value: columns,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: { value: columns, updatedAt: new Date() },
    });

  revalidateTag("feature-flags", "max");
  return {};
}

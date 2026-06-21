"use server";

import { revalidateTag } from "next/cache";
import { requireRole } from "@/lib/auth/server";
import { buildScorecards } from "@/lib/scorecard/build";
import { PERFORMANCE_SCORECARDS_TAG } from "@/lib/scorecard/cache-tags";
import { quarterFromKey } from "@/lib/scorecard/quarter";

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

import { revalidateTag } from "next/cache";
import { currentQuarter } from "@/lib/scorecard/quarter";
import { PERFORMANCE_SCORECARDS_TAG } from "@/lib/scorecard/cache-tags";
import { buildScorecards } from "@/lib/scorecard/build";
import { enqueueLocSyncJob, runLocSyncJob } from "@/lib/github/loc-sync";

// Bearer CRON_SECRET guard, mirroring keka-sync/github-sync. The schedule is
// registered the same way theirs is (no vercel.json in-repo) — daily, at
// midnight, is deliberately all this side-app needs; a full LOC sync scans
// every tracked repo's PRs and has historically taken 5-7 minutes on a real
// run (see loc_sync_jobs), so a tighter cadence would risk piling onto an
// already-running job for no benefit here.
//
// Always targets the CURRENT fiscal quarter — there's no UI picker at
// midnight, unlike the manual "Sync LOC" button (performance-review/actions.ts)
// which lets a superuser pick. enqueueLocSyncJob's own dedup means this is
// safe to trigger even if a manual sync is mid-flight: it just reports the
// existing job instead of starting a second one.
export const maxDuration = 800; // Vercel caps this to the plan's actual max if lower.

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const quarterKey = currentQuarter().key;

  try {
    const enqueued = await enqueueLocSyncJob(quarterKey);
    if ("existing" in enqueued) {
      return Response.json({ quarterKey, skipped: true, reason: "already running" });
    }

    const result = await runLocSyncJob(enqueued.jobId, quarterKey);
    await buildScorecards(quarterKey);
    revalidateTag(PERFORMANCE_SCORECARDS_TAG, "max");

    return Response.json({
      quarterKey,
      prsScanned: result.prsScanned,
      matchesFound: result.matchesFound,
      rateLimited: result.rateLimited,
    });
  } catch (err) {
    console.error("[cron/loc-sync] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "LOC sync failed." },
      { status: 500 }
    );
  }
}

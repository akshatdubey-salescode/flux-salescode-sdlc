import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubSyncJobs } from "@/lib/db/schema";
import { enqueueSyncJob, runSyncJob } from "@/lib/github/sync-queue";

// Bearer CRON_SECRET guard, mirroring the calendar-sync cron. The schedule is
// registered the same way calendar-sync's is (no vercel.json in-repo) and must
// send `Authorization: Bearer ${CRON_SECRET}`. Daily is ample — contributor
// stats are weekly-granular; a daily run keeps the current week fresh.
//
// Runs the sync inline. Once warm, GitHub returns contributor stats instantly,
// so daily refreshes are quick; the heavy first population should be done via
// `pnpm sync:github` (no serverless time limit).
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

  const enqueued = await enqueueSyncJob();
  if ("error" in enqueued) {
    return Response.json(
      { error: "A GitHub sync is already running." },
      { status: 429 }
    );
  }

  // Only run when we created the job; if one was already active, just report it.
  if ("queued" in enqueued) {
    await runSyncJob(enqueued.jobId);
  }

  const [job] = await db
    .select()
    .from(githubSyncJobs)
    .where(eq(githubSyncJobs.id, enqueued.jobId))
    .limit(1);

  return Response.json(job);
}

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { locSyncJobs } from "@/lib/db/schema";
import { enqueueLocSyncJob, runLocSyncJob } from "@/lib/github/loc-sync";
import { currentQuarter } from "@/lib/scorecard/quarter";

// Bearer CRON_SECRET guard, mirroring github-sync. Runs against the current
// fiscal quarter only — a superuser can still trigger a specific past quarter
// manually from /performance-review.
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
  const enqueued = await enqueueLocSyncJob(quarterKey);

  if ("queued" in enqueued) {
    await runLocSyncJob(enqueued.jobId, quarterKey);
  }

  const [job] = await db.select().from(locSyncJobs).where(eq(locSyncJobs.id, enqueued.jobId)).limit(1);

  return Response.json(job);
}

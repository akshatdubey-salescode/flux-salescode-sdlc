import { after } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubSyncJobs } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";
import { enqueueSyncJob, runSyncJob } from "@/lib/github/sync-queue";

// Manual, on-demand trigger for superusers. Mirrors /api/projects/[id]/sync:
// enqueue, fire the work in after() so it's decoupled from the request, and
// return 202 immediately. The superuser panel polls GET for progress.
export async function POST() {
  await requireRole("SUPERUSER");

  const result = await enqueueSyncJob();
  if ("error" in result) {
    return Response.json(
      { error: "A GitHub sync is already running. Try again shortly." },
      { status: 429 }
    );
  }

  if ("queued" in result) {
    after(() => runSyncJob(result.jobId));
  }

  return Response.json(
    { jobId: result.jobId, status: "existing" in result ? "existing" : "queued" },
    { status: 202 }
  );
}

// Latest job, for the superuser panel to poll.
export async function GET() {
  await requireRole("SUPERUSER");

  const [job] = await db
    .select()
    .from(githubSyncJobs)
    .orderBy(desc(githubSyncJobs.createdAt))
    .limit(1);

  return Response.json(job ?? null);
}

import { after } from "next/server";
import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/server";
import { enqueueSyncJob, runSyncJob } from "@/lib/jira/sync-queue";

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<"/api/projects/[id]/sync">
) {
  await requireRole("SUPERUSER");
  const { id } = await ctx.params;

  const result = await enqueueSyncJob(id);

  if ("error" in result) {
    return Response.json(
      { error: "Too many syncs running. Try again shortly." },
      { status: 429 }
    );
  }

  const { jobId } = result;

  // Fire the sync after the response is sent — decoupled from the client connection
  if ("queued" in result) {
    after(() => runSyncJob(jobId));
  }

  return Response.json(
    { jobId, status: "existing" in result ? "existing" : "queued" },
    { status: 202 }
  );
}

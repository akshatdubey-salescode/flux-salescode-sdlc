import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { jiraSyncJobs } from "@/lib/db/schema";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/sync-jobs/[jobId]">
) {
  await requireRole("SUPERUSER");
  const { jobId } = await ctx.params;

  const [job] = await db
    .select({
      id: jiraSyncJobs.id,
      projectId: jiraSyncJobs.projectId,
      status: jiraSyncJobs.status,
      totalIssues: jiraSyncJobs.totalIssues,
      syncedCount: jiraSyncJobs.syncedCount,
      errorCount: jiraSyncJobs.errorCount,
      errorMessages: jiraSyncJobs.errorMessages,
      startedAt: jiraSyncJobs.startedAt,
      completedAt: jiraSyncJobs.completedAt,
      createdAt: jiraSyncJobs.createdAt,
    })
    .from(jiraSyncJobs)
    .where(eq(jiraSyncJobs.id, jobId))
    .limit(1);

  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  return Response.json(job);
}

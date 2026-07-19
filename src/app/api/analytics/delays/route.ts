import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/server";
import { cacheLife, cacheTag } from "next/cache";
import { rankByKey, type DelayLeader } from "@/lib/delay-tracker/leaderboard";

export type { DelayLeader };

export type DelayAnalyticsResponse = {
  byProject: DelayLeader[];
  byUser: DelayLeader[];
};

/**
 * Project-wise and user-wise breakdown of logged delay reasons, for the
 * "why are things delayed" dashboard panels. Ranked by total entries; each
 * row also surfaces its single most common reason category.
 */
export async function GET() {
  await requireAuth();

  try {
    const data = await fetchDelayAnalytics();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Delay analytics error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchDelayAnalytics(): Promise<DelayAnalyticsResponse> {
  "use cache";
  cacheLife("minutes");
  cacheTag("delay-logs");

  const [projectRows, userRows] = await Promise.all([
    db.execute(sql`
      SELECT
        dl.project_id, jp.name AS project_name, dl.category, COUNT(*)::int AS n
      FROM delay_logs dl
      JOIN jira_projects jp ON jp.id = dl.project_id
      WHERE dl.deleted_at IS NULL
      GROUP BY dl.project_id, jp.name, dl.category
    `),
    db.execute(sql`
      SELECT
        dl.responsible_email AS email, MAX(dl.responsible_name) AS name, dl.category, COUNT(*)::int AS n
      FROM delay_logs dl
      WHERE dl.responsible_email IS NOT NULL AND dl.deleted_at IS NULL
      GROUP BY dl.responsible_email, dl.category
    `),
  ]);

  const byProject = rankByKey(projectRows.rows as Record<string, unknown>[], "project_id", "project_name");
  const byUser = rankByKey(userRows.rows as Record<string, unknown>[], "email", "name");

  return { byProject, byUser };
}

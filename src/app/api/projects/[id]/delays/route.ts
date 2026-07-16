import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { categoryLabel } from "@/lib/delay-tracker/categories";
import { rankByKey, type DelayLeader } from "@/lib/delay-tracker/leaderboard";
import { isValidUuid } from "@/lib/delay-tracker/entries";

export type ProjectDelayCategoryCount = { category: string; label: string; count: number };

export type ProjectDelayAnalyticsResponse = {
  total: number;
  byCategory: ProjectDelayCategoryCount[];
  byUser: DelayLeader[];
};

/**
 * Delay-reason breakdown scoped to a single project — the same "why are
 * things delayed" analytics as the org dashboard's leaderboards, but for
 * this project's own Overview tab.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  await requireAuth();
  const { id: projectId } = await props.params;
  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Project id must be a valid UUID" }, { status: 400 });
  }

  try {
    const data = await fetchProjectDelayAnalytics(projectId);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Project delay analytics error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchProjectDelayAnalytics(
  projectId: string
): Promise<ProjectDelayAnalyticsResponse> {
  "use cache";
  cacheLife("minutes");
  cacheTag("delay-logs", `project:${projectId}`);

  const rows = (
    await db.execute(sql`
      SELECT
        dl.category,
        dl.responsible_email AS email,
        MAX(dl.responsible_name) AS name,
        COUNT(*)::int AS n
      FROM delay_logs dl
      WHERE dl.project_id = ${projectId}
      GROUP BY dl.category, dl.responsible_email
    `)
  ).rows as Record<string, unknown>[];

  const byCategory = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n);
    total += n;
    const category = r.category as string;
    byCategory.set(category, (byCategory.get(category) ?? 0) + n);
  }

  const categoryBreakdown: ProjectDelayCategoryCount[] = [...byCategory.entries()]
    .map(([category, count]) => ({ category, label: categoryLabel(category), count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  // byUser only makes sense for rows that actually name someone responsible —
  // byCategory above still counts every row, named or not.
  const userLeaders = rankByKey(rows.filter((r) => r.email), "email", "name");

  return { total, byCategory: categoryBreakdown, byUser: userLeaders };
}

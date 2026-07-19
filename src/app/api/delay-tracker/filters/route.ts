import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";

export type DelayFilterOptions = {
  projects: { id: string; name: string }[];
};

/**
 * Options for the /delay-tracker page's filter bar. Deliberately independent
 * of whatever filters are currently applied there — the project list always
 * reflects every project with an active delay logged, so narrowing by
 * category/person never shrinks the OTHER filters' own option lists.
 */
export async function GET() {
  await requireAuth();
  const data = await fetchDelayFilterOptions();
  return NextResponse.json(data);
}

async function fetchDelayFilterOptions(): Promise<DelayFilterOptions> {
  "use cache";
  cacheLife("minutes");
  cacheTag("delay-logs");

  const res = await db.execute(sql`
    SELECT DISTINCT jp.id, jp.name
    FROM delay_logs dl
    JOIN jira_projects jp ON jp.id = dl.project_id
    WHERE dl.deleted_at IS NULL
    ORDER BY jp.name
  `);

  const projects = (res.rows as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }));
  return { projects };
}

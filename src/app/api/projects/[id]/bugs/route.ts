import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { localDateStr } from "@/lib/date-utils";
import { loadBugRows, dateRangeConditions } from "@/lib/bug-summary-query";
import type { BugRow } from "@/lib/bug-summary";

/** Fallback window when the request omits an explicit range: last 30 days. */
function defaultRange(): { start: string; end: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 29);
  return { start: localDateStr(from), end: localDateStr(now) };
}

// Accept only YYYY-MM-DD; anything else falls back so a malformed query param
// can't poison the cache key or the SQL date cast.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id: projectId } = await props.params;
    const url = new URL(request.url);
    const fallback = defaultRange();
    const rawStart = url.searchParams.get("start");
    const rawEnd = url.searchParams.get("end");
    const start = rawStart && ISO_DATE.test(rawStart) ? rawStart : fallback.start;
    const end = rawEnd && ISO_DATE.test(rawEnd) ? rawEnd : fallback.end;
    const bugs = await fetchProjectBugs(projectId, start, end);
    return NextResponse.json({ bugs });
  } catch (error) {
    console.error("Project bugs error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchProjectBugs(
  projectId: string,
  start: string,
  end: string
): Promise<BugRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("projects", `project:${projectId}`);

  return loadBugRows([
    eq(jiraIssues.projectId, projectId),
    ...dateRangeConditions(start, end),
  ]);
}

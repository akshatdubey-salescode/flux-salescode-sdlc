import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { localDateStr, ALL_TIME_START } from "@/lib/date-utils";
import { fetchProjectBugs } from "@/lib/bug-summary-query";

/** Fallback window when the request omits an explicit range: all time.
 * Matches the bug-summary client's default (see its defaultRange) — a bug's
 * RCA-completeness is a whole-history concern, and RCAs get backfilled onto
 * old bugs, so a rolling window would silently drop those from the count. */
function defaultRange(): { start: string; end: string } {
  return { start: ALL_TIME_START, end: localDateStr(new Date()) };
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

import { NextResponse } from "next/server";
import { eq, or, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { localDateStr } from "@/lib/date-utils";
import { loadBugRows, dateRangeConditions } from "@/lib/bug-summary-query";
import type { BugRow } from "@/lib/bug-summary";

function defaultRange(): { start: string; end: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 29);
  return { start: localDateStr(from), end: localDateStr(now) };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const url = new URL(request.url);
    const fallback = defaultRange();
    const rawStart = url.searchParams.get("start");
    const rawEnd = url.searchParams.get("end");
    const start = rawStart && ISO_DATE.test(rawStart) ? rawStart : fallback.start;
    const end = rawEnd && ISO_DATE.test(rawEnd) ? rawEnd : fallback.end;
    const email = (url.searchParams.get("forEmail")?.trim() || user.email).toLowerCase();
    const bugs = await fetchMyBugs(email, start, end);
    return NextResponse.json({ bugs });
  } catch (error) {
    console.error("My bugs error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchMyBugs(
  email: string,
  start: string,
  end: string
): Promise<BugRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("projects", `bugs-owner:${email}`);

  // Bugs on this person's plate across every project: primary assignee or an
  // additional (multi-picker) assignee.
  const mine = or(
    eq(jiraIssues.assigneeEmail, email),
    sql`${email} = ANY(${jiraIssues.additionalAssigneeEmails})`
  )!;

  return loadBugRows([mine, ...dateRangeConditions(start, end)]);
}

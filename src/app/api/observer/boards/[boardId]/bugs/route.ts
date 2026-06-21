import { NextResponse } from "next/server";
import { eq, inArray, or, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraIssues, observerBoardMembers } from "@/lib/db/schema";
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

export async function GET(
  request: Request,
  props: { params: Promise<{ boardId: string }> }
) {
  try {
    await requireAuth();
    const { boardId } = await props.params;
    const url = new URL(request.url);
    const fallback = defaultRange();
    const rawStart = url.searchParams.get("start");
    const rawEnd = url.searchParams.get("end");
    const start = rawStart && ISO_DATE.test(rawStart) ? rawStart : fallback.start;
    const end = rawEnd && ISO_DATE.test(rawEnd) ? rawEnd : fallback.end;
    const bugs = await fetchTeamBugs(boardId, start, end);
    return NextResponse.json({ bugs });
  } catch (error) {
    console.error("Team bugs error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchTeamBugs(
  boardId: string,
  start: string,
  end: string
): Promise<BugRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("projects", `board:${boardId}`);

  const members = await db
    .select({ email: observerBoardMembers.email })
    .from(observerBoardMembers)
    .where(eq(observerBoardMembers.boardId, boardId));

  const emails = members.map((m) => m.email.toLowerCase());
  if (emails.length === 0) return [];

  // Assigned to any team member — primary or additional (multi-picker) assignee.
  const emailArray = sql`ARRAY[${sql.join(
    emails.map((e) => sql`${e}`),
    sql`, `
  )}]::text[]`;
  const assignedToTeam = or(
    inArray(jiraIssues.assigneeEmail, emails),
    sql`${jiraIssues.additionalAssigneeEmails} && ${emailArray}`
  )!;

  return loadBugRows([assignedToTeam, ...dateRangeConditions(start, end)]);
}

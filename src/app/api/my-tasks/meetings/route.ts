import { NextResponse } from "next/server";
import { and, eq, gte, lt } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { calendarEvents } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { userMeetingsTag } from "@/lib/google/cache-tags";
import { zonedDayStartToUtc } from "@/lib/google/time";
import type { MeetingEvent } from "@/app/api/observer/boards/[boardId]/meetings/route";

export type MyMeetingsResponse = {
  filterStart: string;
  filterEnd: string;
  totalMinutes: number;
  events: MeetingEvent[];
};

export async function GET(req: Request) {
  try {
    const user = await requireAuth();
    const url = new URL(req.url);
    const todayIso = new Date().toISOString().slice(0, 10);
    const filterStart = url.searchParams.get("start") ?? todayIso;
    const filterEnd = url.searchParams.get("end") ?? filterStart;

    const tz = url.searchParams.get("tz") ?? null;
    const data = await fetchMyMeetings(user.id, filterStart, filterEnd, tz);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[my-tasks/meetings] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchMyMeetings(
  userId: string,
  filterStart: string,
  filterEnd: string,
  tz: string | null
): Promise<MyMeetingsResponse> {
  "use cache";
  cacheLife("minutes");
  cacheTag(userMeetingsTag(userId));

  // Half-open day range in the caller's wall clock. With tz the bounds line
  // up with local midnight; without, this collapses to the old UTC behavior.
  const rangeStart = zonedDayStartToUtc(filterStart, tz);
  const dayAfter = new Date(`${filterEnd}T00:00:00Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const rangeEndExclusive = zonedDayStartToUtc(
    dayAfter.toISOString().slice(0, 10),
    tz
  );

  const rows = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, userId),
        gte(calendarEvents.startsAt, rangeStart),
        lt(calendarEvents.startsAt, rangeEndExclusive)
      )
    );

  const events: MeetingEvent[] = rows
    .filter((r) => !r.isAllDay)
    .map((r) => ({
      id: r.id,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      durationMinutes: Math.max(
        0,
        Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60000)
      ),
      summary: r.summary,
      visibility: r.visibility,
      organizerEmail: r.organizerEmail,
      attendeeEmails: r.attendeeEmails,
      htmlLink: r.htmlLink,
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const totalMinutes = events.reduce((s, e) => s + e.durationMinutes, 0);

  return { filterStart, filterEnd, totalMinutes, events };
}

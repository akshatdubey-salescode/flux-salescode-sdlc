import { NextResponse } from "next/server";
import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendarEvents } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
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

    // [filterStart 00:00 UTC, filterEnd+1 00:00 UTC) — inclusive day range.
    const rangeStart = new Date(`${filterStart}T00:00:00Z`);
    const rangeEndExclusive = new Date(`${filterEnd}T00:00:00Z`);
    rangeEndExclusive.setUTCDate(rangeEndExclusive.getUTCDate() + 1);

    const rows = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, user.id),
          gte(calendarEvents.startsAt, rangeStart),
          lt(calendarEvents.startsAt, rangeEndExclusive)
        )
      );

    const events: MeetingEvent[] = rows
      .filter((r) => !r.isAllDay) // skip PTO / holiday blocks
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

    return NextResponse.json({
      filterStart,
      filterEnd,
      totalMinutes,
      events,
    } satisfies MyMeetingsResponse);
  } catch (err) {
    console.error("[my-tasks/meetings] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

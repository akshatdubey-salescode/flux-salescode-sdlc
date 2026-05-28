import { NextResponse } from "next/server";
import { and, eq, gte, lt, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  observerBoards,
  observerBoardMembers,
  calendarEvents,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

type Params = { params: Promise<{ boardId: string }> };

export type MeetingEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  summary: string | null; // null when private/confidential
  visibility: string | null;
  organizerEmail: string | null;
  attendeeEmails: string[];
  htmlLink: string | null;
};

export type MeetingsMember = {
  memberId: string;
  email: string;
  name: string;
  totalMinutes: number;
  eventCount: number;
  events: MeetingEvent[];
};

export type MeetingsResponse = {
  filterStart: string;
  filterEnd: string;
  byMember: MeetingsMember[];
};

export async function GET(req: Request, { params }: Params) {
  try {
    await requireAuth();
    const { boardId } = await params;
    const url = new URL(req.url);
    const todayIso = new Date().toISOString().slice(0, 10);
    const filterStart = url.searchParams.get("start") ?? todayIso;
    const filterEnd = url.searchParams.get("end") ?? filterStart;

    const data = await fetchMeetings(boardId, filterStart, filterEnd);
    if (data === null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("[meetings] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchMeetings(
  boardId: string,
  filterStart: string,
  filterEnd: string
): Promise<MeetingsResponse | null> {
  const [board] = await db
    .select({ id: observerBoards.id })
    .from(observerBoards)
    .where(eq(observerBoards.id, boardId));
  if (!board) return null;

  const members = await db
    .select()
    .from(observerBoardMembers)
    .where(eq(observerBoardMembers.boardId, boardId));

  if (members.length === 0) {
    return { filterStart, filterEnd, byMember: [] };
  }

  // Inclusive day range: [filterStart 00:00 UTC, filterEnd+1 00:00 UTC)
  // Using UTC here matches how we store starts_at/ends_at (timestamptz).
  const rangeStart = new Date(`${filterStart}T00:00:00Z`);
  const rangeEndExclusive = new Date(`${filterEnd}T00:00:00Z`);
  rangeEndExclusive.setUTCDate(rangeEndExclusive.getUTCDate() + 1);

  const emails = members.map((m) => m.email.toLowerCase());
  // calendar_events.user_id is the user's email (users.id is email).
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        inArray(calendarEvents.userId, emails),
        gte(calendarEvents.startsAt, rangeStart),
        lt(calendarEvents.startsAt, rangeEndExclusive)
      )
    );

  const byEmail = new Map<string, MeetingEvent[]>();
  for (const r of rows) {
    if (r.isAllDay) continue; // skip all-day blocks (PTO, holidays) from meeting hours
    const duration = Math.max(
      0,
      Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60000)
    );
    const list = byEmail.get(r.userId) ?? [];
    list.push({
      id: r.id,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      durationMinutes: duration,
      summary: r.summary,
      visibility: r.visibility,
      organizerEmail: r.organizerEmail,
      attendeeEmails: r.attendeeEmails,
      htmlLink: r.htmlLink,
    });
    byEmail.set(r.userId, list);
  }

  const byMember: MeetingsMember[] = members.map((m) => {
    const events = byEmail.get(m.email.toLowerCase()) ?? [];
    events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const totalMinutes = events.reduce((s, e) => s + e.durationMinutes, 0);
    return {
      memberId: m.id,
      email: m.email,
      name: m.name,
      totalMinutes,
      eventCount: events.length,
      events,
    };
  });

  return { filterStart, filterEnd, byMember };
}

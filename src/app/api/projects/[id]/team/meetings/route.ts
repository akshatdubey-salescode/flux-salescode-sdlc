import { NextResponse } from "next/server";
import { and, eq, gte, lt, inArray, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraProjects, calendarEvents } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { userMeetingsTag } from "@/lib/google/cache-tags";
import { zonedDayStartToUtc } from "@/lib/google/time";

// Re-export the same types as the board meetings route so client components
// (TeamGanttClient) are interchangeable across observer and project views.
export type {
  MeetingEvent,
  MeetingsMember,
  MeetingsResponse,
} from "@/app/api/observer/boards/[boardId]/meetings/route";

import type {
  MeetingEvent,
  MeetingsMember,
  MeetingsResponse,
} from "@/app/api/observer/boards/[boardId]/meetings/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    await requireAuth();
    const { id: projectId } = await params;
    const url = new URL(req.url);
    const todayIso = new Date().toISOString().slice(0, 10);
    const filterStart = url.searchParams.get("start") ?? todayIso;
    const filterEnd = url.searchParams.get("end") ?? filterStart;
    const tz = url.searchParams.get("tz") ?? null;

    const data = await fetchMeetings(projectId, filterStart, filterEnd, tz);
    if (data === null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("[project-team-meetings] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchMeetings(
  projectId: string,
  filterStart: string,
  filterEnd: string,
  tz: string | null
): Promise<MeetingsResponse | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("projects", `project:${projectId}`);

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId));
  if (!project) return null;

  // Derive members from assignees in this project (same logic as the
  // project team timeline route).
  const membersRes = await db.execute(sql`
    SELECT DISTINCT
      lower(ji.assignee_email) AS email,
      COALESCE(MIN(ji.assignee_name), lower(ji.assignee_email)) AS name
    FROM jira_issues ji
    WHERE ji.project_id = ${projectId}
      AND ji.assignee_email IS NOT NULL
      AND ji.assignee_email != ''
    GROUP BY lower(ji.assignee_email)
    ORDER BY name
  `);

  type MemberRow = { email: string; name: string };
  const members = membersRes.rows as MemberRow[];

  for (const m of members) {
    cacheTag(userMeetingsTag(m.email));
  }

  if (members.length === 0) {
    return { filterStart, filterEnd, byMember: [] };
  }

  // Half-open day range in the viewer's wall clock when tz is supplied.
  const rangeStart = zonedDayStartToUtc(filterStart, tz);
  const dayAfter = new Date(`${filterEnd}T00:00:00Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const rangeEndExclusive = zonedDayStartToUtc(
    dayAfter.toISOString().slice(0, 10),
    tz
  );

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

  const byMember: MeetingsMember[] = members.map((m, idx) => {
    const events = byEmail.get(m.email.toLowerCase()) ?? [];
    events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const totalMinutes = events.reduce((s, e) => s + e.durationMinutes, 0);
    return {
      memberId: `proj-member-${idx}`,
      email: m.email,
      name: m.name,
      totalMinutes,
      eventCount: events.length,
      events,
    };
  });

  return { filterStart, filterEnd, byMember };
}

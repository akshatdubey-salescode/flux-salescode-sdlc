import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sprints } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { createSchedule, getScheduleRow, listSchedulesForTarget } from "@/lib/scheduled-processes/store";
import { firstRunOn, istToday } from "@/lib/scheduled-processes/recurrence";
import { parseScheduleBody } from "@/lib/scheduled-processes/validate";

// The recurring half of the sprint's email dialog: what's scheduled on this
// sprint (GET) and "repeat this update" (POST). The one-off send stays at
// ../email — same recipients, same message, same builders; the only
// difference is whether it goes now or at midnight.

const PROCESS = "sprint_progress_email";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  // A schedule carries its recipient list and the note that goes with it —
  // manager-level detail, gated like the send itself rather than like the
  // sprint's public progress.
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const schedules = await listSchedulesForTarget(PROCESS, id);
  return NextResponse.json({ schedules });
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  // Scheduling an outward update is the same manager action as sending one.
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseScheduleBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const [sprint] = await db
    .select({
      id: sprints.id,
      deletedAt: sprints.deletedAt,
      completedAt: sprints.completedAt,
      endDate: sprints.endDate,
    })
    .from(sprints)
    .where(eq(sprints.id, id))
    .limit(1);
  if (!sprint || sprint.deletedAt) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }
  // A sprint that's closed — or whose end date has gone by — would send one
  // wrap-up mail and retire on its first run, which is not what anyone means
  // by "schedule this". Say so instead of accepting a one-shot schedule.
  if (sprint.completedAt || sprint.endDate < istToday()) {
    return NextResponse.json(
      {
        error: sprint.completedAt
          ? "This sprint is closed — send a one-off update instead of scheduling one"
          : "This sprint's end date has passed — send a one-off update instead of scheduling one",
      },
      { status: 409 }
    );
  }

  const first = firstRunOn(parsed.value.cadence);
  if ("ended" in first) {
    return NextResponse.json({ error: "That cadence has no upcoming run" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const scheduleId = await createSchedule({
    process: PROCESS,
    targetId: id,
    ...parsed.value,
    firstRunOn: first.nextRunOn,
    createdBy: user.id,
    // Denormalized now, because the midnight run has no session to read a
    // sender name from later.
    createdByName: session?.user?.name?.trim() || user.email,
  });

  const schedule = await getScheduleRow(scheduleId);
  return NextResponse.json({ schedule }, { status: 201 });
}

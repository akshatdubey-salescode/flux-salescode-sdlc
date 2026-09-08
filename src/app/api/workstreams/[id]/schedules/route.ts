import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { fetchWorkstreamById } from "@/lib/sprints/entries";
import { workstreamHasFinished } from "@/lib/sprints/lifecycle";
import { createSchedule, getScheduleRow, listSchedulesForTarget } from "@/lib/scheduled-processes/store";
import { firstRunOn, istToday } from "@/lib/scheduled-processes/recurrence";
import { parseScheduleBody } from "@/lib/scheduled-processes/validate";

// The recurring half of the workstream's email dialog: what's scheduled on
// this workstream (GET) and "repeat this update" (POST). The sprint twin lives
// at /api/sprints/[id]/schedules and this is deliberately the same shape —
// same body, same validation, same store — because the only thing that
// differs between them is which handler the row names.

const PROCESS = "workstream_progress_email";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  // A schedule carries its recipient list and the note that goes with it —
  // manager-level detail, gated like the send itself rather than like the
  // workstream's public progress.
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

  // The full read, rather than a count: it's the same data the handler will
  // judge every night, so "would this schedule ever send anything?" is
  // answered by exactly the rule that decides the final send.
  const result = await fetchWorkstreamById(id);
  if (!result) {
    return NextResponse.json({ error: "Workstream not found" }, { status: 404 });
  }
  const { sprints } = result;

  if (sprints.length === 0) {
    return NextResponse.json(
      { error: "This workstream has no sprints yet — move sprints in before scheduling updates" },
      { status: 409 }
    );
  }
  // Every sprint already finished means one wrap-up mail and retirement on the
  // first run, which is not what anyone means by "schedule this". Say so
  // instead of accepting a one-shot schedule.
  if (workstreamHasFinished(sprints, istToday())) {
    return NextResponse.json(
      {
        error:
          "Every sprint in this workstream has finished — send a one-off update instead of scheduling one",
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

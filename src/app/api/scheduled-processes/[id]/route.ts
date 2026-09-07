import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import {
  getSchedule,
  getScheduleRow,
  pauseSchedule,
  resumeSchedule,
  softDeleteSchedule,
  updateSchedule,
} from "@/lib/scheduled-processes/store";
import { firstRunOn } from "@/lib/scheduled-processes/recurrence";
import { parseRecipients, parseScheduleBody } from "@/lib/scheduled-processes/validate";

// Pause, resume, edit and delete one schedule — the actions behind both the
// sprint dialog's list and the superuser table.

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const row = await getSchedule(id);
  if (!row) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  if (body.action === "pause") {
    if (row.stoppedAt) {
      return NextResponse.json({ error: "This schedule has already stopped" }, { status: 409 });
    }
    await pauseSchedule(id, user.id);
    return NextResponse.json({ schedule: await getScheduleRow(id) });
  }

  if (body.action === "resume") {
    // Stopped is terminal by design — its target is closed or gone, so there
    // is nothing to resume into. Scheduling afresh is the way back.
    if (row.stoppedAt) {
      return NextResponse.json(
        { error: "This schedule has stopped for good — create a new one instead" },
        { status: 409 }
      );
    }
    await resumeSchedule(row);
    return NextResponse.json({ schedule: await getScheduleRow(id) });
  }

  // Recipients-only edit: the common change by far ("add Priya to the weekly
  // update"), and deliberately narrow — it can't disturb the cadence or the
  // next run the way a full edit does.
  if (body.action === "setRecipients") {
    const parsed = parseRecipients(body.recipients);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    await updateSchedule(id, { recipients: parsed.value });
    return NextResponse.json({ schedule: await getScheduleRow(id) });
  }

  // Full edit — same validation as create.
  const parsed = parseScheduleBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const cadenceChanged =
    parsed.value.cadence.frequency !== row.frequency ||
    (parsed.value.cadence.dayOfWeek ?? null) !== row.dayOfWeek ||
    (parsed.value.cadence.dayOfMonth ?? null) !== row.dayOfMonth;

  // A new cadence has to re-base next_run_on, or the row would keep the day
  // the old cadence picked and fire on a date the new one never implies.
  let nextRunOn: string | undefined;
  if (cadenceChanged) {
    const next = firstRunOn(parsed.value.cadence);
    if ("ended" in next) {
      return NextResponse.json({ error: "That cadence has no upcoming run" }, { status: 400 });
    }
    nextRunOn = next.nextRunOn;
  }

  await updateSchedule(id, { ...parsed.value, nextRunOn });
  return NextResponse.json({ schedule: await getScheduleRow(id) });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = await getSchedule(id);
  if (!row) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  const session = await getServerSession(authOptions);
  // Soft delete, the sprints/delay_logs idiom: the run history stays readable.
  await softDeleteSchedule(id, { id: user.id, name: session?.user?.name?.trim() || user.email });
  return NextResponse.json({ ok: true });
}

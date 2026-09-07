import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { isValidUuid } from "@/lib/validation";
import { getSchedule, getScheduleRow } from "@/lib/scheduled-processes/store";
import { runSchedule } from "@/lib/scheduled-processes/dispatch";
import { istToday } from "@/lib/scheduled-processes/recurrence";

// "Run now" — send this schedule's mail immediately, without waiting for
// midnight. It is the retry button for a failed night, and the way to test a
// schedule end to end before trusting it to the cron.
//
// Runs through the same dispatcher the cron uses (so it is logged, advanced
// and stopped by exactly the same rules), with trigger "manual" — the
// once-a-night claim doesn't apply to a person pressing a button.

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
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

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  const outcome = await runSchedule(row, {
    runOn: istToday(),
    appUrl,
    trigger: "manual",
  });

  const schedule = await getScheduleRow(id);
  if (outcome.status === "failed") {
    return NextResponse.json({ error: outcome.detail, schedule }, { status: 502 });
  }
  return NextResponse.json({ outcome, schedule });
}

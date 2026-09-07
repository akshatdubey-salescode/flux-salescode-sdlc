import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { listAllSchedules } from "@/lib/scheduled-processes/store";

// Every schedule in the app, for the superuser view. Live and soonest-due
// first; paused and stopped rows stay listed because "why did this stop
// mailing?" is the question the list exists to answer.
export async function GET() {
  const user = await requireAuth();
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const schedules = await listAllSchedules();
  return NextResponse.json({ schedules });
}

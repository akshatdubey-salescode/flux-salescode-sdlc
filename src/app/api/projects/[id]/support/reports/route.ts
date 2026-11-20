import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { istToday } from "@/lib/scheduled-processes/recurrence";
import { buildSupportReport } from "@/lib/support/build";
import { canApproveReports, isSendEnabled } from "@/lib/support/send";
import { getSettings, listReports, NotFoundError } from "@/lib/support/store";
import { displayName, guardProject, requireApprover } from "@/lib/support/route-guard";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  const blocked = await guardProject(id);
  if (blocked) return blocked;
  // listReports already leaves out the large `data` payload.
  const [reports, settings] = await Promise.all([listReports(id, 60), getSettings(id)]);
  return NextResponse.json({
    reports,
    canApprove: canApproveReports(user, settings),
    sendEnabled: isSendEnabled(),
    today: istToday(),
  });
}

// "Build now": first day, or a missed cron. Allowed while sending is disabled.
// Lapses older unapproved reports (inside buildSupportReport) but never notifies
// approvers; the 17:00 cron still sends today's notice.
export async function POST(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  const blocked = await guardProject(id);
  if (blocked) return blocked;
  const gate = await requireApprover(user, id);
  if ("res" in gate) return gate.res;
  try {
    const result = await buildSupportReport(id, istToday(), { id: user.id, name: await displayName(user) });
    if ("blocked" in result) {
      return NextResponse.json({ error: "Today's report is no longer awaiting approval (sending, sent or failed)" }, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

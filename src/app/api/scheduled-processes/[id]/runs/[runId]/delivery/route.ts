import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { isValidUuid } from "@/lib/validation";
import { getRun } from "@/lib/scheduled-processes/store";
import type { DeliveryStatus } from "@/lib/scheduled-processes/types";

// Did it actually arrive?
//
// A run marked "sent" only means Resend ACCEPTED the mail — a bounce or a spam
// complaint happens afterwards and would otherwise be invisible here. This asks
// the provider what became of each message the run produced
// (resend.emails.get → last_event), which is the difference between "we sent
// it" and "it landed".
//
// On demand rather than on every list load: it's one provider call per message,
// and the answer only matters when someone is actually asking.

type Params = { params: Promise<{ id: string; runId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id, runId } = await params;
  if (!isValidUuid(id) || !isValidUuid(runId)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Scoped to the schedule in the path, so a run id can't be used to read
  // another schedule's delivery detail.
  const run = await getRun(runId, id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (run.providerMessageIds.length === 0) {
    return NextResponse.json({
      statuses: [],
      // Runs from before this was recorded, and every failed or skipped run,
      // have no provider id to ask about — say so rather than showing nothing.
      note:
        run.status === "sent"
          ? "This run was sent before delivery tracking was added, so there's no message to check."
          : `Nothing was sent on this run (${run.status}), so there's no delivery to check.`,
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY missing)" }, { status: 503 });
  }

  const { Resend } = await import("resend");
  const client = new Resend(apiKey);

  const statuses: DeliveryStatus[] = [];
  const errors: string[] = [];
  for (const messageId of run.providerMessageIds) {
    const { data, error } = await client.emails.get(messageId);
    if (error || !data) {
      errors.push(`${messageId}: ${error?.message ?? "not found at the provider"}`);
      continue;
    }
    statuses.push({
      messageId,
      to: data.to ?? [],
      lastEvent: data.last_event,
      subject: data.subject ?? null,
    });
  }

  return NextResponse.json({ statuses, errors: errors.length > 0 ? errors : undefined });
}

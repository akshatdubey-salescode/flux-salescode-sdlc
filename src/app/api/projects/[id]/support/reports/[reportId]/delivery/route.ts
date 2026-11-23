import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { guardReport, requireApprover } from "@/lib/support/route-guard";

// Did it actually arrive? Asks the provider for the last event on the message
// (same idea as the scheduled-process delivery check). On demand only.

type Params = { params: Promise<{ id: string; reportId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id, reportId } = await params;
  const g = await guardReport(id, reportId);
  if ("res" in g) return g.res;
  const gate = await requireApprover(user, id);
  if ("res" in gate) return gate.res;

  const messageId = g.report.providerMessageId;
  if (!messageId) {
    return NextResponse.json({ error: "No message was sent for this report" }, { status: 404 });
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY missing)" }, { status: 503 });
  }
  const { Resend } = await import("resend");
  const { data, error } = await new Resend(apiKey).emails.get(messageId);
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Message not found at the provider" },
      { status: 502 },
    );
  }
  return NextResponse.json({ lastEvent: data.last_event });
}

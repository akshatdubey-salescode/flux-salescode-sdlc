import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { fetchWorkstreamById } from "@/lib/sprints/entries";
import {
  MAX_MESSAGE,
  MAX_RECIPIENTS,
  MAX_SUBJECT,
  previewWorkstreamProgressEmail,
  sendWorkstreamProgressEmail,
} from "@/lib/sprints/send-progress-email";

// Manual "send progress to stakeholders" for a WORKSTREAM — the initiative
// view: cross-sprint stat tiles and bars, a per-sprint breakdown table, a
// deep link to /workstreams/[id], and the combined multi-sprint Excel report
// attached.
//
// Auth, validation and the HTTP response only: the email itself is built and
// sent by send-progress-email.ts, which the midnight scheduler calls too, so
// a scheduled update can never drift from what this route previews.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  let body: { recipients?: unknown; subject?: unknown; message?: unknown; preview?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const isPreview = body.preview === true;
  const recipients = Array.isArray(body.recipients)
    ? [...new Set(body.recipients.map((r) => String(r).trim().toLowerCase()).filter(Boolean))]
    : [];
  if (!isPreview) {
    if (recipients.length === 0) {
      return NextResponse.json({ error: "recipients must be a non-empty array of emails" }, { status: 400 });
    }
    if (recipients.length > MAX_RECIPIENTS) {
      return NextResponse.json({ error: `At most ${MAX_RECIPIENTS} recipients per send` }, { status: 400 });
    }
    const bad = recipients.filter((r) => !EMAIL_RE.test(r));
    if (bad.length > 0) {
      return NextResponse.json({ error: `Invalid email address: ${bad[0]}` }, { status: 400 });
    }
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";
  const customSubject = typeof body.subject === "string" ? body.subject.trim().slice(0, MAX_SUBJECT) : "";

  const result = await fetchWorkstreamById(id);
  if (!result) {
    return NextResponse.json({ error: "Workstream not found" }, { status: 404 });
  }
  const { workstream, sprints } = result;

  const session = await getServerSession(authOptions);
  const senderName = session?.user?.name?.trim() || user.email;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin).replace(/\/$/, "");

  // Preview mode: return the exact subject + HTML that a send would produce
  // (same builder, same inputs) without sending anything.
  if (isPreview) {
    return NextResponse.json(
      previewWorkstreamProgressEmail({
        workstream,
        sprints,
        subject: customSubject,
        message,
        senderName,
        appUrl,
      })
    );
  }

  try {
    const sent = await sendWorkstreamProgressEmail({
      workstream,
      sprints,
      recipients,
      subject: customSubject,
      message,
      senderName,
      appUrl,
    });
    return NextResponse.json({ ok: true, sent: sent.recipientCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Email failed";
    // A missing API key is configuration, not a transport failure.
    const status = msg.includes("RESEND_API_KEY") ? 503 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}

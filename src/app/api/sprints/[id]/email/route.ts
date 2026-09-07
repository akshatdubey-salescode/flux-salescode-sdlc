import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { fetchSprintById } from "@/lib/sprints/entries";
import { buildSprintWorkbook } from "@/lib/sprints/report";
import { buildSprintEmail } from "@/lib/sprints/email-progress";

// Manual "send progress to stakeholders" — an on-demand email with a visual
// progress summary (bar + stat tiles + item table), a deep link back to the
// sprint in Flux, and the full Excel report attached. (Scheduling can layer
// on top of this route later.)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 25;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 4000;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  // Same gate as the rest of sprint management — sending an outward update
  // is a manager action.
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

  const sprint = await fetchSprintById(id);
  if (!sprint) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }

  const session = await getServerSession(authOptions);
  const senderName = session?.user?.name?.trim() || user.email;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  const sprintUrl = `${appUrl}/sprints/${sprint.id}`;

  // Preview mode: return the exact subject + HTML that a send would produce
  // (same builder, same inputs) without sending anything.
  if (isPreview) {
    const built = buildSprintEmail(sprint, message, senderName, sprintUrl);
    return NextResponse.json({
      subject: customSubject || built.subject,
      html: built.html,
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY missing)" }, { status: 503 });
  }

  const workbook = await buildSprintWorkbook([sprint]);
  const safeName = sprint.name.replace(/[^\w-]+/g, "_");

  const built = buildSprintEmail(sprint, message, senderName, sprintUrl);

  const { Resend } = await import("resend");
  const client = new Resend(apiKey);
  const { error } = await client.emails.send({
    from: process.env.EMAIL_FROM ?? "Flux <noreply@example.com>",
    to: recipients,
    subject: customSubject || built.subject,
    html: built.html,
    attachments: [{ filename: `${safeName}-report.xlsx`, content: Buffer.from(workbook) }],
  });
  if (error) {
    return NextResponse.json({ error: `Email failed: ${error.message}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, sent: recipients.length });
}

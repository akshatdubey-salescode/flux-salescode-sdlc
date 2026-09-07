import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { fetchSprintById, type SprintWithItems } from "@/lib/sprints/entries";
import { buildSprintWorkbook } from "@/lib/sprints/report";
import {
  esc,
  tile,
  bar,
  pctColor,
  ctaButton,
  emailShell,
  senderLine,
  messageBlock,
  phaseBadge,
  PROGRESS_LABELS,
  PROGRESS_COLORS,
} from "@/lib/sprints/email-html";

// Manual "send progress to stakeholders" — an on-demand email with a visual
// progress summary (bar + stat tiles + item table), a deep link back to the
// sprint in Flux, and the full Excel report attached. (Scheduling can layer
// on top of this route later.)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 25;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 4000;
const MAX_INLINE_ITEMS = 60;

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
    return NextResponse.json({
      subject: customSubject || buildSubject(sprint),
      html: buildHtml(sprint, message, senderName, sprintUrl),
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY missing)" }, { status: 503 });
  }

  const workbook = await buildSprintWorkbook([sprint]);
  const safeName = sprint.name.replace(/[^\w-]+/g, "_");

  const { Resend } = await import("resend");
  const client = new Resend(apiKey);
  const { error } = await client.emails.send({
    from: process.env.EMAIL_FROM ?? "Flux <noreply@example.com>",
    to: recipients,
    subject: customSubject || buildSubject(sprint),
    html: buildHtml(sprint, message, senderName, sprintUrl),
    attachments: [{ filename: `${safeName}-report.xlsx`, content: Buffer.from(workbook) }],
  });
  if (error) {
    return NextResponse.json({ error: `Email failed: ${error.message}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, sent: recipients.length });
}

// ---- Email content ----------------------------------------------------------

function phaseText(s: SprintWithItems): string {
  if (s.completedAt) return "Completed";
  if (s.startedAt) return "Active";
  return "Planned";
}

function buildSubject(s: SprintWithItems): string {
  const r = s.rollup;
  if (s.startedAt && r.committed > 0) {
    const pct = Math.round((r.committedDone / r.committed) * 100);
    return `Sprint update: ${s.name} — ${pct}% of commitment done (${s.startDate} → ${s.endDate})`;
  }
  return `Sprint update: ${s.name} (${s.startDate} → ${s.endDate})`;
}

function buildHtml(s: SprintWithItems, message: string, senderName: string, sprintUrl: string): string {
  const r = s.rollup;
  const committedPct = r.committed > 0 ? Math.round((r.committedDone / r.committed) * 100) : 0;
  const overallPct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;

  const badge = phaseBadge(
    phaseText(s),
    s.completedAt ? "completed" : s.startedAt ? "active" : "planned"
  );

  const tiles = s.startedAt
    ? [
        tile("Committed", String(r.committed)),
        tile("Commitment done", `${committedPct}%`, pctColor(committedPct)),
        tile("In progress", String(r.inProgress), "#1d4ed8"),
        tile("To do", String(r.todo)),
        ...(r.addedAfterStart > 0 ? [tile("Added after start", String(r.addedAfterStart), "#b45309")] : []),
        ...(r.removed > 0 ? [tile("Removed", String(r.removed), "#6b7280")] : []),
      ]
    : [
        tile("Planned issues", String(r.total)),
        tile("Done", String(r.done), "#047857"),
        tile("In progress", String(r.inProgress), "#1d4ed8"),
        tile("To do", String(r.todo)),
      ];

  const shown = s.items.slice(0, MAX_INLINE_ITEMS);
  const itemRows = shown
    .map((item, i) => {
      const scope = !s.startedAt ? "" : item.committed ? "" : ` <span style="color:#b45309;font-size:11px;">*added mid-sprint</span>`;
      const link = `${item.jiraBaseUrl.replace(/\/$/, "")}/browse/${item.jiraKey}`;
      return `<tr style="background:${i % 2 === 1 ? "#f0fdfa" : "#ffffff"};">
        <td style="padding:5px 8px;font-size:12px;white-space:nowrap;border-bottom:1px solid #f4f4f5;"><a href="${link}" style="color:#0f766e;font-weight:600;text-decoration:none;">${esc(item.jiraKey)}</a></td>
        <td style="padding:5px 8px;font-size:12px;color:#111827;border-bottom:1px solid #f4f4f5;">${esc(item.summary)}${scope}</td>
        <td style="padding:5px 8px;font-size:12px;white-space:nowrap;font-weight:600;color:${PROGRESS_COLORS[item.progress]};border-bottom:1px solid #f4f4f5;">${PROGRESS_LABELS[item.progress]}</td>
        <td style="padding:5px 8px;font-size:12px;white-space:nowrap;color:#6b7280;border-bottom:1px solid #f4f4f5;">${esc(item.assigneeName ?? "Unassigned")}</td>
        <td style="padding:5px 8px;font-size:12px;white-space:nowrap;color:#6b7280;border-bottom:1px solid #f4f4f5;">${item.dueDate ?? "—"}</td>
      </tr>`;
    })
    .join("");
  const moreLine =
    s.items.length > shown.length
      ? `<p style="font-size:12px;color:#6b7280;">…and ${s.items.length - shown.length} more — full detail in the attached report.</p>`
      : "";

  const body = `
      ${senderLine(badge, senderName)}
      ${messageBlock(message)}
      <table cellpadding="0" cellspacing="0"><tr>${tiles.join("")}</tr></table>
      <div style="margin:8px 0 4px;font-size:12px;color:#6b7280;">Overall progress — <strong style="color:#111827;">${r.done} of ${r.total} done (${overallPct}%)</strong></div>
      ${bar(overallPct, "#0d9488")}
      ${
        s.startedAt && r.committed > 0
          ? `<div style="margin:10px 0 4px;font-size:12px;color:#6b7280;">Committed scope — <strong style="color:#111827;">${r.committedDone} of ${r.committed} done (${committedPct}%)</strong></div>${bar(committedPct, "#1d4ed8")}`
          : ""
      }
      <div style="margin:18px 0;">${ctaButton(sprintUrl, "Open sprint in Flux →")}</div>
      <table cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-collapse:collapse;">
        <tr style="background:#0d9488;color:#ffffff;">
          <th align="left" style="padding:6px 8px;font-size:11px;">Key</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Summary</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Status</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Assignee</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Due</th>
        </tr>
        ${itemRows}
      </table>
      ${moreLine}
      <p style="font-size:12px;color:#6b7280;margin-top:16px;">The attached Excel report has the complete breakdown — every item with dates, risk, scope changes, and removals. Or <a href="${sprintUrl}" style="color:#0f766e;">open the live sprint in Flux</a>.</p>`;

  return emailShell(s.name, `${s.startDate} → ${s.endDate}${s.goal ? ` · ${esc(s.goal)}` : ""}`, body);
}

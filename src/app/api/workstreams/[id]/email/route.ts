import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { fetchWorkstreamById, type SprintWithItems } from "@/lib/sprints/entries";
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
} from "@/lib/sprints/email-html";

// Manual "send progress to stakeholders" for a WORKSTREAM — the initiative
// view: cross-sprint stat tiles and bars, a per-sprint breakdown table, a
// deep link to /workstreams/[id], and the combined multi-sprint Excel report
// attached.

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
  const workstreamUrl = `${appUrl}/workstreams/${workstream.id}`;

  // Preview mode: return the exact subject + HTML that a send would produce
  // (same builder, same inputs) without sending anything.
  if (isPreview) {
    return NextResponse.json({
      subject: customSubject || buildSubject(workstream.name, sprints),
      html: buildHtml(workstream.name, workstream.description, sprints, message, senderName, workstreamUrl, appUrl),
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Email is not configured (RESEND_API_KEY missing)" }, { status: 503 });
  }

  const workbook = await buildSprintWorkbook(sprints);
  const safeName = workstream.name.replace(/[^\w-]+/g, "_");

  const { Resend } = await import("resend");
  const client = new Resend(apiKey);
  const { error } = await client.emails.send({
    from: process.env.EMAIL_FROM ?? "Flux <noreply@example.com>",
    to: recipients,
    subject: customSubject || buildSubject(workstream.name, sprints),
    html: buildHtml(workstream.name, workstream.description, sprints, message, senderName, workstreamUrl, appUrl),
    attachments: [{ filename: `${safeName}-workstream-report.xlsx`, content: Buffer.from(workbook) }],
  });
  if (error) {
    return NextResponse.json({ error: `Email failed: ${error.message}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, sent: recipients.length });
}

// ---- Email content ----------------------------------------------------------

type Agg = {
  committed: number;
  committedDone: number;
  done: number;
  total: number;
  addedAfterStart: number;
  active: number;
  planned: number;
  completed: number;
};

function aggregate(sprints: SprintWithItems[]): Agg {
  const out: Agg = { committed: 0, committedDone: 0, done: 0, total: 0, addedAfterStart: 0, active: 0, planned: 0, completed: 0 };
  for (const s of sprints) {
    out.committed += s.rollup.committed;
    out.committedDone += s.rollup.committedDone;
    out.done += s.rollup.done;
    out.total += s.rollup.total;
    out.addedAfterStart += s.rollup.addedAfterStart;
    if (s.completedAt) out.completed += 1;
    else if (s.startedAt) out.active += 1;
    else out.planned += 1;
  }
  return out;
}

function buildSubject(name: string, sprints: SprintWithItems[]): string {
  const agg = aggregate(sprints);
  if (agg.committed > 0) {
    const pct = Math.round((agg.committedDone / agg.committed) * 100);
    return `Workstream update: ${name} — ${pct}% of commitment done across ${sprints.length} sprint${sprints.length === 1 ? "" : "s"}`;
  }
  return `Workstream update: ${name} (${sprints.length} sprint${sprints.length === 1 ? "" : "s"})`;
}

function sprintPhase(s: SprintWithItems): { label: string; kind: "planned" | "active" | "completed" } {
  if (s.completedAt) return { label: "Completed", kind: "completed" };
  if (s.startedAt) return { label: "Active", kind: "active" };
  return { label: "Planned", kind: "planned" };
}

function buildHtml(
  name: string,
  description: string | null,
  sprints: SprintWithItems[],
  message: string,
  senderName: string,
  workstreamUrl: string,
  appUrl: string
): string {
  const agg = aggregate(sprints);
  const committedPct = agg.committed > 0 ? Math.round((agg.committedDone / agg.committed) * 100) : 0;
  const overallPct = agg.total > 0 ? Math.round((agg.done / agg.total) * 100) : 0;
  const minStart = sprints.reduce<string | null>((m, s) => (m === null || s.startDate < m ? s.startDate : m), null);
  const maxEnd = sprints.reduce<string | null>((m, s) => (m === null || s.endDate > m ? s.endDate : m), null);

  const badge = phaseBadge(
    `${sprints.length} sprint${sprints.length === 1 ? "" : "s"} · ${agg.active} active`,
    agg.active > 0 ? "active" : agg.completed === sprints.length && sprints.length > 0 ? "completed" : "planned"
  );

  const tiles = [
    tile("Sprints", String(sprints.length)),
    ...(agg.committed > 0
      ? [tile("Committed", String(agg.committed)), tile("Commitment done", `${committedPct}%`, pctColor(committedPct))]
      : []),
    tile("Done", String(agg.done), "#047857"),
    tile("Total items", String(agg.total)),
    ...(agg.addedAfterStart > 0 ? [tile("Added after start", String(agg.addedAfterStart), "#b45309")] : []),
  ];

  const sprintRows = sprints
    .map((s, i) => {
      const phase = sprintPhase(s);
      const r = s.rollup;
      const pct = r.committed > 0 ? Math.round((r.committedDone / r.committed) * 100) : null;
      return `<tr style="background:${i % 2 === 1 ? "#f0fdfa" : "#ffffff"};">
        <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #f4f4f5;"><a href="${appUrl}/sprints/${s.id}" style="color:#0f766e;font-weight:600;text-decoration:none;">${esc(s.name)}</a></td>
        <td style="padding:6px 8px;font-size:12px;white-space:nowrap;color:#6b7280;border-bottom:1px solid #f4f4f5;">${s.startDate} → ${s.endDate}</td>
        <td style="padding:6px 8px;font-size:12px;white-space:nowrap;border-bottom:1px solid #f4f4f5;">${phaseBadge(phase.label, phase.kind)}</td>
        <td style="padding:6px 8px;font-size:12px;white-space:nowrap;color:#111827;border-bottom:1px solid #f4f4f5;">${
          pct !== null ? `<strong style="color:${pctColor(pct)};">${r.committedDone}/${r.committed} (${pct}%)</strong>` : "—"
        }</td>
        <td style="padding:6px 8px;font-size:12px;white-space:nowrap;color:#6b7280;border-bottom:1px solid #f4f4f5;">${r.done} done · ${r.inProgress} in progress · ${r.todo} to do</td>
      </tr>`;
    })
    .join("");

  const body = `
      ${senderLine(badge, senderName)}
      ${messageBlock(message)}
      <table cellpadding="0" cellspacing="0"><tr>${tiles.join("")}</tr></table>
      <div style="margin:8px 0 4px;font-size:12px;color:#6b7280;">Overall progress across sprints — <strong style="color:#111827;">${agg.done} of ${agg.total} done (${overallPct}%)</strong></div>
      ${bar(overallPct, "#0d9488")}
      ${
        agg.committed > 0
          ? `<div style="margin:10px 0 4px;font-size:12px;color:#6b7280;">Committed scope — <strong style="color:#111827;">${agg.committedDone} of ${agg.committed} done (${committedPct}%)</strong></div>${bar(committedPct, "#1d4ed8")}`
          : ""
      }
      <div style="margin:18px 0;">${ctaButton(workstreamUrl, "Open workstream in Flux →")}</div>
      <table cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-collapse:collapse;">
        <tr style="background:#0d9488;color:#ffffff;">
          <th align="left" style="padding:6px 8px;font-size:11px;">Sprint</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Time box</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Phase</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Commitment done</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Progress</th>
        </tr>
        ${sprintRows}
      </table>
      <p style="font-size:12px;color:#6b7280;margin-top:16px;">The attached Excel report has the complete breakdown of every sprint — all items with dates, risk, scope changes, and removals. Or <a href="${workstreamUrl}" style="color:#0f766e;">open the live workstream in Flux</a>.</p>`;

  return emailShell(
    name,
    `Workstream${minStart && maxEnd ? ` · ${minStart} → ${maxEnd}` : ""}${description ? ` · ${esc(description)}` : ""}`,
    body
  );
}

import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { freshdeskTickets, jiraProjects } from "@/lib/db/schema";
import { fdStatusLabel, fdPriorityLabel } from "@/lib/freshdesk/client";

const FD_STATUS_BY_LABEL: Record<string, number> = {
  "Open": 2, "Pending": 3, "Resolved": 4, "Closed": 5,
  "Waiting on Customer": 6, "Waiting on Third Party": 7,
};

const FD_PRIORITY_BY_LABEL: Record<string, number> = {
  "Low": 1, "Medium": 2, "High": 3, "Urgent": 4,
};

function parseIntOrLabel(value: number | string, labelMap: Record<string, number>): number {
  if (typeof value === "number") return value;
  const fromLabel = labelMap[value];
  if (fromLabel !== undefined) return fromLabel;
  return parseInt(String(value), 10);
}

// Freshdesk sends dates as "May 22 2026 at 04:49 PM IST" — not parseable by Date directly.
// Strip "at" and the trailing timezone abbreviation before parsing.
function parseFdDate(raw: string | null | undefined, fallback?: Date): Date | null {
  if (!raw || raw.trim() === "") return fallback ?? null;
  const normalized = raw.replace(" at ", " ").replace(/\s+[A-Z]{2,5}$/, "").trim();
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? (fallback ?? null) : d;
}

interface FreshdeskWebhookPayload {
  freshdesk_webhook: {
    ticket_id: number | string;
    ticket_subject: string;
    ticket_status: number | string;
    ticket_priority: number | string;
    ticket_type: string;
    requester_name: string;
    requester_email: string;
    ticket_due_by_time?: string;
    ticket_created_at: string;
    ticket_updated_at: string;
  };
}

// CAV project key — Freshdesk is scoped to CavinKare which maps to this project
const CAV_PROJECT_KEY = "CAV";

export async function POST(req: Request) {
  console.log("[freshdesk-webhook] received request");

  let body: FreshdeskWebhookPayload;
  try {
    body = await req.json();
  } catch {
    console.error("[freshdesk-webhook] failed to parse JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.log("[freshdesk-webhook] payload:", JSON.stringify(body));

  const t = body?.freshdesk_webhook;
  if (!t?.ticket_id) {
    console.error("[freshdesk-webhook] missing ticket_id in payload");
    return NextResponse.json({ error: "Missing ticket_id" }, { status: 400 });
  }

  // Look up the CAV project ID
  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(eq(jiraProjects.jiraProjectKey, CAV_PROJECT_KEY))
    .limit(1);

  if (!project) {
    console.error("[freshdesk-webhook] CAV project not found in DB");
    return NextResponse.json({ error: "CAV project not found" }, { status: 404 });
  }

  const ticketId = parseInt(String(t.ticket_id), 10);
  const status   = parseIntOrLabel(t.ticket_status, FD_STATUS_BY_LABEL);
  const priority = parseIntOrLabel(t.ticket_priority, FD_PRIORITY_BY_LABEL);

  if (isNaN(ticketId) || isNaN(status) || isNaN(priority)) {
    console.error("[freshdesk-webhook] invalid numeric fields — ticketId=%s status=%s priority=%s", t.ticket_id, t.ticket_status, t.ticket_priority);
    return NextResponse.json({ error: "Invalid numeric fields" }, { status: 400 });
  }

  const dueByDate = parseFdDate(t.ticket_due_by_time);

  const values = {
    projectId: project.id,
    fdTicketId: ticketId,
    subject: t.ticket_subject,
    fdStatus: status,
    fdStatusLabel: fdStatusLabel(status),
    fdPriority: priority,
    fdPriorityLabel: fdPriorityLabel(priority),
    ticketType: t.ticket_type || null,
    requesterName: t.requester_name || null,
    requesterEmail: t.requester_email || null,
    dueBy: dueByDate,
    fdCreatedAt: parseFdDate(t.ticket_created_at, new Date())!,
    fdUpdatedAt: parseFdDate(t.ticket_updated_at, new Date())!,
    syncedAt: new Date(),
  };

  try {
    // Upsert — inserts new tickets, updates existing ones
    await db
      .insert(freshdeskTickets)
      .values(values)
      .onConflictDoUpdate({
        target: [freshdeskTickets.projectId, freshdeskTickets.fdTicketId],
        set: {
          subject: values.subject,
          fdStatus: values.fdStatus,
          fdStatusLabel: values.fdStatusLabel,
          fdPriority: values.fdPriority,
          fdPriorityLabel: values.fdPriorityLabel,
          ticketType: values.ticketType,
          requesterName: values.requesterName,
          requesterEmail: values.requesterEmail,
          dueBy: values.dueBy,
          fdUpdatedAt: values.fdUpdatedAt,
          syncedAt: values.syncedAt,
        },
      });
  } catch (err) {
    console.error("[freshdesk-webhook] DB upsert failed for ticket %d:", ticketId, err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  console.log("[freshdesk-webhook] upserted ticket %d (project %s)", ticketId, project.id);
  revalidateTag("jira-issues", "max");
  return NextResponse.json({ ok: true });
}

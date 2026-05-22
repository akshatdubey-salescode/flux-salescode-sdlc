import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { freshdeskTickets, jiraProjects } from "@/lib/db/schema";
import { fdStatusLabel, fdPriorityLabel } from "@/lib/freshdesk/client";

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
  let body: FreshdeskWebhookPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const t = body?.freshdesk_webhook;
  if (!t?.ticket_id) {
    return NextResponse.json({ error: "Missing ticket_id" }, { status: 400 });
  }

  // Look up the CAV project ID
  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(eq(jiraProjects.jiraProjectKey, CAV_PROJECT_KEY))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: "CAV project not found" }, { status: 404 });
  }

  const ticketId = parseInt(String(t.ticket_id), 10);
  const status   = parseInt(String(t.ticket_status), 10);
  const priority = parseInt(String(t.ticket_priority), 10);

  if (isNaN(ticketId) || isNaN(status) || isNaN(priority)) {
    return NextResponse.json({ error: "Invalid numeric fields" }, { status: 400 });
  }

  const dueByRaw = t.ticket_due_by_time;
  const dueByDate = dueByRaw && dueByRaw !== "" ? new Date(dueByRaw) : null;

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
    fdCreatedAt: new Date(t.ticket_created_at),
    fdUpdatedAt: new Date(t.ticket_updated_at),
    syncedAt: new Date(),
  };

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

  return NextResponse.json({ ok: true });
}

import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { freshdeskTickets } from "@/lib/db/schema";
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

export interface FreshdeskWebhookPayload {
  freshdesk_webhook: {
    ticket_id: number | string;
    ticket_subject: string;
    // Plain-text body — only present if the automation rule sends the
    // {{ticket.description_text}} placeholder.
    ticket_description?: string;
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

type WebhookResult = { status: number; body: Record<string, unknown> };

// Upsert a Freshdesk ticket delivered by a Freshdesk automation-rule webhook into
// the given project. Shared by the legacy single-project route and the generic
// per-project route so both stay in lockstep.
export async function processFreshdeskWebhook(
  projectId: string,
  body: FreshdeskWebhookPayload
): Promise<WebhookResult> {
  const t = body?.freshdesk_webhook;
  if (!t?.ticket_id) {
    console.error("[freshdesk-webhook] missing ticket_id in payload");
    return { status: 400, body: { error: "Missing ticket_id" } };
  }

  const ticketId = parseInt(String(t.ticket_id), 10);
  const status   = parseIntOrLabel(t.ticket_status, FD_STATUS_BY_LABEL);
  const priority = parseIntOrLabel(t.ticket_priority, FD_PRIORITY_BY_LABEL);

  if (isNaN(ticketId) || isNaN(status) || isNaN(priority)) {
    console.error("[freshdesk-webhook] invalid numeric fields — ticketId=%s status=%s priority=%s", t.ticket_id, t.ticket_status, t.ticket_priority);
    return { status: 400, body: { error: "Invalid numeric fields" } };
  }

  // Distinguish "rule didn't send a description" (undefined) from "ticket has an
  // empty body" so we never clobber an existing description on update.
  const hasDescription = t.ticket_description !== undefined;

  const values = {
    projectId,
    fdTicketId: ticketId,
    subject: t.ticket_subject,
    description: hasDescription ? t.ticket_description || null : null,
    fdStatus: status,
    fdStatusLabel: fdStatusLabel(status),
    fdPriority: priority,
    fdPriorityLabel: fdPriorityLabel(priority),
    ticketType: t.ticket_type || null,
    requesterName: t.requester_name || null,
    requesterEmail: t.requester_email || null,
    dueBy: parseFdDate(t.ticket_due_by_time),
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
          // Only update the body when the webhook carried one; otherwise leave
          // whatever the REST sync stored intact.
          ...(hasDescription ? { description: values.description } : {}),
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
    return { status: 500, body: { error: "DB error" } };
  }

  console.log("[freshdesk-webhook] upserted ticket %d (project %s)", ticketId, projectId);
  // A Freshdesk ticket change only touches freshdesk_tickets (never jira_issues),
  // so scope invalidation to the project rather than every issue cache org-wide.
  revalidateTag(`project:${projectId}`, "max");
  return { status: 200, body: { ok: true } };
}

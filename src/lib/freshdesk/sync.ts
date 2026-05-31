import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { freshdeskTickets, jiraIssues, jiraProjects } from "@/lib/db/schema";
import {
  fetchCavinKareTickets,
  fetchTicket,
  fdStatusLabel,
  fdPriorityLabel,
  type FdTicket,
} from "./client";

export const FRESHDESK_CUSTOM_FIELD = "customfield_11699";

export async function syncFreshdeskTickets(projectId: string): Promise<{
  synced: number;
  linked: number;
  errors: number;
}> {
  // Verify project exists
  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId))
    .limit(1);

  if (!project) throw new Error(`Project ${projectId} not found`);

  // Fetch all Jira issues for this project that have a Freshdesk ticket ID set
  const jiraIssuesWithFdId = await db
    .select({
      id: jiraIssues.id,
      jiraKey: jiraIssues.jiraKey,
      status: jiraIssues.status,
      assigneeName: jiraIssues.assigneeName,
      customFields: jiraIssues.customFields,
    })
    .from(jiraIssues)
    .where(
      and(
        eq(jiraIssues.projectId, projectId),
        sql`${jiraIssues.customFields}->>'${sql.raw(FRESHDESK_CUSTOM_FIELD)}' IS NOT NULL`
      )
    );

  // Build a map: fdTicketId (number) → jira issue
  const fdIdToJira = new Map<
    number,
    { id: string; jiraKey: string; status: string; assigneeName: string | null }
  >();
  for (const issue of jiraIssuesWithFdId) {
    const raw = (issue.customFields as Record<string, unknown>)?.[
      FRESHDESK_CUSTOM_FIELD
    ];
    if (!raw) continue;
    const fdId = parseInt(String(raw), 10);
    if (!isNaN(fdId)) {
      fdIdToJira.set(fdId, {
        id: issue.id,
        jiraKey: issue.jiraKey,
        status: issue.status,
        assigneeName: issue.assigneeName,
      });
    }
  }

  // Fetch all CavinKare tickets from Freshdesk
  const fdTickets = await fetchCavinKareTickets();

  let synced = 0;
  let linked = 0;
  let errors = 0;

  for (const ticket of fdTickets) {
    try {
      const jiraMatch = fdIdToJira.get(ticket.id);

      await db
        .insert(freshdeskTickets)
        .values({
          projectId,
          fdTicketId: ticket.id,
          subject: ticket.subject,
          fdStatus: ticket.status,
          fdStatusLabel: fdStatusLabel(ticket.status),
          fdPriority: ticket.priority,
          fdPriorityLabel: fdPriorityLabel(ticket.priority),
          ticketType: ticket.type ?? null,
          requesterName: ticket.requester?.name ?? null,
          requesterEmail: ticket.requester?.email ?? null,
          fdCompanyId: ticket.company_id ? String(ticket.company_id) : null,
          fdCompanyName: ticket.company?.name ?? null,
          dueBy: ticket.due_by ? new Date(ticket.due_by) : null,
          frDueBy: ticket.fr_due_by ? new Date(ticket.fr_due_by) : null,
          isEscalated: ticket.is_escalated,
          frEscalated: ticket.fr_escalated,
          linkedJiraIssueId: jiraMatch?.id ?? null,
          linkedJiraKey: jiraMatch?.jiraKey ?? null,
          linkedJiraStatus: jiraMatch?.status ?? null,
          linkedJiraAssigneeName: jiraMatch?.assigneeName ?? null,
          fdCreatedAt: new Date(ticket.created_at),
          fdUpdatedAt: new Date(ticket.updated_at),
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [freshdeskTickets.projectId, freshdeskTickets.fdTicketId],
          set: {
            subject: sql`excluded.subject`,
            fdStatus: sql`excluded.fd_status`,
            fdStatusLabel: sql`excluded.fd_status_label`,
            fdPriority: sql`excluded.fd_priority`,
            fdPriorityLabel: sql`excluded.fd_priority_label`,
            ticketType: sql`excluded.ticket_type`,
            requesterName: sql`excluded.requester_name`,
            requesterEmail: sql`excluded.requester_email`,
            dueBy: sql`excluded.due_by`,
            frDueBy: sql`excluded.fr_due_by`,
            isEscalated: sql`excluded.is_escalated`,
            frEscalated: sql`excluded.fr_escalated`,
            linkedJiraIssueId: sql`excluded.linked_jira_issue_id`,
            linkedJiraKey: sql`excluded.linked_jira_key`,
            linkedJiraStatus: sql`excluded.linked_jira_status`,
            linkedJiraAssigneeName: sql`excluded.linked_jira_assignee_name`,
            fdUpdatedAt: sql`excluded.fd_updated_at`,
            syncedAt: sql`excluded.synced_at`,
          },
        });

      synced++;
      if (jiraMatch) linked++;
    } catch {
      errors++;
    }
  }

  return { synced, linked, errors };
}

// Called from the Jira webhook handler when a CAV issue's customfield_11699
// changes — re-links the corresponding Freshdesk ticket immediately.
export async function relinkFreshdeskTicket(
  jiraIssueId: string,
  jiraKey: string,
  jiraStatus: string,
  assigneeName: string | null,
  fdTicketId: number | null,
  projectId: string
) {
  if (fdTicketId === null) {
    // Field was cleared — unlink any ticket that was pointing to this issue
    await db
      .update(freshdeskTickets)
      .set({
        linkedJiraIssueId: null,
        linkedJiraKey: null,
        linkedJiraStatus: null,
        linkedJiraAssigneeName: null,
        syncedAt: new Date(),
      })
      .where(
        and(
          eq(freshdeskTickets.linkedJiraIssueId, jiraIssueId),
          eq(freshdeskTickets.projectId, projectId)
        )
      );
    return;
  }

  const updated = await db
    .update(freshdeskTickets)
    .set({
      linkedJiraIssueId: jiraIssueId,
      linkedJiraKey: jiraKey,
      linkedJiraStatus: jiraStatus,
      linkedJiraAssigneeName: assigneeName,
      syncedAt: new Date(),
    })
    .where(
      and(
        eq(freshdeskTickets.fdTicketId, fdTicketId),
        eq(freshdeskTickets.projectId, projectId)
      )
    )
    .returning({ id: freshdeskTickets.id });

  if (updated.length > 0) return;

  // Ticket not yet in freshdeskTickets — fetch it from Freshdesk and insert so
  // the link is not silently lost. This happens when a Jira issue is linked to
  // an FD ticket that was created after the last Freshdesk sync.
  try {
    const ticket = await fetchTicket(fdTicketId);
    await db
      .insert(freshdeskTickets)
      .values({
        projectId,
        fdTicketId: ticket.id,
        subject: ticket.subject,
        fdStatus: ticket.status,
        fdStatusLabel: fdStatusLabel(ticket.status),
        fdPriority: ticket.priority,
        fdPriorityLabel: fdPriorityLabel(ticket.priority),
        ticketType: ticket.type ?? null,
        requesterName: ticket.requester?.name ?? null,
        requesterEmail: ticket.requester?.email ?? null,
        fdCompanyId: ticket.company_id ? String(ticket.company_id) : null,
        fdCompanyName: ticket.company?.name ?? null,
        dueBy: ticket.due_by ? new Date(ticket.due_by) : null,
        frDueBy: ticket.fr_due_by ? new Date(ticket.fr_due_by) : null,
        isEscalated: ticket.is_escalated,
        frEscalated: ticket.fr_escalated,
        linkedJiraIssueId: jiraIssueId,
        linkedJiraKey: jiraKey,
        linkedJiraStatus: jiraStatus,
        linkedJiraAssigneeName: assigneeName,
        fdCreatedAt: new Date(ticket.created_at),
        fdUpdatedAt: new Date(ticket.updated_at),
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [freshdeskTickets.projectId, freshdeskTickets.fdTicketId],
        set: {
          subject: ticket.subject,
          fdStatus: ticket.status,
          fdStatusLabel: fdStatusLabel(ticket.status),
          fdPriority: ticket.priority,
          fdPriorityLabel: fdPriorityLabel(ticket.priority),
          ticketType: ticket.type ?? null,
          requesterName: ticket.requester?.name ?? null,
          requesterEmail: ticket.requester?.email ?? null,
          fdCompanyId: ticket.company_id ? String(ticket.company_id) : null,
          fdCompanyName: ticket.company?.name ?? null,
          dueBy: ticket.due_by ? new Date(ticket.due_by) : null,
          frDueBy: ticket.fr_due_by ? new Date(ticket.fr_due_by) : null,
          isEscalated: ticket.is_escalated,
          frEscalated: ticket.fr_escalated,
          linkedJiraIssueId: jiraIssueId,
          linkedJiraKey: jiraKey,
          linkedJiraStatus: jiraStatus,
          linkedJiraAssigneeName: assigneeName,
          fdUpdatedAt: new Date(ticket.updated_at),
          syncedAt: new Date(),
        },
      });
  } catch (err) {
    // 404 → ticket genuinely doesn't exist in Freshdesk; nothing to link, don't retry.
    // Any other error is transient — re-throw so the webhook returns 500 and Jira retries.
    if (err instanceof Error && err.message.includes(" 404 ")) {
      console.error(`[freshdesk-sync] ticket ${fdTicketId} not found in Freshdesk, skipping link`);
      return;
    }
    throw err;
  }
}

// Called from the Jira webhook when a linked issue's status changes
export async function updateLinkedJiraStatus(
  jiraIssueId: string,
  newStatus: string
) {
  await db
    .update(freshdeskTickets)
    .set({ linkedJiraStatus: newStatus, syncedAt: new Date() })
    .where(eq(freshdeskTickets.linkedJiraIssueId, jiraIssueId));
}

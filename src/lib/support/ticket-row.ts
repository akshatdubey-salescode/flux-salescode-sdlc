// Pure mapping from a joined (jira_issues + support_tickets + live ownership
// events) row to the shape the Support tab and the report builder consume.
// No DB imports, so the rules below are unit-tested in ticket-row.test.ts.
//
// User decisions, 2026-11-20:
// - `createdAt` is the *effective raised time*: the Flux `raised_at` when set,
//   else the Jira creation time. Every report bucket and SLA clock follows it.
// - `rcaGiven` comes from the Flux `rca_shared` toggle only; the Jira RCA
//   field is no longer read.

import { bugBoardPriorityBucket, isDoneOrCancelled } from "@/lib/bug-summary";
import { extractDueDate } from "@/lib/jira/dates";
import { BUG_ISSUE_TYPES } from "@/lib/scorecard/config";
import type { OwnerSide, ReportTicketInput, SupportCategory } from "./types";

/** The ticket's effective raised time: Flux raised time, else Jira creation. */
export function effectiveRaisedAt(raisedAt: Date | null, jiraCreatedAt: Date | null): Date | null {
  return raisedAt ?? jiraCreatedAt;
}

export type SupportTicketRow = ReportTicketInput & {
  /** Flux raised time (null = falls back to Jira creation). */
  raisedAt: Date | null;
  jiraCreatedAt: Date;
  status: string;
  issueType: string;
  ownerSide: OwnerSide;
  storedCategory: SupportCategory | null;
  fluxEta: string | null;
  jiraDueDate: string | null;
};

export type RawSupportTicket = {
  issueId: string;
  jiraKey: string;
  summary: string;
  status: string;
  statusCategory: string | null;
  canonicalStatus: string | null;
  issueType: string;
  priority: string | null;
  customFields: Record<string, unknown> | null;
  jiraCreatedAt: Date;
  jiraUpdatedAt: Date | null;
  completedAt: Date | null;
  endDateFieldIds: string[] | null;
  storedCategory: SupportCategory | null;
  ownerSide: OwnerSide | null; // null = no support_tickets row yet
  raisedAt: Date | null;
  rcaShared: boolean | null; // null = no support_tickets row yet
  firstRespondedAt: Date | null;
  usersReported: number | null;
  usersImpacted: number | null;
  fluxEta: string | null;
  // Live (non-deleted) events only. `at` may arrive as an ISO string from json_agg.
  events: { side: OwnerSide; at: Date | string }[] | null;
};

export function toSupportTicketRow(r: RawSupportTicket): SupportTicketRow {
  const cf = r.customFields ?? {};
  const category: SupportCategory | null =
    r.storedCategory ??
    (BUG_ISSUE_TYPES.has(r.issueType.trim().toLowerCase()) ? "bug" : null);
  const resolvedAt = isDoneOrCancelled(r.canonicalStatus, r.statusCategory)
    ? (r.completedAt ?? r.jiraUpdatedAt)
    : null;
  const jiraDueDate = extractDueDate(cf, r.endDateFieldIds);
  const events = (r.events ?? [])
    .map((e) => ({ side: e.side, at: e.at instanceof Date ? e.at : new Date(e.at) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    issueId: r.issueId,
    jiraKey: r.jiraKey,
    summary: r.summary,
    priority: bugBoardPriorityBucket(r.priority),
    category,
    createdAt: r.raisedAt ?? r.jiraCreatedAt,
    resolvedAt,
    firstRespondedAt: r.firstRespondedAt,
    rcaGiven: r.rcaShared === true,
    usersReported: r.usersReported,
    usersImpacted: r.usersImpacted,
    eta: r.fluxEta ?? jiraDueDate,
    events,
    raisedAt: r.raisedAt,
    jiraCreatedAt: r.jiraCreatedAt,
    status: r.status,
    issueType: r.issueType,
    ownerSide: r.ownerSide ?? "salescode",
    storedCategory: r.storedCategory,
    fluxEta: r.fluxEta,
    jiraDueDate,
  };
}

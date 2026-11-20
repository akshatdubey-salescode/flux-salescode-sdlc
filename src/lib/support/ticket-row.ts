// Pure mapping from a joined (jira_issues + support_tickets + live ownership
// events) row to the shape the Support tab and the report builder consume.
// No DB imports, so the rules below are unit-tested in ticket-row.test.ts.

import { bugBoardPriorityBucket, isDoneOrCancelled } from "@/lib/bug-summary";
import { extractDueDate } from "@/lib/jira/dates";
import { extractRcaText } from "@/lib/jira/rca";
import { BUG_ISSUE_TYPES } from "@/lib/scorecard/config";
import type { OwnerSide, ReportTicketInput, SupportCategory } from "./types";

export type SupportTicketRow = ReportTicketInput & {
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
  rcaFieldIds: string[] | null;
  endDateFieldIds: string[] | null;
  storedCategory: SupportCategory | null;
  ownerSide: OwnerSide | null; // null = no support_tickets row yet
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
    createdAt: r.jiraCreatedAt,
    resolvedAt,
    firstRespondedAt: r.firstRespondedAt,
    rcaGiven: extractRcaText(cf, r.rcaFieldIds) !== null,
    usersReported: r.usersReported,
    usersImpacted: r.usersImpacted,
    eta: r.fluxEta ?? jiraDueDate,
    events,
    status: r.status,
    issueType: r.issueType,
    ownerSide: r.ownerSide ?? "salescode",
    storedCategory: r.storedCategory,
    fluxEta: r.fluxEta,
    jiraDueDate,
  };
}

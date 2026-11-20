// Drizzle/Postgres data layer for support tickets and the daily client support
// report. Framework-free: no HTTP / Next.js concerns live here; routes map the
// exported error classes to status codes.

import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  jiraIssues,
  jiraProjects,
  projectStatusMappings,
  supportReportSettings,
  supportReports,
  supportTicketOwnershipEvents,
  supportTickets,
  type SupportReport,
} from "@/lib/db/schema";
import {
  DEFAULT_OFFICE_HOURS,
  DEFAULT_SLA,
  type OfficeHours,
  type OwnerSide,
  type PeriodMode,
  type SlaTargets,
  type SupportCategory,
  type SupportReportData,
} from "./types";
import { toSupportTicketRow, type RawSupportTicket, type SupportTicketRow } from "./ticket-row";

export type { SupportTicketRow } from "./ticket-row";

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

type Actor = { id: string; name: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type SettingsInput = {
  enabled: boolean;
  supportLabel: string;
  periodMode: PeriodMode;
  periodStart: string | null;
  toEmails: string[];
  ccEmails: string[];
  approverUserIds: string[];
  sharedBy: string;
  sla: SlaTargets;
  officeHours: OfficeHours;
};

const PERIOD_MODES: readonly PeriodMode[] = ["mtd", "ytd", "custom"];

function defaultSettings(): SettingsInput {
  return {
    enabled: false,
    supportLabel: "support",
    periodMode: "mtd",
    periodStart: null,
    toEmails: [],
    ccEmails: [],
    approverUserIds: [],
    sharedBy: "L2 Support",
    sla: structuredClone(DEFAULT_SLA),
    officeHours: structuredClone(DEFAULT_OFFICE_HOURS),
  };
}

export async function getSettings(projectId: string): Promise<SettingsInput> {
  const [row] = await db
    .select()
    .from(supportReportSettings)
    .where(eq(supportReportSettings.projectId, projectId))
    .limit(1);
  if (!row) return defaultSettings();
  return {
    enabled: row.enabled,
    supportLabel: row.supportLabel,
    periodMode: PERIOD_MODES.includes(row.periodMode as PeriodMode)
      ? (row.periodMode as PeriodMode)
      : "mtd",
    periodStart: row.periodStart,
    toEmails: row.toEmails,
    ccEmails: row.ccEmails,
    approverUserIds: row.approverUserIds,
    sharedBy: row.sharedBy,
    sla: row.sla,
    officeHours: { start: row.workStart, end: row.workEnd, days: row.workDays },
  };
}

export async function saveSettings(
  projectId: string,
  input: SettingsInput,
  userId: string,
): Promise<void> {
  const values = {
    enabled: input.enabled,
    supportLabel: input.supportLabel,
    periodMode: input.periodMode,
    periodStart: input.periodStart,
    toEmails: input.toEmails,
    ccEmails: input.ccEmails,
    approverUserIds: input.approverUserIds,
    sharedBy: input.sharedBy,
    sla: input.sla,
    workStart: input.officeHours.start,
    workEnd: input.officeHours.end,
    workDays: input.officeHours.days,
    updatedBy: userId,
    updatedAt: new Date(),
  };
  await db
    .insert(supportReportSettings)
    .values({ projectId, ...values })
    .onConflictDoUpdate({ target: supportReportSettings.projectId, set: values });
}

export async function listEnabledProjectIds(): Promise<string[]> {
  const rows = await db
    .select({ projectId: supportReportSettings.projectId })
    .from(supportReportSettings)
    .where(eq(supportReportSettings.enabled, true));
  return rows.map((r) => r.projectId);
}

// ---------------------------------------------------------------------------
// Support tickets
// ---------------------------------------------------------------------------

export async function listSupportTickets(projectId: string): Promise<SupportTicketRow[]> {
  const { supportLabel } = await getSettings(projectId);
  const ev = alias(supportTicketOwnershipEvents, "ev");

  const rows = await db
    .select({
      issueId: jiraIssues.id,
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      status: jiraIssues.status,
      statusCategory: jiraIssues.statusCategory,
      canonicalStatus: projectStatusMappings.canonicalStatus,
      issueType: jiraIssues.issueType,
      priority: jiraIssues.priority,
      customFields: jiraIssues.customFields,
      jiraCreatedAt: jiraIssues.jiraCreatedAt,
      jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
      completedAt: jiraIssues.completedAt,
      rcaFieldIds: jiraProjects.rcaFieldIds,
      endDateFieldIds: jiraProjects.endDateFieldIds,
      storedCategory: supportTickets.category,
      ownerSide: supportTickets.ownerSide,
      firstRespondedAt: supportTickets.firstRespondedAt,
      usersReported: supportTickets.usersReported,
      usersImpacted: supportTickets.usersImpacted,
      fluxEta: supportTickets.eta,
      events: sql<RawSupportTicket["events"]>`(
        select coalesce(json_agg(json_build_object('side', ${ev.side}, 'at', ${ev.at}) order by ${ev.at}), '[]'::json)
        from ${ev}
        where ${ev.issueId} = ${jiraIssues.id} and ${ev.deletedAt} is null
      )`,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .leftJoin(
      projectStatusMappings,
      and(
        eq(projectStatusMappings.projectId, jiraIssues.projectId),
        eq(projectStatusMappings.rawStatus, jiraIssues.status),
      ),
    )
    .leftJoin(supportTickets, eq(supportTickets.issueId, jiraIssues.id))
    .where(
      and(
        eq(jiraIssues.projectId, projectId),
        // Every synced issue has a created timestamp; the time math needs one.
        sql`${jiraIssues.jiraCreatedAt} is not null`,
        sql`exists (select 1 from unnest(${jiraIssues.labels}) l where lower(l) = lower(${supportLabel}))`,
      ),
    )
    .orderBy(desc(jiraIssues.jiraCreatedAt));

  return rows.map((r) => toSupportTicketRow({ ...r, jiraCreatedAt: r.jiraCreatedAt! }));
}

/** The issue's created timestamp, or NotFoundError when it isn't in the project. */
async function issueInProject(
  q: Tx | typeof db,
  projectId: string,
  issueId: string,
): Promise<{ jiraCreatedAt: Date | null }> {
  const [row] = await q
    .select({ jiraCreatedAt: jiraIssues.jiraCreatedAt })
    .from(jiraIssues)
    .where(and(eq(jiraIssues.id, issueId), eq(jiraIssues.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError("Issue not found in this project");
  return row;
}

/** True when the issue exists and belongs to the project. */
export async function issueBelongsToProject(projectId: string, issueId: string): Promise<boolean> {
  try {
    await issueInProject(db, projectId, issueId);
    return true;
  } catch (e) {
    if (e instanceof NotFoundError) return false;
    throw e;
  }
}

export async function updateSupportTicket(
  projectId: string,
  issueId: string,
  patch: Partial<{
    category: SupportCategory | null;
    firstRespondedAt: Date | null;
    usersReported: number | null;
    usersImpacted: number | null;
    eta: string | null;
  }>,
  by: Actor,
): Promise<void> {
  await issueInProject(db, projectId, issueId);

  // Only keys actually present in the patch are written.
  const set: Partial<typeof supportTickets.$inferInsert> = {};
  if ("category" in patch) set.category = patch.category ?? null;
  if ("firstRespondedAt" in patch) set.firstRespondedAt = patch.firstRespondedAt ?? null;
  if ("usersReported" in patch) set.usersReported = patch.usersReported ?? null;
  if ("usersImpacted" in patch) set.usersImpacted = patch.usersImpacted ?? null;
  if ("eta" in patch) set.eta = patch.eta ?? null;
  const audit = { updatedBy: by.id, updatedByName: by.name, updatedAt: new Date() };

  await db
    .insert(supportTickets)
    .values({ issueId, projectId, ...set, ...audit })
    .onConflictDoUpdate({ target: supportTickets.issueId, set: { ...set, ...audit } });
}

// ---------------------------------------------------------------------------
// Ownership events
// ---------------------------------------------------------------------------

export async function listOwnershipEvents(issueId: string): Promise<
  Array<{
    id: string;
    side: OwnerSide;
    at: Date;
    createdAt: Date;
    byName: string | null;
    deletedAt: Date | null;
    deletedByName: string | null;
  }>
> {
  return db
    .select({
      id: supportTicketOwnershipEvents.id,
      side: supportTicketOwnershipEvents.side,
      at: supportTicketOwnershipEvents.at,
      createdAt: supportTicketOwnershipEvents.createdAt,
      byName: supportTicketOwnershipEvents.byName,
      deletedAt: supportTicketOwnershipEvents.deletedAt,
      deletedByName: supportTicketOwnershipEvents.deletedByName,
    })
    .from(supportTicketOwnershipEvents)
    .where(eq(supportTicketOwnershipEvents.issueId, issueId))
    .orderBy(desc(supportTicketOwnershipEvents.at), desc(supportTicketOwnershipEvents.createdAt));
}

/**
 * Upsert the support_tickets row and take its row lock. Concurrent ownership
 * writes for the same issue serialise here, so the recompute that follows
 * (a fresh read-committed snapshot) always sees the other writer's event.
 */
async function lockTicketRow(tx: Tx, projectId: string, issueId: string, by: Actor) {
  const audit = { updatedBy: by.id, updatedByName: by.name, updatedAt: new Date() };
  await tx
    .insert(supportTickets)
    .values({ issueId, projectId, ...audit })
    .onConflictDoUpdate({ target: supportTickets.issueId, set: audit });
}

/** owner_side := side of the latest live event (by `at`), else salescode. */
async function recomputeOwnerSide(tx: Tx, issueId: string) {
  const [latest] = await tx
    .select({ side: supportTicketOwnershipEvents.side })
    .from(supportTicketOwnershipEvents)
    .where(
      and(
        eq(supportTicketOwnershipEvents.issueId, issueId),
        isNull(supportTicketOwnershipEvents.deletedAt),
      ),
    )
    .orderBy(desc(supportTicketOwnershipEvents.at), desc(supportTicketOwnershipEvents.createdAt))
    .limit(1);
  await tx
    .update(supportTickets)
    .set({ ownerSide: latest?.side ?? "salescode" })
    .where(eq(supportTickets.issueId, issueId));
}

export async function addOwnershipEvent(
  projectId: string,
  issueId: string,
  side: OwnerSide,
  at: Date,
  by: Actor,
): Promise<void> {
  if (Number.isNaN(at.getTime())) throw new ValidationError("Invalid time");
  await db.transaction(async (tx) => {
    const issue = await issueInProject(tx, projectId, issueId);
    if (issue.jiraCreatedAt && at.getTime() < issue.jiraCreatedAt.getTime()) {
      throw new ValidationError("Time is before the ticket was created");
    }
    if (at.getTime() > Date.now() + 60_000) {
      throw new ValidationError("Time is in the future");
    }
    await lockTicketRow(tx, projectId, issueId, by);
    await tx
      .insert(supportTicketOwnershipEvents)
      .values({ issueId, side, at, byUser: by.id, byName: by.name });
    await recomputeOwnerSide(tx, issueId);
  });
}

export async function deleteOwnershipEvent(
  projectId: string,
  issueId: string,
  eventId: string,
  by: Actor,
): Promise<void> {
  await db.transaction(async (tx) => {
    await issueInProject(tx, projectId, issueId);
    await lockTicketRow(tx, projectId, issueId, by);
    const deleted = await tx
      .update(supportTicketOwnershipEvents)
      .set({ deletedAt: new Date(), deletedBy: by.id, deletedByName: by.name })
      .where(
        and(
          eq(supportTicketOwnershipEvents.id, eventId),
          eq(supportTicketOwnershipEvents.issueId, issueId),
          isNull(supportTicketOwnershipEvents.deletedAt),
        ),
      )
      .returning({ id: supportTicketOwnershipEvents.id });
    if (deleted.length === 0) throw new NotFoundError("Ownership event not found");
    await recomputeOwnerSide(tx, issueId);
  });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function getReport(id: string): Promise<SupportReport | null> {
  const [row] = await db.select().from(supportReports).where(eq(supportReports.id, id)).limit(1);
  return row ?? null;
}

export async function listReports(projectId: string, limit = 60): Promise<SupportReport[]> {
  return db
    .select()
    .from(supportReports)
    .where(eq(supportReports.projectId, projectId))
    .orderBy(desc(supportReports.reportDate))
    .limit(limit);
}

/**
 * Race-safe single statement: INSERT … ON CONFLICT (project_id, report_date)
 * DO UPDATE … WHERE status = 'awaiting_approval' RETURNING id, (xmax = 0).
 * xmax = 0 means the row was freshly inserted. No row returned means the
 * existing row is sending/sent/failed/lapsed and was left untouched.
 */
export async function upsertAwaitingReport(
  projectId: string,
  reportDate: string,
  data: SupportReportData,
  builtBy: Actor | null,
): Promise<{ id: string; created: boolean } | { blocked: "already_final" }> {
  const build = {
    data,
    builtAt: new Date(),
    builtBy: builtBy?.id ?? null,
    builtByName: builtBy?.name ?? null,
  };
  const [row] = await db
    .insert(supportReports)
    .values({ projectId, reportDate, status: "awaiting_approval", ...build })
    .onConflictDoUpdate({
      target: [supportReports.projectId, supportReports.reportDate],
      set: build,
      setWhere: sql`${supportReports.status} = 'awaiting_approval'`,
    })
    .returning({ id: supportReports.id, created: sql<boolean>`(xmax = 0)` });
  if (!row) return { blocked: "already_final" };
  return { id: row.id, created: row.created };
}

/** Lapse every awaiting or failed report for the project dated before `reportDate`. */
export async function lapseOlderAwaiting(projectId: string, reportDate: string): Promise<number> {
  const rows = await db
    .update(supportReports)
    .set({ status: "lapsed" })
    .where(
      and(
        eq(supportReports.projectId, projectId),
        lt(supportReports.reportDate, reportDate),
        inArray(supportReports.status, ["awaiting_approval", "failed"]),
      ),
    )
    .returning({ id: supportReports.id });
  return rows.length;
}

/**
 * Single conditional UPDATE … RETURNING: exactly one concurrent caller wins, and
 * only if the row is still the build the approver reviewed (built_at matches).
 * Returns the claimed data (what must be sent), or null when not claimed.
 */
export async function claimForSending(
  id: string,
  expectedBuiltAt: Date,
): Promise<SupportReportData | null> {
  const rows = await db
    .update(supportReports)
    .set({ status: "sending" })
    .where(
      and(
        eq(supportReports.id, id),
        inArray(supportReports.status, ["awaiting_approval", "failed"]),
        eq(supportReports.builtAt, expectedBuiltAt),
      ),
    )
    .returning({ data: supportReports.data });
  return rows[0]?.data ?? null;
}

export async function markSent(
  id: string,
  r: { approvedBy: string; approvedByName: string; to: string[]; cc: string[]; messageId: string | null },
): Promise<void> {
  const now = new Date();
  await db
    .update(supportReports)
    .set({
      status: "sent",
      approvedBy: r.approvedBy,
      approvedByName: r.approvedByName,
      approvedAt: now,
      sentAt: now,
      recipientsTo: r.to,
      recipientsCc: r.cc,
      providerMessageId: r.messageId,
      error: null,
    })
    .where(and(eq(supportReports.id, id), eq(supportReports.status, "sending")));
}

export async function markFailed(
  id: string,
  r: { approvedBy: string; approvedByName: string; error: string },
): Promise<void> {
  await db
    .update(supportReports)
    .set({
      status: "failed",
      approvedBy: r.approvedBy,
      approvedByName: r.approvedByName,
      approvedAt: new Date(),
      error: r.error,
    })
    .where(and(eq(supportReports.id, id), eq(supportReports.status, "sending")));
}

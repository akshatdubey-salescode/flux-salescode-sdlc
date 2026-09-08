import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { scheduledProcesses, scheduledProcessRuns, type ScheduledProcess } from "@/lib/db/schema";
import { istToday, nextRunAfter } from "./recurrence";
import type { CadenceSpec, RunRow, ScheduleFrequency, ScheduleRow, StopReason } from "./types";

/**
 * Every read and write of the schedule table. Routes and the nightly
 * dispatcher go through here so the invariants that make midnight safe —
 * "next_run_on always moves forward", "a run row is claimed before any work" —
 * live in one file instead of at each call site.
 */

export function cadenceOf(row: {
  frequency: ScheduleFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
}): CadenceSpec {
  return { frequency: row.frequency, dayOfWeek: row.dayOfWeek, dayOfMonth: row.dayOfMonth };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type RawScheduleRow = {
  id: string;
  process: string;
  target_id: string;
  target_name: string | null;
  recipients: string[];
  subject: string;
  message: string;
  frequency: ScheduleFrequency;
  day_of_week: number | null;
  day_of_month: number | null;
  next_run_on: string;
  ends_on: string | null;
  last_run_on: string | null;
  paused_at: Date | null;
  stopped_at: Date | null;
  stop_reason: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: Date;
  last_status: string | null;
  last_trigger: string | null;
  last_run_day: string | null;
  last_recipient_count: number | null;
  last_detail: string | null;
  last_started_at: Date | null;
};

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toScheduleRow(r: RawScheduleRow): ScheduleRow {
  return {
    id: r.id,
    process: r.process,
    targetId: r.target_id,
    targetName: r.target_name,
    recipients: r.recipients ?? [],
    subject: r.subject,
    message: r.message,
    frequency: r.frequency,
    dayOfWeek: r.day_of_week,
    dayOfMonth: r.day_of_month,
    nextRunOn: r.next_run_on,
    endsOn: r.ends_on,
    lastRunOn: r.last_run_on,
    pausedAt: iso(r.paused_at),
    stoppedAt: iso(r.stopped_at),
    stopReason: r.stop_reason,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: iso(r.created_at)!,
    lastRun: r.last_started_at
      ? {
          runOn: r.last_run_day!,
          status: r.last_status!,
          trigger: r.last_trigger!,
          recipientCount: r.last_recipient_count ?? 0,
          detail: r.last_detail,
          startedAt: iso(r.last_started_at)!,
        }
      : null,
  };
}

/**
 * The schedule columns plus its most recent attempt.
 *
 * Target names come from a LEFT JOIN per targetable table, coalesced: ids are
 * UUIDs from different tables, so at most one join can match and the pattern
 * extends to the next process by adding a join and a COALESCE arm. A target
 * whose row is gone simply has no name here — which is exactly what a list
 * showing "(deleted sprint)" needs.
 */
const SCHEDULE_SELECT = sql`
  SELECT
    sp.id, sp.process, sp.target_id, COALESCE(s.name, w.name) AS target_name,
    sp.recipients, sp.subject, sp.message, sp.frequency,
    sp.day_of_week, sp.day_of_month, sp.next_run_on, sp.ends_on, sp.last_run_on,
    sp.paused_at, sp.stopped_at, sp.stop_reason,
    sp.created_by, sp.created_by_name, sp.created_at,
    r.status AS last_status, r."trigger" AS last_trigger, r.run_on AS last_run_day,
    r.recipient_count AS last_recipient_count, r.detail AS last_detail,
    r.started_at AS last_started_at
  FROM scheduled_processes sp
  LEFT JOIN sprints s ON s.id = sp.target_id
  LEFT JOIN sprint_workstreams w ON w.id = sp.target_id
  LEFT JOIN LATERAL (
    SELECT run_on, status, "trigger", recipient_count, detail, started_at
    FROM scheduled_process_runs
    WHERE schedule_id = sp.id
    ORDER BY started_at DESC
    LIMIT 1
  ) r ON TRUE
`;

/** Every live schedule attached to one target — what a sprint's or workstream's dialog lists. */
export async function listSchedulesForTarget(
  process: string,
  targetId: string
): Promise<ScheduleRow[]> {
  const rows = (
    await db.execute(sql`
      ${SCHEDULE_SELECT}
      WHERE sp.deleted_at IS NULL AND sp.process = ${process} AND sp.target_id = ${targetId}
      ORDER BY sp.created_at DESC
    `)
  ).rows as unknown as RawScheduleRow[];
  return rows.map(toScheduleRow);
}

/**
 * Every schedule in the system, live ones first and soonest-due at the top —
 * the superuser view. Stopped schedules stay listed (that's the audit trail),
 * they just sink to the bottom.
 */
export async function listAllSchedules(limit = 500): Promise<ScheduleRow[]> {
  const rows = (
    await db.execute(sql`
      ${SCHEDULE_SELECT}
      WHERE sp.deleted_at IS NULL
      ORDER BY
        (sp.stopped_at IS NOT NULL) ASC,
        (sp.paused_at IS NOT NULL) ASC,
        sp.next_run_on ASC,
        sp.created_at DESC
      LIMIT ${limit}
    `)
  ).rows as unknown as RawScheduleRow[];
  return rows.map(toScheduleRow);
}

export async function getSchedule(id: string): Promise<ScheduledProcess | null> {
  const [row] = await db
    .select()
    .from(scheduledProcesses)
    .where(and(eq(scheduledProcesses.id, id), isNull(scheduledProcesses.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** One schedule with its last run, for returning the fresh row after a write. */
export async function getScheduleRow(id: string): Promise<ScheduleRow | null> {
  const rows = (
    await db.execute(sql`
      ${SCHEDULE_SELECT}
      WHERE sp.deleted_at IS NULL AND sp.id = ${id}
      LIMIT 1
    `)
  ).rows as unknown as RawScheduleRow[];
  return rows[0] ? toScheduleRow(rows[0]) : null;
}

/**
 * Everything due tonight: next_run_on has arrived and nothing has taken the
 * schedule out of service. `<=` rather than `=` on purpose — a missed or
 * failed night is still due on the next pass, so a skipped trigger self-heals
 * instead of losing a day silently.
 */
export async function dueSchedules(today: string, limit: number): Promise<ScheduledProcess[]> {
  return db
    .select()
    .from(scheduledProcesses)
    .where(
      and(
        lte(scheduledProcesses.nextRunOn, today),
        isNull(scheduledProcesses.pausedAt),
        isNull(scheduledProcesses.stoppedAt),
        isNull(scheduledProcesses.deletedAt)
      )
    )
    .orderBy(scheduledProcesses.nextRunOn, scheduledProcesses.createdAt)
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type CreateScheduleInput = {
  process: string;
  targetId: string;
  recipients: string[];
  subject: string;
  message: string;
  cadence: CadenceSpec;
  endsOn: string | null;
  firstRunOn: string;
  createdBy: string;
  createdByName: string | null;
};

export async function createSchedule(input: CreateScheduleInput): Promise<string> {
  const [row] = await db
    .insert(scheduledProcesses)
    .values({
      process: input.process,
      targetId: input.targetId,
      recipients: input.recipients,
      subject: input.subject,
      message: input.message,
      frequency: input.cadence.frequency,
      dayOfWeek: input.cadence.dayOfWeek ?? null,
      dayOfMonth: input.cadence.dayOfMonth ?? null,
      nextRunOn: input.firstRunOn,
      endsOn: input.endsOn,
      createdBy: input.createdBy,
      createdByName: input.createdByName,
    })
    .returning({ id: scheduledProcesses.id });
  return row.id;
}

export type UpdateScheduleInput = {
  recipients?: string[];
  subject?: string;
  message?: string;
  cadence?: CadenceSpec;
  endsOn?: string | null;
  /** Recomputed when the cadence changes, so the stored day always matches it. */
  nextRunOn?: string;
};

export async function updateSchedule(id: string, patch: UpdateScheduleInput): Promise<void> {
  await db
    .update(scheduledProcesses)
    .set({
      ...(patch.recipients ? { recipients: patch.recipients } : {}),
      ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
      ...(patch.message !== undefined ? { message: patch.message } : {}),
      ...(patch.cadence
        ? {
            frequency: patch.cadence.frequency,
            dayOfWeek: patch.cadence.dayOfWeek ?? null,
            dayOfMonth: patch.cadence.dayOfMonth ?? null,
          }
        : {}),
      ...(patch.endsOn !== undefined ? { endsOn: patch.endsOn } : {}),
      ...(patch.nextRunOn ? { nextRunOn: patch.nextRunOn } : {}),
      updatedAt: new Date(),
    })
    .where(eq(scheduledProcesses.id, id));
}

export async function pauseSchedule(id: string, userId: string): Promise<void> {
  await db
    .update(scheduledProcesses)
    .set({ pausedAt: new Date(), pausedBy: userId, updatedAt: new Date() })
    .where(eq(scheduledProcesses.id, id));
}

/**
 * Resuming re-bases next_run_on on today when the stored day has gone by, so
 * coming back from a long pause sends at the next occurrence rather than
 * firing instantly for a night that's already past. A schedule whose end date
 * elapsed while paused stops instead of resuming into an impossible state.
 */
export async function resumeSchedule(row: ScheduledProcess): Promise<void> {
  const today = istToday();
  let nextRunOn = row.nextRunOn;
  if (nextRunOn <= today) {
    const next = nextRunAfter(cadenceOf(row), today, row.endsOn);
    if ("ended" in next) {
      await stopSchedule(row.id, "ended");
      return;
    }
    nextRunOn = next.nextRunOn;
  }
  await db
    .update(scheduledProcesses)
    .set({ pausedAt: null, pausedBy: null, nextRunOn, updatedAt: new Date() })
    .where(eq(scheduledProcesses.id, row.id));
}

/** Terminal, system-decided retirement — see STOP_REASON_VALUES. */
export async function stopSchedule(id: string, reason: StopReason): Promise<void> {
  await db
    .update(scheduledProcesses)
    .set({ stoppedAt: new Date(), stopReason: reason, updatedAt: new Date() })
    .where(eq(scheduledProcesses.id, id));
}

export async function softDeleteSchedule(
  id: string,
  user: { id: string; name: string | null }
): Promise<void> {
  await db
    .update(scheduledProcesses)
    .set({
      deletedAt: new Date(),
      deletedBy: user.id,
      deletedByName: user.name,
      updatedAt: new Date(),
    })
    .where(eq(scheduledProcesses.id, id));
}

/**
 * Moves the schedule to its next occurrence after the night just run, or
 * retires it when there's nothing left to run.
 *
 * Called after a FAILED run too. The alternative — leaving the row due so it
 * retries — would wedge it: the run row for that day already exists, so the
 * claim below would conflict every night from then on. A progress report is
 * worth more fresh tomorrow than retried from yesterday, and "Run now" is the
 * retry button.
 */
export async function advanceSchedule(
  row: ScheduledProcess,
  runOn: string,
  stop?: StopReason
): Promise<void> {
  if (stop) {
    await db
      .update(scheduledProcesses)
      .set({
        lastRunOn: runOn,
        stoppedAt: new Date(),
        stopReason: stop,
        updatedAt: new Date(),
      })
      .where(eq(scheduledProcesses.id, row.id));
    return;
  }

  const next = nextRunAfter(cadenceOf(row), runOn, row.endsOn);
  if ("ended" in next) {
    await db
      .update(scheduledProcesses)
      .set({
        lastRunOn: runOn,
        stoppedAt: new Date(),
        stopReason: "ended",
        updatedAt: new Date(),
      })
      .where(eq(scheduledProcesses.id, row.id));
    return;
  }

  await db
    .update(scheduledProcesses)
    .set({ lastRunOn: runOn, nextRunOn: next.nextRunOn, updatedAt: new Date() })
    .where(eq(scheduledProcesses.id, row.id));
}

// ---------------------------------------------------------------------------
// Run rows — the claim, and its outcome
// ---------------------------------------------------------------------------

/**
 * Claims tonight's run by inserting its row before any work happens.
 *
 * Returns null when another invocation already holds it: the partial unique
 * index on (schedule_id, run_on) WHERE trigger = 'cron' turns a double
 * trigger into a conflict instead of a duplicate email. Manual runs are
 * exempt from that index — pressing "Run now" twice is a person's decision.
 */
export async function claimRun(
  scheduleId: string,
  runOn: string,
  trigger: "cron" | "manual"
): Promise<string | null> {
  const [row] = await db
    .insert(scheduledProcessRuns)
    .values({ scheduleId, runOn, trigger, status: "running" })
    .onConflictDoNothing()
    .returning({ id: scheduledProcessRuns.id });
  return row?.id ?? null;
}

export async function finishRun(
  runId: string,
  patch: {
    status: "sent" | "failed" | "skipped";
    recipientCount?: number;
    subject?: string | null;
    detail?: string | null;
    messageIds?: string[];
    startedMs: number;
  }
): Promise<void> {
  await db
    .update(scheduledProcessRuns)
    .set({
      status: patch.status,
      recipientCount: patch.recipientCount ?? 0,
      subject: patch.subject ?? null,
      detail: patch.detail ?? null,
      providerMessageIds: patch.messageIds ?? [],
      durationMs: Date.now() - patch.startedMs,
      finishedAt: new Date(),
    })
    .where(eq(scheduledProcessRuns.id, runId));
}

/**
 * The attempt log for one schedule, newest first — "did Monday's go out?" for
 * every Monday, not just the most recent one.
 */
export async function listRuns(scheduleId: string, limit = 20): Promise<RunRow[]> {
  const rows = await db
    .select()
    .from(scheduledProcessRuns)
    .where(eq(scheduledProcessRuns.scheduleId, scheduleId))
    .orderBy(desc(scheduledProcessRuns.startedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    runOn: r.runOn,
    trigger: r.trigger,
    status: r.status,
    recipientCount: r.recipientCount,
    subject: r.subject,
    detail: r.detail,
    durationMs: r.durationMs,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    messageCount: r.providerMessageIds.length,
  }));
}

/** One run with its provider ids — what the delivery check needs. */
export async function getRun(runId: string, scheduleId: string) {
  const [row] = await db
    .select()
    .from(scheduledProcessRuns)
    .where(
      and(eq(scheduledProcessRuns.id, runId), eq(scheduledProcessRuns.scheduleId, scheduleId))
    )
    .limit(1);
  return row ?? null;
}

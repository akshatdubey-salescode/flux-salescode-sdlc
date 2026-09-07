import type { ScheduledProcess } from "@/lib/db/schema";
import { handlerFor, type ProcessContext, type ProcessOutcome } from "./registry";
import {
  advanceSchedule,
  claimRun,
  dueSchedules,
  finishRun,
  stopSchedule,
} from "./store";
import { istToday } from "./recurrence";
import type { StopReason } from "./types";

/**
 * The midnight run.
 *
 * Read every row that's due, look its process up in the registry, run it,
 * record what happened, move it to its next occurrence. One row is one
 * standing instruction, and 1 or 55 of them is the same loop.
 *
 * Sequential rather than parallel on purpose: these end in third-party API
 * calls (Resend rate-limits to a couple of requests a second), and a nightly
 * batch has all the time in the world. PACE_MS keeps the loop comfortably
 * under that limit.
 */

/** Gap between schedules, to stay well inside Resend's rate limit. */
const PACE_MS = 500;

/**
 * Rows per invocation, and the wall clock the loop stays inside. Overflow
 * isn't lost: leftover rows are still due, and because a claimed run is
 * idempotent per (schedule, day), simply calling the endpoint again finishes
 * the night.
 */
const MAX_PER_RUN = 200;
export const RUN_BUDGET_MS = 700_000;

export type RunStats = {
  /** The IST day the batch ran for. */
  day: string;
  due: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Rows another invocation had already claimed tonight. */
  alreadyClaimed: number;
  /** Due rows the budget didn't reach — call again to finish them. */
  remaining: number;
  errors: string[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type DispatchOutcome =
  | { status: "sent"; recipientCount: number; subject: string }
  | { status: "skipped"; detail: string }
  | { status: "failed"; detail: string }
  | { status: "already_claimed" };

/**
 * Runs one schedule for one day: claim, execute, record, advance.
 *
 * The claim comes first so a second caller (a retried trigger, an overlapping
 * invocation) is turned away before anything is mailed rather than after.
 */
export async function runSchedule(
  row: ScheduledProcess,
  ctx: ProcessContext
): Promise<DispatchOutcome> {
  const runId = await claimRun(row.id, ctx.runOn, ctx.trigger);
  if (!runId) return { status: "already_claimed" };

  const startedMs = Date.now();
  const handler = handlerFor(row.process);

  // An unknown process name means the handler was renamed or removed out from
  // under existing rows. Stop the schedule rather than failing it every night.
  if (!handler) {
    const detail = `No handler registered for process "${row.process}"`;
    await finishRun(runId, { status: "skipped", detail, startedMs });
    await stopSchedule(row.id, "process_removed");
    return { status: "skipped", detail };
  }

  /**
   * "Send now" is an extra send, not this period's send: it must not push the
   * cadence out (press it on a Monday weekly schedule and next Monday should
   * still be next Monday). A stop still applies — if the handler just sent the
   * final wrap-up, there is nothing left to schedule.
   */
  const settle = async (stop?: StopReason) => {
    if (ctx.trigger === "manual") {
      if (stop) await stopSchedule(row.id, stop);
      return;
    }
    await advanceSchedule(row, ctx.runOn, stop);
  };

  let outcome: ProcessOutcome;
  try {
    outcome = await handler(row, ctx);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await finishRun(runId, { status: "failed", detail, startedMs });
    // A failed cron night still advances: see advanceSchedule — a row left due
    // can never be re-claimed for the same day, so not advancing would wedge it.
    await settle();
    return { status: "failed", detail };
  }

  if (outcome.status === "skipped") {
    await finishRun(runId, { status: "skipped", detail: outcome.detail, startedMs });
    await settle(outcome.stop);
    return { status: "skipped", detail: outcome.detail };
  }

  await finishRun(runId, {
    status: "sent",
    recipientCount: outcome.recipientCount,
    subject: outcome.subject,
    messageIds: outcome.messageIds,
    startedMs,
  });
  await settle(outcome.stop);
  return { status: "sent", recipientCount: outcome.recipientCount, subject: outcome.subject };
}

export async function runDueSchedules({
  appUrl,
  today = istToday(),
  limit = MAX_PER_RUN,
  budgetMs = RUN_BUDGET_MS,
}: {
  appUrl: string;
  today?: string;
  limit?: number;
  budgetMs?: number;
}): Promise<RunStats> {
  const startedAt = Date.now();
  const due = await dueSchedules(today, limit);

  const stats: RunStats = {
    day: today,
    due: due.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    alreadyClaimed: 0,
    remaining: 0,
    errors: [],
  };

  for (const [index, row] of due.entries()) {
    if (Date.now() - startedAt > budgetMs) {
      stats.remaining = due.length - index;
      break;
    }
    if (index > 0) await sleep(PACE_MS);

    // One broken schedule must not take the rest of the night down with it;
    // runSchedule already catches handler failures, so this is the belt for
    // anything the store itself throws.
    try {
      const outcome = await runSchedule(row, { runOn: today, appUrl, trigger: "cron" });
      if (outcome.status === "sent") stats.sent++;
      else if (outcome.status === "skipped") stats.skipped++;
      else if (outcome.status === "failed") {
        stats.failed++;
        stats.errors.push(`${row.process} ${row.id}: ${outcome.detail}`);
      } else stats.alreadyClaimed++;
    } catch (err) {
      stats.failed++;
      const detail = err instanceof Error ? err.message : String(err);
      stats.errors.push(`${row.process} ${row.id}: ${detail}`);
      console.error("[scheduled-processes] run failed", row.id, err);
    }
  }

  return stats;
}

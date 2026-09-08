import type { ScheduledProcess } from "@/lib/db/schema";
import { SCHEDULED_PROCESS_VALUES, type ScheduledProcessName, type StopReason } from "./types";
import { runSprintProgressEmail } from "./handlers/sprint-progress-email";
import { runWorkstreamProgressEmail } from "./handlers/workstream-progress-email";

/**
 * The "process in code" half of the design: the table says what to run, this
 * says how. Adding a scheduled process anywhere else in the app — a bug
 * digest, a delivery reminder — is a handler here plus a name in
 * SCHEDULED_PROCESS_VALUES. No migration, no change to the nightly run.
 */

export type ProcessContext = {
  /** The IST calendar day this run is for. */
  runOn: string;
  /** Origin for deep links back into Flux, no trailing slash. */
  appUrl: string;
  trigger: "cron" | "manual";
};

/**
 * What a handler reports back. `stop` retires the schedule for good — a
 * handler uses it when its target can never produce another useful run (the
 * sprint closed, or it's gone).
 *
 * Throwing is the third option, and means "failed, try again next occurrence":
 * the dispatcher records the error on the run row and leaves the schedule live.
 */
export type ProcessOutcome =
  | {
      status: "sent";
      subject: string;
      recipientCount: number;
      /** Provider ids for what was sent, recorded so delivery can be checked later. */
      messageIds?: string[];
      stop?: StopReason;
    }
  | { status: "skipped"; detail: string; stop?: StopReason };

export type ProcessHandler = (
  row: ScheduledProcess,
  ctx: ProcessContext
) => Promise<ProcessOutcome>;

export const PROCESS_HANDLERS = {
  sprint_progress_email: runSprintProgressEmail,
  workstream_progress_email: runWorkstreamProgressEmail,
} satisfies Record<ScheduledProcessName, ProcessHandler>;

/**
 * The gate on the `process` text column — the registry, not the database, is
 * what makes a process name real, so every write path checks here.
 */
export function isKnownProcess(value: unknown): value is ScheduledProcessName {
  return typeof value === "string" && value in PROCESS_HANDLERS;
}

export function handlerFor(process: string): ProcessHandler | null {
  return isKnownProcess(process) ? PROCESS_HANDLERS[process] : null;
}

export { SCHEDULED_PROCESS_VALUES };

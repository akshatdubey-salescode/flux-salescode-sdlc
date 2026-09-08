/**
 * Shared vocabulary of the scheduled-process table. Kept free of any server
 * import (no db, no resend) so the compose dialog — a client component — can
 * describe and validate a cadence with the exact same code the API does.
 */

/** Values persisted by the schedule_frequency database enum. */
export const SCHEDULE_FREQUENCY_VALUES = ["daily", "weekly", "monthly"] as const;

export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCY_VALUES)[number];

const FREQUENCY_VALUE_SET = new Set<string>(SCHEDULE_FREQUENCY_VALUES);

export function isScheduleFrequency(value: unknown): value is ScheduleFrequency {
  return typeof value === "string" && FREQUENCY_VALUE_SET.has(value);
}

/**
 * Process names — the key into the handler registry (registry.ts).
 *
 * Deliberately a plain `text` column rather than a pg enum: the point of this
 * table is that other surfaces (bugs, deliveries, delay tracker) can schedule
 * their own work later, and that should cost a handler in code, not a
 * migration. The registry is the source of truth for which names are real —
 * every write path checks it.
 */
export const SCHEDULED_PROCESS_VALUES = [
  "sprint_progress_email",
  "workstream_progress_email",
] as const;

export type ScheduledProcessName = (typeof SCHEDULED_PROCESS_VALUES)[number];

/**
 * What each process runs against, for the copy that has to name it — a stop
 * reason, or the target column of the superuser table. A name that isn't in
 * the registry gets the neutral word rather than a wrong one.
 */
const PROCESS_TARGET_NOUNS = {
  sprint_progress_email: "sprint",
  workstream_progress_email: "workstream",
} satisfies Record<ScheduledProcessName, string>;

export function processTargetNoun(process: string | undefined): string {
  return process && Object.prototype.hasOwnProperty.call(PROCESS_TARGET_NOUNS, process)
    ? PROCESS_TARGET_NOUNS[process as ScheduledProcessName]
    : "target";
}

/** Why a schedule stopped for good — as opposed to paused, which is resumable. */
export const STOP_REASON_VALUES = [
  "target_closed",
  "target_deleted",
  "ended",
  "process_removed",
] as const;

export type StopReason = (typeof STOP_REASON_VALUES)[number];

const STOP_REASON_LABELS = {
  target_closed: (noun: string) => `the ${noun} finished — final update sent`,
  target_deleted: (noun: string) => `the ${noun} was deleted`,
  ended: () => "reached its end date",
  process_removed: () => "this kind of scheduled job no longer exists",
} satisfies Record<StopReason, (noun: string) => string>;

/** `process` names the thing that closed — a sprint, a workstream. */
export function stopReasonLabel(value: string | null, process?: string): string | null {
  if (!value) return null;
  return Object.prototype.hasOwnProperty.call(STOP_REASON_LABELS, value)
    ? STOP_REASON_LABELS[value as StopReason](processTargetNoun(process))
    : value;
}

/** Sunday-first, matching JS getUTCDay() — the day_of_week column stores 0–6. */
export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** 1st, 2nd, 3rd, 4th… for the monthly day-of-month copy. */
export function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export type CadenceSpec = {
  frequency: ScheduleFrequency;
  /** 0–6, Sunday-first. Required for weekly, ignored otherwise. */
  dayOfWeek?: number | null;
  /** 1–31, clamped to the month's real length when it runs. Required for monthly. */
  dayOfMonth?: number | null;
};

/**
 * "Every day at midnight", "Every Monday at midnight" — one phrasing used by
 * the compose dialog, the sprint badge and the superuser table, so a cadence
 * never reads differently in two places.
 */
export function describeCadence(spec: CadenceSpec): string {
  switch (spec.frequency) {
    case "daily":
      return "Every day at midnight";
    case "weekly": {
      const day = WEEKDAY_LABELS[spec.dayOfWeek ?? 1] ?? WEEKDAY_LABELS[1];
      return `Every ${day} at midnight`;
    }
    case "monthly": {
      const day = spec.dayOfMonth ?? 1;
      // 29/30/31 can't exist every month; say so rather than letting a
      // recipient wonder why February's update landed on the 28th.
      const clampNote = day > 28 ? " (or the last day, in shorter months)" : "";
      return `The ${ordinal(day)} of every month at midnight${clampNote}`;
    }
  }
}

/**
 * Rejects a cadence whose required field is missing or out of range; null when
 * the spec is usable. Shared so the dialog can disable Save for exactly the
 * reasons the API would 400.
 */
export function validateCadence(spec: CadenceSpec): string | null {
  if (!isScheduleFrequency(spec.frequency)) return "frequency must be daily, weekly or monthly";
  if (spec.frequency === "weekly") {
    const d = spec.dayOfWeek;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) {
      return "A weekly schedule needs a day of the week";
    }
  }
  if (spec.frequency === "monthly") {
    const d = spec.dayOfMonth;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 31) {
      return "A monthly schedule needs a day of the month (1–31)";
    }
  }
  return null;
}

const PROCESS_LABELS = {
  sprint_progress_email: "Sprint progress email",
  workstream_progress_email: "Workstream progress email",
} satisfies Record<ScheduledProcessName, string>;

/** Human name for a process, for the schedule list and the superuser table. */
export function processLabel(value: string): string {
  return Object.prototype.hasOwnProperty.call(PROCESS_LABELS, value)
    ? PROCESS_LABELS[value as ScheduledProcessName]
    : value;
}

/**
 * The row shape every schedule surface renders. Dates are the plain
 * YYYY-MM-DD calendar days the columns hold; timestamps are ISO strings.
 */
export type ScheduleRow = {
  id: string;
  process: string;
  targetId: string;
  /** Resolved name of the thing it runs against (a sprint, a workstream), for display. */
  targetName: string | null;
  recipients: string[];
  subject: string;
  message: string;
  frequency: ScheduleFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  nextRunOn: string;
  endsOn: string | null;
  lastRunOn: string | null;
  pausedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  /** The most recent attempt, so a list can answer "did it actually go out?". */
  lastRun: {
    runOn: string;
    status: string;
    trigger: string;
    recipientCount: number;
    detail: string | null;
    startedAt: string;
  } | null;
};

/** paused / stopped / live — the one place the three inactive columns are collapsed for display. */
export function scheduleState(row: Pick<ScheduleRow, "pausedAt" | "stoppedAt">): "live" | "paused" | "stopped" {
  if (row.stoppedAt) return "stopped";
  if (row.pausedAt) return "paused";
  return "live";
}

/** One attempt, as the run-history list renders it. */
export type RunRow = {
  id: string;
  runOn: string;
  trigger: string;
  status: string;
  recipientCount: number;
  subject: string | null;
  detail: string | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  /** How many provider messages this run produced — 0 means nothing to check. */
  messageCount: number;
};

/**
 * What the provider last saw happen to a message.
 *
 * The distinction that matters: a run recorded as "sent" only means Resend
 * ACCEPTED the mail. Whether it reached anyone is a separate question, and
 * these are its answers — which is why a delivery check exists at all.
 */
export type DeliveryStatus = {
  messageId: string;
  to: string[];
  /** Resend's last_event: delivered, bounced, complained, queued, failed… */
  lastEvent: string;
  subject: string | null;
};

const DELIVERY_LABELS: Record<string, string> = {
  delivered: "Delivered",
  bounced: "Bounced — the address rejected it",
  complained: "Marked as spam by the recipient",
  delivery_delayed: "Delayed — the provider is still retrying",
  failed: "Failed at the provider",
  queued: "Queued at the provider",
  scheduled: "Scheduled at the provider",
  canceled: "Cancelled",
  sent: "Handed to the receiving server",
  opened: "Delivered and opened",
  clicked: "Delivered and clicked",
};

export function deliveryLabel(lastEvent: string): string {
  return DELIVERY_LABELS[lastEvent] ?? lastEvent;
}

/** Green / red / amber for a delivery event — bounces and complaints are the ones that need chasing. */
export function deliveryTone(lastEvent: string): "good" | "bad" | "pending" {
  if (["delivered", "opened", "clicked", "sent"].includes(lastEvent)) return "good";
  if (["bounced", "complained", "failed", "canceled"].includes(lastEvent)) return "bad";
  return "pending";
}

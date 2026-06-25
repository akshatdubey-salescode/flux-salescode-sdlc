import type { JiraIssueRaw } from "./client";

// Parses the Jira changelog into status segments and derives the per-issue
// rollup we persist on jira_issues (replacing the jira_status_history table).
// The same segment reconstruction feeds both the analytics rollup and the
// runtime timeline display, so the two can never diverge.

export type StatusSegment = {
  fromStatus: string | null;
  toStatus: string;
  changedAt: Date;
  changedByName: string | null;
  changedByEmail: string | null;
  // Seconds spent in toStatus until the next transition; null for the open
  // current segment.
  durationSeconds: number | null;
};

type StatusChange = {
  fromStatus: string | null;
  toStatus: string;
  changedAt: Date;
  changedByName: string;
  changedByEmail: string | null;
};

function extractStatusChanges(raw: JiraIssueRaw): StatusChange[] {
  const histories = raw.changelog?.histories ?? [];
  const sorted = [...histories].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
  );

  const changes: StatusChange[] = [];
  for (const history of sorted) {
    for (const item of history.items) {
      if (item.field === "status") {
        changes.push({
          fromStatus: item.fromString,
          toStatus: item.toString ?? raw.fields.status.name,
          changedAt: new Date(history.created),
          changedByName: history.author.displayName,
          changedByEmail: history.author.emailAddress ?? null,
        });
      }
    }
  }
  return changes;
}

/**
 * Reconstructs the ordered list of status segments from the changelog,
 * including a synthetic initial segment from issue creation. durationSeconds
 * is the time spent in each segment's toStatus; the final (current) segment is
 * left open (null).
 */
export function buildStatusSegments(raw: JiraIssueRaw): StatusSegment[] {
  const changes = extractStatusChanges(raw);
  if (changes.length === 0) return [];

  const segments: StatusSegment[] = [];
  const createdAt = raw.fields.created ? new Date(raw.fields.created) : new Date();
  const firstChange = changes[0];

  // Reconstruct the initial status the issue was created in.
  if (firstChange.fromStatus) {
    segments.push({
      fromStatus: null,
      toStatus: firstChange.fromStatus,
      changedAt: createdAt,
      changedByName: null,
      changedByEmail: null,
      durationSeconds: Math.floor(
        (firstChange.changedAt.getTime() - createdAt.getTime()) / 1000
      ),
    });
  }

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const next = changes[i + 1];
    segments.push({
      fromStatus: change.fromStatus,
      toStatus: change.toStatus,
      changedAt: change.changedAt,
      changedByName: change.changedByName,
      changedByEmail: change.changedByEmail,
      durationSeconds: next
        ? Math.floor((next.changedAt.getTime() - change.changedAt.getTime()) / 1000)
        : null,
    });
  }

  return segments;
}

export type IssueRollup = {
  completedAt: Date | null;
  // Developer work-window endpoints — see jira_issues.dev_started_at /
  // dev_completed_at in the schema. devStartedAt is the first entry into an
  // IN_PROGRESS raw status; devCompletedAt is the first entry into an IN_QA or
  // DONE raw status at/after dev work started (the dev handoff point).
  devStartedAt: Date | null;
  devCompletedAt: Date | null;
  currentStatusSince: Date | null;
  timeInStatus: Record<string, number>;
};

/**
 * The project's raw Jira status names grouped by the canonical buckets the
 * rollup needs: `done` detects completion (completed_at), `inProgress` the
 * start of the dev work-window, and `endOfDev` (IN_QA ∪ DONE) the end of it.
 */
export type StatusRawSets = {
  done: Set<string>;
  inProgress: Set<string>;
  endOfDev: Set<string>;
};

// ---------------------------------------------------------------------------
// Assignee changes — parsed from the changelog to power self-deassignment
// detection and the `assignee_since` rollup. Unlike status (which we roll up
// into scalars), the per-event detail here IS the product: we must know who
// changed the assignee, from whom, to whom, and when.
// ---------------------------------------------------------------------------

export type AssigneeToKind = "unassigned" | "reporter" | "other";

export type AssigneeChange = {
  // Jira changelog history id — stable, used for idempotent upserts.
  changelogHistoryId: string;
  changedAt: Date;
  authorAccountId: string | null;
  authorEmail: string | null;
  authorName: string | null;
  fromAccountId: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toAccountId: string | null;
  toEmail: string | null;
  toName: string | null;
  // The author removed themselves as assignee (author === previous assignee,
  // and the assignee actually changed). Automation/app authors are excluded.
  isSelfRemoval: boolean;
  toKind: AssigneeToKind;
};

/**
 * Extracts every assignee transition from the changelog. Emails are resolved
 * via the accountId→email map (Jira often withholds emailAddress on changelog
 * authors and never includes it on item from/to), mirroring the privacy
 * fallback used during issue upsert.
 */
export function extractAssigneeChanges(
  raw: JiraIssueRaw,
  accountIdEmailMap?: Map<string, string>
): AssigneeChange[] {
  const histories = raw.changelog?.histories ?? [];
  const reporterAccountId = raw.fields.reporter?.accountId ?? null;
  const resolveEmail = (accountId: string | null): string | null =>
    accountId ? accountIdEmailMap?.get(accountId) ?? null : null;

  const changes: AssigneeChange[] = [];
  for (const history of histories) {
    const isApp = history.author?.accountType === "app";
    const authorAccountId = history.author?.accountId ?? null;
    for (const item of history.items) {
      if (item.field !== "assignee") continue;

      const fromAccountId = item.from ?? null;
      const toAccountId = item.to ?? null;
      const isSelfRemoval =
        !isApp &&
        fromAccountId != null &&
        authorAccountId != null &&
        authorAccountId === fromAccountId &&
        fromAccountId !== toAccountId;

      const toKind: AssigneeToKind =
        toAccountId == null
          ? "unassigned"
          : reporterAccountId != null && toAccountId === reporterAccountId
            ? "reporter"
            : "other";

      changes.push({
        changelogHistoryId: history.id,
        changedAt: new Date(history.created),
        authorAccountId,
        authorEmail:
          history.author?.emailAddress ?? resolveEmail(authorAccountId),
        authorName: history.author?.displayName ?? null,
        fromAccountId,
        fromEmail: resolveEmail(fromAccountId),
        fromName: item.fromString,
        toAccountId,
        toEmail: resolveEmail(toAccountId),
        toName: item.toString,
        isSelfRemoval,
        toKind,
      });
    }
  }

  changes.sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  return changes;
}

/**
 * Derives when the issue's *current* assignee took ownership: the timestamp of
 * the most recent assignee change landing on them, or the issue's creation time
 * if it was assigned at creation and never reassigned. null when unassigned.
 */
export function deriveAssigneeSince(raw: JiraIssueRaw): Date | null {
  const currentAssignee = raw.fields.assignee?.accountId ?? null;
  if (!currentAssignee) return null;

  const changes = extractAssigneeChanges(raw);
  for (let i = changes.length - 1; i >= 0; i--) {
    if (changes[i].toAccountId === currentAssignee) return changes[i].changedAt;
  }
  // Assigned at creation, never reassigned (no assignee changelog entries).
  return raw.fields.created ? new Date(raw.fields.created) : null;
}

/**
 * Derives the persisted rollup from the changelog. `sets` groups the project's
 * raw status names by canonical bucket: `done` detects completion transitions,
 * `inProgress` the start of the dev work-window, and `endOfDev` (IN_QA ∪ DONE)
 * its end.
 */
export function computeRollup(
  raw: JiraIssueRaw,
  sets: StatusRawSets
): IssueRollup {
  const segments = buildStatusSegments(raw);
  const createdAt = raw.fields.created ? new Date(raw.fields.created) : new Date();

  const timeInStatus: Record<string, number> = {};
  let completedAt: Date | null = null;
  let devStartedAt: Date | null = null;
  let devCompletedAt: Date | null = null;

  if (segments.length === 0) {
    // No recorded transitions — issue has sat in its current status since
    // creation. Treat creation as completion only if created directly in DONE,
    // and as the dev-start only if created directly in IN_PROGRESS.
    const currentDone = sets.done.has(raw.fields.status.name);
    return {
      completedAt: currentDone ? createdAt : null,
      devStartedAt: sets.inProgress.has(raw.fields.status.name) ? createdAt : null,
      devCompletedAt: null,
      currentStatusSince: createdAt,
      timeInStatus,
    };
  }

  for (const seg of segments) {
    if (seg.durationSeconds != null && seg.durationSeconds > 0) {
      timeInStatus[seg.toStatus] = (timeInStatus[seg.toStatus] ?? 0) + seg.durationSeconds;
    }
    const enteredDone =
      sets.done.has(seg.toStatus) &&
      !(seg.fromStatus != null && sets.done.has(seg.fromStatus));
    if (enteredDone) {
      completedAt = seg.changedAt;
    }
    // First time the issue entered active development.
    if (devStartedAt == null && sets.inProgress.has(seg.toStatus)) {
      devStartedAt = seg.changedAt;
    }
    // First handoff out of development (into QA or Done) once work has begun.
    if (devStartedAt != null && devCompletedAt == null && sets.endOfDev.has(seg.toStatus)) {
      devCompletedAt = seg.changedAt;
    }
  }

  return {
    completedAt,
    devStartedAt,
    devCompletedAt,
    currentStatusSince: segments[segments.length - 1].changedAt,
    timeInStatus,
  };
}

/**
 * Applies a single live status transition (webhook) to an existing rollup,
 * returning the updated column values. `prevStatusSince` is the issue's current
 * current_status_since; `prevTimeInStatus` its current map.
 */
export function applyTransition(args: {
  fromStatus: string;
  toStatus: string;
  changedAt: Date;
  prevStatusSince: Date | null;
  prevTimeInStatus: Record<string, number>;
  prevCompletedAt: Date | null;
  prevDevStartedAt: Date | null;
  prevDevCompletedAt: Date | null;
  sets: StatusRawSets;
}): IssueRollup {
  const timeInStatus = { ...args.prevTimeInStatus };

  // Close the segment the issue is leaving (it sat in fromStatus since
  // prevStatusSince) and credit the elapsed time.
  if (args.prevStatusSince) {
    const seconds = Math.floor(
      (args.changedAt.getTime() - args.prevStatusSince.getTime()) / 1000
    );
    if (seconds > 0) {
      timeInStatus[args.fromStatus] = (timeInStatus[args.fromStatus] ?? 0) + seconds;
    }
  }

  const enteredDone =
    args.sets.done.has(args.toStatus) && !args.sets.done.has(args.fromStatus);

  // Dev work-window endpoints latch on the first occurrence and never move.
  const devStartedAt =
    args.prevDevStartedAt ??
    (args.sets.inProgress.has(args.toStatus) ? args.changedAt : null);
  const devCompletedAt =
    args.prevDevCompletedAt ??
    (devStartedAt != null && args.sets.endOfDev.has(args.toStatus)
      ? args.changedAt
      : null);

  return {
    completedAt: enteredDone ? args.changedAt : args.prevCompletedAt,
    devStartedAt,
    devCompletedAt,
    currentStatusSince: args.changedAt,
    timeInStatus,
  };
}

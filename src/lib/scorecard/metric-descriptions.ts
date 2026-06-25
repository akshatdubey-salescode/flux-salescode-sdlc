// Plain-English explanations of each performance-review metric, shown on the
// score-breakdown drill-down so reviewers can read exactly what every sub-score
// means and how it's computed. Kept separate from the stored breakdown (which
// holds per-developer numbers) since this text is static.

import type { MetricKey } from "./config";

export type MetricInfo = {
  /** Point range the metric can produce. */
  range: string;
  /** One-line summary of what the metric captures. */
  summary: string;
  /** Detailed explanation of how the points are derived. */
  detail: string;
};

// How the time-based metrics (MTTR, Sprint Commitment) decide the start and end
// dates they measure against. Surfaced on the breakdown page so reviewers
// understand why a number isn't simply "created → done".
export const DATE_CAPTURE_NOTE = {
  title: "How dates are captured",
  intro:
    "MTTR and Sprint Commitment measure the developer work-window — the time a ticket was actually being worked — not its whole life in Jira. A ticket is often raised by an analyst days before it's assigned, and can sit in QA for days after the developer is done; neither gap is the developer's to own. The window's start and end are resolved in this order:",
  steps: [
    "Actual start / Actual end — when the project has these Jira fields filled in, they are used directly.",
    "Otherwise, from the status history: the window starts when the ticket first moved into an In Progress status, and ends when it first left development for In QA or Done.",
    "If a ticket never passed through an In Progress status, we fall back to Jira's created and completed timestamps so it is still scored rather than dropped.",
  ],
} as const;

export const METRIC_INFO: Record<MetricKey, MetricInfo> = {
  bugQuality: {
    range: "0–5",
    summary: "Feature output relative to the bugs attributed to the developer.",
    detail:
      "Score = features ÷ (features + priority-weighted bugs) × 5. Every non-bug task the developer delivered counts as a feature. Bugs are weighted by priority (P0 = 10, P1 = 7, P2 = 5, P3 = 3, P4 = 1) and charged to the bug's Issue Owner, falling back to its assignee. Bugs whose status is “Not a bug” or “Can’t Reproduce” are ignored entirely. A developer with no bugs and no features scores a full 5.",
  },
  codeChurn: {
    range: "N/A",
    summary: "Rework — how often PRs are re-opened against the same ticket.",
    detail:
      "Measures repeated pull requests against the same Jira ticket (a rework signal). Not tracked on this platform — GitHub pull requests are not synced — and it carries weight 0, so it does not affect the final score.",
  },
  mttr: {
    range: "0–5",
    summary: "Average time to resolve the developer's high-priority bugs.",
    detail:
      "Mean Time To Resolve — the average resolution time across the developer's P1/P2 (high-priority) bugs, in minutes. Under 90 min → 5, under 180 min → 4, otherwise 0. (Thresholds are configurable.) Resolution time is measured over the developer work-window (see “How dates are captured” above), not the full ticket lifetime, so time a bug sits unassigned before work begins — or waits in QA after hand-off — isn't charged to the developer. Only P1/P2 bugs owned by the developer (Issue Owner, assignee fallback) count; a developer with no such bugs scores a full 5.",
  },
  sprintCommitment: {
    range: "1–5",
    summary: "Share of due-dated tasks delivered on or before their due date.",
    detail:
      "The percentage of the developer's due-dated tasks delivered on or before the due date (time of day ignored): ≥95% → 5, ≥90% → 4, ≥80% → 3, ≥70% → 2, below 70% → 1. The delivery date is the end of the developer work-window (see “How dates are captured” above) — when the developer handed the task off to QA or marked it done — not when it later cleared QA. Tasks without a due date are excluded, and a developer with no due-dated tasks receives no Sprint Commitment score.",
  },
  complexTasks: {
    range: "0–5",
    summary: "Average task complexity rewarded together with volume.",
    detail:
      "Rewards both how hard and how much work was completed. Each task's complexity (1–5) maps to a weight (1 / 3 / 5 / 7 / 10); the score multiplies the average weight by a volume factor that grows with task count (≈0.63 at 60 tasks, ≈0.86 at 120). Reaching 5 requires consistently high-complexity work at high volume. Needs the Jira Complexity field — a resync is required for this to be meaningful.",
  },
  aiTasks: {
    range: "N/A",
    summary: "Share of complex tasks delivered with a small original estimate.",
    detail:
      "Of the developer's complex tasks (complexity ≥ 3), the percentage delivered with a small original estimate (under 5 hours). Currently excluded from the rating — it carries weight 0, so it does not affect the final score.",
  },
  effort: {
    range: "N/A",
    summary: "Logged development + meeting hours vs an expected baseline.",
    detail:
      "Total logged development and meeting hours relative to an expected baseline. Not tracked on this platform (no per-developer dev-hours data) and it carries weight 0, so it does not affect the final score.",
  },
};

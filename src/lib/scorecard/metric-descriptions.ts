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
      "Mean Time To Resolve — the average time from creation to completion across the developer's P1/P2 (high-priority) bugs, in minutes. Under 90 min → 5, under 180 min → 4, otherwise 0. (Thresholds are configurable.) Only P1/P2 bugs owned by the developer (Issue Owner, assignee fallback) count; a developer with no such bugs scores a full 5.",
  },
  sprintCommitment: {
    range: "1–5",
    summary: "Share of due-dated tasks delivered on or before their due date.",
    detail:
      "The percentage of the developer's due-dated tasks completed on or before the due date (time of day ignored): ≥95% → 5, ≥90% → 4, ≥80% → 3, ≥70% → 2, below 70% → 1. Completion is taken from when the task moved to a Done status. Tasks without a due date are excluded, and a developer with no due-dated tasks receives no Sprint Commitment score.",
  },
  complexTasks: {
    range: "0–5",
    summary: "Average task complexity rewarded together with volume.",
    detail:
      "Rewards both how hard and how much work was completed. Each task's complexity (1–5) maps to a weight (1 / 3 / 5 / 7 / 10); the score multiplies the average weight by a volume factor that grows with task count (≈0.63 at 60 tasks, ≈0.86 at 120). Reaching 5 requires consistently high-complexity work at high volume. Needs the Jira Complexity field — a resync is required for this to be meaningful.",
  },
  aiTasks: {
    range: "0–5",
    summary: "Share of complex tasks delivered with a small original estimate.",
    detail:
      "Of the developer's complex tasks (complexity ≥ 3), the percentage delivered with a small original estimate (under 5 hours): ≥90% → 5, ≥80% → 4, ≥70% → 3, ≥60% → 2, below 60% → 1. A developer with no complex tasks scores 0. Needs the Jira Complexity field and original estimate — a resync is required.",
  },
  effort: {
    range: "N/A",
    summary: "Logged development + meeting hours vs an expected baseline.",
    detail:
      "Total logged development and meeting hours relative to an expected baseline. Not tracked on this platform (no per-developer dev-hours data) and it carries weight 0, so it does not affect the final score.",
  },
};

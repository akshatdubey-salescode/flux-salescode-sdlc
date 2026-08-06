// Plain-English, always-current explanations of every performance-review score
// field — shown in-app (main board + drill-down) so nobody has to guess how a
// number was produced.
//
// MAINTENANCE: numeric parameters (weights, thresholds, complexity weights, K)
// are interpolated from ./config, so they stay correct automatically when those
// constants change. If you change the *shape* of a formula or the attribution /
// scope rules (engine.ts, build.ts, scope.ts), update the matching prose here in
// the same change — this file is the single source of truth users read.

import {
  WEIGHTS,
  THRESHOLDS,
  PRIORITY_WEIGHTS,
  COMPLEXITY_WEIGHTS,
  COMPLEX_TASKS_K,
  COMPLEX_THRESHOLD,
  AI_TASK_MAX_ESTIMATE_HOURS,
  type MetricKey,
} from "./config";

export type MetricInfo = {
  /** Share of the final score this metric carries, e.g. "30%". */
  weightPct: string;
  /** Point range the metric can produce. */
  range: string;
  /** One-line summary of what the metric captures. */
  summary: string;
  /** Detailed explanation of how the points are derived. */
  detail: string;
};

const pct = (k: MetricKey) => `${Math.round(WEIGHTS[k] * 100)}%`;
const cw = COMPLEXITY_WEIGHTS;
const [mttrFast, mttrOk] = THRESHOLDS.mttr;
const [sc1, sc2, sc3, sc4] = THRESHOLDS.sprintCommitment;
// Output that earns ~63% of full marks on Complex Tasks, for the example below.
const complexAtK = (5 * (1 - Math.exp(-1))).toFixed(1);

export const METRIC_INFO: Record<MetricKey, MetricInfo> = {
  bugQuality: {
    weightPct: pct("bugQuality"),
    range: "0–5",
    summary: "Productive output (features + bugs you resolved) vs the bugs you own.",
    detail:
      `Score = output ÷ (output + your priority-weighted bug load) × 5, where output = your feature tasks plus the priority-weighted bugs you resolved. ` +
      `The bug *load* (the penalty) is charged to each bug's Issue Owner — accountability for the defect existing. *Resolving* a bug instead credits the resolver (Dev Owner → Assignee), so fixing bugs lifts the score while owning them lowers it. ` +
      `Bugs are weighted by priority (P0 = ${PRIORITY_WEIGHTS.p0}, P1 = ${PRIORITY_WEIGHTS.p1}, P2 = ${PRIORITY_WEIGHTS.p2}, P3 = ${PRIORITY_WEIGHTS.p3}, P4 = ${PRIORITY_WEIGHTS.p4}). Bugs marked “Not a bug” / “Can’t Reproduce” are ignored. No bugs and no output → a full 5.`,
  },
  codeChurn: {
    weightPct: pct("codeChurn"),
    range: "N/A",
    summary: "Rework — how often PRs are re-opened against the same ticket.",
    detail:
      "Repeated pull requests against the same Jira ticket (a rework signal). Not tracked on this platform — GitHub PRs aren't synced — and it carries weight 0, so it does not affect the final score.",
  },
  mttr: {
    weightPct: pct("mttr"),
    range: "0–5",
    summary: "Average time to resolve the high-priority bugs you fixed.",
    detail:
      `Mean Time To Resolve — the average resolution time across P1/P2 bugs, measured over the developer work-window (see “How dates are captured”), not the whole ticket life. Under ${mttrFast} min → 5, under ${mttrOk} min → 4, otherwise 0. ` +
      `Only actual bugs count (issue type bug / defect / sub-bug) — a high-priority *Task* never counts, even when it's P1. Credited to the resolver (Dev Owner → Assignee). A developer with no qualifying bugs scores a full 5.`,
  },
  sprintCommitment: {
    weightPct: pct("sprintCommitment"),
    range: "1–5",
    summary: "Share of due-dated tasks delivered on or before their due date.",
    detail:
      `The percentage of your due-dated tasks delivered on or before the due date (time of day ignored): ≥${sc1}% → 5, ≥${sc2}% → 4, ≥${sc3}% → 3, ≥${sc4}% → 2, below → 1. ` +
      `“Delivered” is the end of the developer work-window — when you handed it to QA or marked it done — not when it later cleared QA. Tasks without a due date are excluded; with no due-dated tasks you receive no Sprint Commitment score.`,
  },
  complexTasks: {
    weightPct: pct("complexTasks"),
    range: "0–5",
    summary: "Complexity-weighted throughput — volume and difficulty on one scale.",
    detail:
      `Each task's complexity (1–5) maps to a weight (C1 = ${cw[1]}, C2 = ${cw[2]}, C3 = ${cw[3]}, C4 = ${cw[4]}, C5 = ${cw[5]}). Your “output” is the SUM of those weights across your tasks. ` +
      `Score = 5 × (1 − e^(−output ÷ ${COMPLEX_TASKS_K})) — rising with diminishing returns (output of ${COMPLEX_TASKS_K} ≈ ${complexAtK}/5). ` +
      `Because it's a sum, many small tasks and a few hard ones earn credit on the same scale — a handful of complex tasks is no longer crushed by low volume, and high-volume work is no longer crushed by low average complexity. Needs the Jira Complexity field set.`,
  },
  aiTasks: {
    weightPct: pct("aiTasks"),
    range: "N/A",
    summary: "Share of complex tasks delivered with a small original estimate.",
    detail:
      `Of your complex tasks (complexity ≥ ${COMPLEX_THRESHOLD}), the share delivered with a small original estimate (under ${AI_TASK_MAX_ESTIMATE_HOURS} hours). Tracked but currently excluded from the rating — weight 0, so it does not affect the final score.`,
  },
  effort: {
    weightPct: pct("effort"),
    range: "N/A",
    summary: "Logged development + meeting hours vs an expected baseline.",
    detail:
      "Total logged development and meeting hours relative to an expected baseline. Not tracked on this platform (no per-developer dev-hours data) and it carries weight 0, so it does not affect the final score.",
  },
};

// How the time-based metrics (MTTR, Sprint Commitment) decide the start/end they
// measure against — so a number isn't read as simply "created → done".
export const DATE_CAPTURE_NOTE = {
  title: "How dates are captured",
  intro:
    "MTTR and Sprint Commitment measure the developer work-window — the time a ticket was actually being worked — not its whole life in Jira. A ticket is often raised days before it's assigned, and can sit in QA after the developer is done; neither gap is theirs to own. Start and end resolve in this order:",
  steps: [
    "Actual start / Actual end — when the team fills these Jira fields in, they're used directly.",
    "Otherwise from the status history: starts when the ticket first moved into an In Progress status, ends when it first left development for In QA or Done.",
    "If it never passed through In Progress, fall back to Jira's created / completed timestamps so it's still scored rather than dropped.",
  ],
} as const;

// Who each score is credited to — attribution is by role, not just the assignee.
export const ATTRIBUTION_NOTE = {
  title: "Who a score is credited to",
  intro: "Credit follows the person who did the work, not just the assignee:",
  steps: [
    "Tasks (non-bugs) → the Dev Owner if set, otherwise the Assignee. Feeds Complex Tasks, Sprint Commitment, and the output side of Bug Quality.",
    "Bug penalty (Bug Quality bug-load) → the bug's Issue Owner — accountability for the defect. A bug with no Issue Owner is charged to nobody.",
    "Bug resolution credit + MTTR → the resolver (Dev Owner → Assignee) — whoever actually fixed it.",
  ],
} as const;

// Which quarter an issue lands in.
export const SCOPE_NOTE = {
  title: "Which quarter an issue counts in",
  intro: "An issue is scored in the quarter its work finished, regardless of when it was raised:",
  steps: [
    "Finish date = Actual end → planned End/Due date → the Done date; it must fall inside the quarter.",
    "Carryover raised in an earlier quarter but delivered this quarter still counts here.",
    "Backdated tickets are dropped: a recorded start that's before the quarter and before the ticket's own creation means the dates were filled in after the fact.",
  ],
} as const;

// Who shows up on the leaderboard at all (display-level filtering).
export const BOARD_NOTE = {
  title: "Who appears on the board",
  intro: "The leaderboard is the engineering team only:",
  steps: [
    "Business-team departments are excluded (Sales & Business Development, Projects & Product, Support, Marketing, Human Resources, Finance, Admin & IT, Founder's Office).",
    "People who have left the org are removed — a Keka exit date on or before today (people on notice still appear).",
  ],
} as const;

// The "Adj. Score" / "Complexity Acc." columns and the C4/C5-vs-LOC flag.
export const ADJUSTED_SCORE_NOTE = {
  title: "Adjusted score, complexity accuracy & flags",
  intro: "Two second opinions alongside the raw score, both LOC-based:",
  steps: [
    "Adjusted score excludes self-assigned Jiras — issues where the reporter is also the person credited for the work — from every metric.",
    "Complexity Accuracy is correct/checked tasks, shown as a % — of the tasks with a matched PR, how many had marked complexity match what the LOC predicts. Tasks with no matched PR aren't checked at all (not counted as wrong).",
    "Feature tasks marked Complexity 4-5 are additionally flagged ⚠ when their LOC falls well below what that complexity usually takes — a nudge to double-check the rating, not an automatic downgrade.",
    "LOC is matched by finding the Jira key in a PR's title or branch (generously — dash, underscore, dot, space, or no separator all resolve), requiring the PR author to be the same person as the Jira's assignee, and requiring the PR to have been created or merged inside the quarter. Run \"Sync LOC\" to (re)compute it — it's cached, not recalculated on every view. Editing a Jira's complexity in Jira and hitting Recompute re-derives both metrics fresh, nothing here is a stale snapshot.",
  ],
} as const;

// Performance-review rating configuration. These are the default weights,
// rubric thresholds, and classification maps that drive the scoring engine
// (see engine.ts). They are exported as plain typed constants so the engine
// stays pure and unit-testable; a future DB-backed config can override them
// without touching the formulas.

export type MetricKey =
  | "bugQuality"
  | "codeChurn"
  | "mttr"
  | "sprintCommitment"
  | "complexTasks"
  | "aiTasks"
  | "effort";

/**
 * Default metric weights. The five data-backed metrics sum to exactly 1.00;
 * Code Churn and Effort default to 0 (no PR/dev-hours data on this platform),
 * so they don't affect final_score. final_score = Σ (weight × points).
 */
export const WEIGHTS: Record<MetricKey, number> = {
  bugQuality: 0.3,
  codeChurn: 0.0,
  mttr: 0.15,
  sprintCommitment: 0.25,
  complexTasks: 0.23,
  aiTasks: 0.07,
  effort: 0.0,
};

/** Rubric thresholds. Each is exactly four numbers; MTTR uses only [0],[1]. */
export const THRESHOLDS = {
  codeChurn: [5, 10, 15, 25] as const, // pct < t → higher points
  mttr: [90, 180, 0, 0] as const, // minutes; positions 2,3 ignored
  sprintCommitment: [95, 90, 80, 70] as const, // pct ≥ t → higher points
  aiTasks: [90, 80, 70, 60] as const, // pct ≥ t → higher points
};

/** Effort: expected total hours to reach the cap of 5 points. */
export const EFFORT_EXPECTED_HOURS = 464;

/**
 * Priority → weight, applied to a bug's contribution to its owner's
 * weighted-bug total. Keys are normalized (trimmed, lower-cased) priority
 * strings. Anything unmatched (or empty) falls back to 1.
 */
export const PRIORITY_WEIGHTS: Record<string, number> = {
  p0: 10,
  highest: 7,
  blocker: 7,
  critical: 7,
  p1: 7,
  high: 5,
  major: 5,
  p2: 5,
  medium: 3,
  moderate: 3,
  p3: 3,
  low: 1,
  minor: 1,
  p4: 1,
};

export const DEFAULT_PRIORITY_WEIGHT = 1;

/** P1/P2 classification — used only to decide which bugs yield an MTTR sample. */
export const P1_PRIORITIES = new Set(["highest", "blocker", "critical", "p1"]);
export const P2_PRIORITIES = new Set(["high", "major", "p2"]);

/** Complexity level (1–5) → weight. Missing/unknown → 1; raw > 5 capped at 5. */
export const COMPLEXITY_WEIGHTS: Record<number, number> = {
  1: 1,
  2: 3,
  3: 5,
  4: 7,
  5: 10,
};

export const DEFAULT_COMPLEXITY_WEIGHT = 1;

/**
 * Bug statuses that exclude a bug from all scoring. Compared after normalizing
 * (lower-cased, trimmed, apostrophes stripped, whitespace collapsed) so curly
 * vs straight apostrophes and spacing don't matter — see normalizeStatus().
 */
export const BUG_INVALID_STATUSES = new Set([
  "not a bug",
  "cant reproduce", // actual Jira status: "Can't Reproduce"
  "couldnt reproduce", // tolerate the "Couldn't Reproduce" wording too
]);

/** Normalize a status for comparison against BUG_INVALID_STATUSES. */
export function normalizeStatus(status: string | null | undefined): string {
  return (status ?? "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Issue types (normalized) treated as bugs. Bugs feed weighted-bugs + MTTR and
 * are excluded from the feature count; everything else is a "task" feeding
 * Complex/AI/Sprint metrics.
 */
export const BUG_ISSUE_TYPES = new Set(["bug", "defect", "sub-bug"]);

/** A task is "complex" (for AI-tasks tracking) when raw complexity ≥ this. */
export const COMPLEX_THRESHOLD = 3;

/** AI task: original estimate strictly within this many hours (and > 0). */
export const AI_TASK_MAX_ESTIMATE_HOURS = 5;

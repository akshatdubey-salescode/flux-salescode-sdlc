// Pure performance-review scoring engine. Each metric is a self-contained
// function returning its points (or null when "no data") alongside the raw
// inputs used. `computeScorecard` assembles them into the final weighted score
// and a display-ready breakdown. No DB / IO here — see build.ts for the data
// loading that produces ScorecardInputs.

import {
  WEIGHTS,
  THRESHOLDS,
  EFFORT_EXPECTED_HOURS,
  type MetricKey,
} from "./config";

// ---------------------------------------------------------------------------
// Inputs (already aggregated per user, per quarter, per PDF §5)
// ---------------------------------------------------------------------------

export type ScorecardInputs = {
  // Bug Quality
  features: number;
  weightedBugs: number;
  // MTTR — one entry per qualifying P1/P2 bug resolution (minutes, ≥ 0).
  mttrMinutesSamples: number[];
  // Sprint Commitment
  sprintNotDelayed: number;
  sprintTotal: number;
  // Complex Tasks
  complexWeightedTotal: number;
  complexTotalTasks: number;
  // AI / Underestimated Tasks
  aiTaskCount: number;
  totalComplex: number;
  // Optional metrics not sourced on this platform (kept for completeness /
  // future reconfiguration). Pass null to render them as "N/A".
  churn?: { repeatedPrCount: number; totalPrCount: number } | null;
  effort?: { devHours: number | null; meetingHours: number | null } | null;
};

// ---------------------------------------------------------------------------
// Rubric helpers
// ---------------------------------------------------------------------------

/** "Lower is better": pct < t1→5, <t2→4, <t3→3, <t4→2, else 1. */
function rubricAscending(pct: number, t: readonly number[]): number {
  if (pct < t[0]) return 5;
  if (pct < t[1]) return 4;
  if (pct < t[2]) return 3;
  if (pct < t[3]) return 2;
  return 1;
}

/** "Higher is better": pct ≥ t1→5, ≥t2→4, ≥t3→3, ≥t4→2, else 1. */
function rubricDescending(pct: number, t: readonly number[]): number {
  if (pct >= t[0]) return 5;
  if (pct >= t[1]) return 4;
  if (pct >= t[2]) return 3;
  if (pct >= t[3]) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Per-metric formulas (PDF §4)
// ---------------------------------------------------------------------------

/** §4.1 — ratio of feature output to priority-weighted bug load. 0–5. */
export function bugQualityPoints(features: number, weightedBugs: number): number {
  const denom = features + weightedBugs;
  if (denom === 0) return 5; // no data → full score
  return (features / denom) * 5;
}

/** §4.2 — repeated PRs against the same Jira ID. 1–5. 5 when no qualifying PRs. */
export function codeChurnPoints(
  repeatedPrCount: number,
  totalPrCount: number
): number {
  if (totalPrCount === 0) return 5;
  const pct = (repeatedPrCount / totalPrCount) * 100;
  return rubricAscending(pct, THRESHOLDS.codeChurn);
}

/** §4.3 — avg minutes to resolve P1/P2 bugs. <t1→5, <t2→4, else 0. 5 if no samples. */
export function mttrPointsFromSamples(samples: number[]): {
  points: number;
  avgMinutes: number | null;
} {
  if (samples.length === 0) return { points: 5, avgMinutes: null };
  const avgMinutes = samples.reduce((a, b) => a + b, 0) / samples.length;
  const [t1, t2] = THRESHOLDS.mttr;
  const points = avgMinutes < t1 ? 5 : avgMinutes < t2 ? 4 : 0;
  return { points, avgMinutes };
}

/** §4.5 — share of fully-dated tasks delivered on/before due date. null if none. */
export function sprintCommitmentPoints(
  notDelayed: number,
  total: number
): number | null {
  if (total === 0) return null; // no due-dated tasks → no score
  const pct = (notDelayed / total) * 100;
  return rubricDescending(pct, THRESHOLDS.sprintCommitment);
}

/** §4.4 — average complexity × volume factor. 0–5 (asymptotic). 0 if no tasks. */
export function complexTasksPoints(
  weightedTotal: number,
  totalTasks: number
): number {
  if (totalTasks === 0) return 0;
  const avgWeight = weightedTotal / totalTasks; // 1 … 10
  const normalizedComplexity = avgWeight / 10; // 0.1 … 1.0
  const volumeFactor = 1 - Math.exp(-totalTasks / 60); // 0 … →1
  return normalizedComplexity * 5 * volumeFactor;
}

/** §4.6 — share of complex tasks with a small original estimate. 0 if none. */
export function aiTasksPoints(aiTaskCount: number, totalComplex: number): number {
  if (totalComplex === 0) return 0;
  const pct = (aiTaskCount / totalComplex) * 100;
  return rubricDescending(pct, THRESHOLDS.aiTasks);
}

/** §4.7 — logged hours vs expected, capped at 5. null when no hours recorded. */
export function effortPoints(
  devHours: number | null,
  meetingHours: number | null
): number | null {
  if (devHours == null && meetingHours == null) return null;
  const totalHours = (devHours ?? 0) + (meetingHours ?? 0);
  if (totalHours === 0) return 0;
  return Math.min(5, (totalHours / EFFORT_EXPECTED_HOURS) * 5);
}

// ---------------------------------------------------------------------------
// Assembly (PDF §6)
// ---------------------------------------------------------------------------

export type MetricBreakdown = {
  key: MetricKey;
  label: string;
  weight: number;
  points: number | null;
  /** weight × (points ?? 0) — the metric's contribution to final_score. */
  contribution: number;
  /** Human-readable summary of the raw inputs for the drill-down. */
  raw: string;
  /** false when the metric has no data source on this platform (→ "N/A"). */
  available: boolean;
};

export type ScorecardResult = {
  weightedBugs: number;
  featureCount: number;
  bugQualityPoints: number | null;
  mttrMinutes: number | null;
  mttrPoints: number | null;
  sprintCommitmentNotDelayed: number;
  sprintCommitmentTotal: number;
  sprintCommitmentPoints: number | null;
  complexTasksCount: number;
  complexTasksPoints: number | null;
  underestimatedTasksCount: number;
  underestimatedTasksPoints: number | null;
  finalScore: number;
  breakdown: { metrics: MetricBreakdown[]; finalScore: number };
};

const LABELS: Record<MetricKey, string> = {
  bugQuality: "Bug Quality",
  codeChurn: "Code Churn",
  mttr: "MTTR",
  sprintCommitment: "Sprint Commitment",
  complexTasks: "Complex Tasks",
  aiTasks: "AI Tasks",
  effort: "Effort",
};

export function computeScorecard(inputs: ScorecardInputs): ScorecardResult {
  const bugPts = bugQualityPoints(inputs.features, inputs.weightedBugs);
  const { points: mttrPts, avgMinutes } = mttrPointsFromSamples(
    inputs.mttrMinutesSamples
  );
  const sprintPts = sprintCommitmentPoints(
    inputs.sprintNotDelayed,
    inputs.sprintTotal
  );
  const complexPts = complexTasksPoints(
    inputs.complexWeightedTotal,
    inputs.complexTotalTasks
  );
  const aiPts = aiTasksPoints(inputs.aiTaskCount, inputs.totalComplex);

  // Optional / not-sourced metrics.
  const churnAvailable = inputs.churn != null;
  const churnPts = churnAvailable
    ? codeChurnPoints(inputs.churn!.repeatedPrCount, inputs.churn!.totalPrCount)
    : null;
  const effortAvailable = inputs.effort != null;
  const effortPts = effortAvailable
    ? effortPoints(inputs.effort!.devHours, inputs.effort!.meetingHours)
    : null;

  const contribution = (key: MetricKey, points: number | null) =>
    WEIGHTS[key] * (points ?? 0);

  const metrics: MetricBreakdown[] = [
    {
      key: "bugQuality",
      label: LABELS.bugQuality,
      weight: WEIGHTS.bugQuality,
      points: bugPts,
      contribution: contribution("bugQuality", bugPts),
      raw: `${inputs.features} feature task(s), ${inputs.weightedBugs} weighted bug(s)`,
      available: true,
    },
    {
      key: "codeChurn",
      label: LABELS.codeChurn,
      weight: WEIGHTS.codeChurn,
      points: churnPts,
      contribution: contribution("codeChurn", churnPts),
      raw: churnAvailable
        ? `${inputs.churn!.repeatedPrCount}/${inputs.churn!.totalPrCount} repeated PRs`
        : "Not tracked",
      available: churnAvailable,
    },
    {
      key: "mttr",
      label: LABELS.mttr,
      weight: WEIGHTS.mttr,
      points: mttrPts,
      contribution: contribution("mttr", mttrPts),
      raw:
        avgMinutes == null
          ? "No P1/P2 bug samples"
          : `${avgMinutes.toFixed(0)} min avg over ${inputs.mttrMinutesSamples.length} bug(s)`,
      available: true,
    },
    {
      key: "sprintCommitment",
      label: LABELS.sprintCommitment,
      weight: WEIGHTS.sprintCommitment,
      points: sprintPts,
      contribution: contribution("sprintCommitment", sprintPts),
      raw:
        inputs.sprintTotal === 0
          ? "No due-dated tasks"
          : `${inputs.sprintNotDelayed}/${inputs.sprintTotal} on time`,
      available: true,
    },
    {
      key: "complexTasks",
      label: LABELS.complexTasks,
      weight: WEIGHTS.complexTasks,
      points: complexPts,
      contribution: contribution("complexTasks", complexPts),
      raw:
        inputs.complexTotalTasks === 0
          ? "No tasks"
          : `${inputs.complexTotalTasks} task(s), avg weight ${(
              inputs.complexWeightedTotal / inputs.complexTotalTasks
            ).toFixed(2)}`,
      available: true,
    },
    {
      key: "aiTasks",
      label: LABELS.aiTasks,
      weight: WEIGHTS.aiTasks,
      points: aiPts,
      contribution: contribution("aiTasks", aiPts),
      raw:
        inputs.totalComplex === 0
          ? "No complex tasks"
          : `${inputs.aiTaskCount}/${inputs.totalComplex} complex tasks under estimate`,
      available: true,
    },
    {
      key: "effort",
      label: LABELS.effort,
      weight: WEIGHTS.effort,
      points: effortPts,
      contribution: contribution("effort", effortPts),
      raw: effortAvailable
        ? `${(inputs.effort!.devHours ?? 0) + (inputs.effort!.meetingHours ?? 0)} h logged`
        : "Not tracked",
      available: effortAvailable,
    },
  ];

  const finalScore = metrics.reduce((sum, m) => sum + m.contribution, 0);

  return {
    weightedBugs: inputs.weightedBugs,
    featureCount: inputs.features,
    bugQualityPoints: bugPts,
    mttrMinutes: avgMinutes,
    mttrPoints: mttrPts,
    sprintCommitmentNotDelayed: inputs.sprintNotDelayed,
    sprintCommitmentTotal: inputs.sprintTotal,
    sprintCommitmentPoints: sprintPts,
    complexTasksCount: inputs.complexTotalTasks,
    complexTasksPoints: complexPts,
    underestimatedTasksCount: inputs.aiTaskCount,
    underestimatedTasksPoints: aiPts,
    finalScore,
    breakdown: { metrics, finalScore },
  };
}

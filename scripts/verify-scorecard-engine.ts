// Verifies the performance-review scoring engine against a worked example.
// final_score is on the 0–100 scale (Σ weight×points × 20). No DB.
// Run: pnpm tsx scripts/verify-scorecard-engine.ts

import assert from "node:assert/strict";
import { computeScorecard } from "../src/lib/scorecard/engine";

function approx(actual: number, expected: number, eps = 1e-3) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${expected}, got ${actual}`
  );
}

// §6.4: 40 feature tasks; 2 owned P2 bugs (weight 5 each → 10); avg MTTR 75 min;
// 18/20 fully-dated tasks on time; 60 tasks averaging complexity weight 4.0
// (weightedTotal 240); 10 complex tasks of which 7 qualify as AI tasks.
const result = computeScorecard({
  features: 40,
  bugsResolvedWeighted: 0,
  weightedBugs: 10,
  mttrMinutesSamples: [75],
  sprintNotDelayed: 18,
  sprintTotal: 20,
  complexWeightedTotal: 240,
  complexTotalTasks: 60,
  aiTaskCount: 7,
  totalComplex: 10,
  // Match the example (Effort 400h, churn 1/20). Both are weight 0 so they
  // don't change final_score, but we exercise the formulas.
  churn: { repeatedPrCount: 1, totalPrCount: 20 },
  effort: { devHours: 400, meetingHours: 0 },
});

approx(result.bugQualityPoints!, 4.0);
approx(result.mttrPoints!, 5);
approx(result.sprintCommitmentPoints!, 4);
// Complex Tasks now = 5 × (1 − e^(−output/K)); output 240, K 150 → ≈ 3.9905.
approx(result.complexTasksPoints!, 3.9905, 1e-3);
approx(result.underestimatedTasksPoints!, 3);
// final = (0.30×4 + 0.15×5 + 0.25×4 + 0.30×3.9905) × 20 ≈ 82.94 (0–100 scale).
approx(result.finalScore, 82.943, 0.05);

// Code Churn 1/20 = 5% → 4 points (weight 0). Effort 400/464×5 ≈ 4.31 (weight 0).
const churn = result.breakdown.metrics.find((m) => m.key === "codeChurn")!;
const effort = result.breakdown.metrics.find((m) => m.key === "effort")!;
approx(churn.points!, 4);
approx(effort.points!, 4.31, 1e-2);
assert.equal(churn.contribution, 0);
assert.equal(effort.contribution, 0);

// No-data defaults (§6.1).
const empty = computeScorecard({
  features: 0,
  bugsResolvedWeighted: 0,
  weightedBugs: 0,
  mttrMinutesSamples: [],
  sprintNotDelayed: 0,
  sprintTotal: 0,
  complexWeightedTotal: 0,
  complexTotalTasks: 0,
  aiTaskCount: 0,
  totalComplex: 0,
  churn: null,
  effort: null,
});
assert.equal(empty.bugQualityPoints, 5); // no data → full
assert.equal(empty.mttrPoints, 5); // no samples → full
assert.equal(empty.sprintCommitmentPoints, null); // empty
assert.equal(empty.complexTasksPoints, 0);
assert.equal(empty.underestimatedTasksPoints, 0);
// final = (0.30×5 + 0.15×5) × 20 = 45 (bug quality + MTTR default to full).
approx(empty.finalScore, 45);
assert.equal(
  empty.breakdown.metrics.find((m) => m.key === "codeChurn")!.available,
  false
);

console.log("✓ scorecard engine matches the reference worked example");
console.log(`  worked example final_score = ${result.finalScore.toFixed(4)}`);

// Unit tests for the Details drill-down's employee-specific rating calcs —
// the "Bug Quality 1.26 + MTTR 0.75 + ... = 78.5" strings shown in the
// metrics table's Detail column for Complex. (M)/(E) and Complex. NSA. (M)/(E).
// Run: ./node_modules/.bin/tsx --test "src/app/(app)/performance-review/rating-calc.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeContributions, ratingCalc, ratingCalcExpected } from "./rating-calc";
import type { MetricBreakdown } from "@/lib/scorecard/engine";

function metric(overrides: Partial<MetricBreakdown> & Pick<MetricBreakdown, "key">): MetricBreakdown {
  return {
    key: overrides.key,
    label: overrides.label ?? overrides.key,
    weight: overrides.weight ?? 0.3,
    points: overrides.points ?? 4,
    contribution: overrides.contribution ?? 24,
    raw: overrides.raw ?? "",
    available: overrides.available ?? true,
  };
}

const METRICS: MetricBreakdown[] = [
  metric({ key: "bugQuality", label: "Bug Quality", weight: 0.3, contribution: 28.62 }),
  metric({ key: "codeChurn", label: "Code Churn", weight: 0, available: false, contribution: 0 }),
  metric({ key: "mttr", label: "MTTR", weight: 0.15, contribution: 15 }),
  metric({ key: "sprintCommitment", label: "Sprint Commitment", weight: 0.25, contribution: 25 }),
  metric({ key: "complexTasks", label: "Complex Tasks", weight: 0.3, contribution: 24.63 }),
  metric({ key: "aiTasks", label: "AI Tasks", weight: 0, available: false, contribution: 0 }),
  metric({ key: "effort", label: "Effort", weight: 0, available: false, contribution: 0 }),
];

// --- activeContributions -----------------------------------------------------

test("activeContributions drops weight-0/unavailable metrics (Code Churn, AI Tasks, Effort)", () => {
  const active = activeContributions(METRICS);
  assert.deepEqual(
    active.map((m) => m.key),
    ["bugQuality", "mttr", "sprintCommitment", "complexTasks"],
  );
});

test("activeContributions keeps a weight-0 metric out even if marked available", () => {
  const metrics = [metric({ key: "codeChurn", label: "Code Churn", weight: 0, available: true, contribution: 0 })];
  assert.deepEqual(activeContributions(metrics), []);
});

// --- ratingCalc (Marked) ------------------------------------------------------

test("ratingCalc joins every active metric's own contribution and appends the total", () => {
  assert.equal(
    ratingCalc(METRICS, 93.24340017803982),
    "Bug Quality 28.62 + MTTR 15.00 + Sprint Commitment 25.00 + Complex Tasks 24.63 = 93.2",
  );
});

test("ratingCalc with no active metrics still renders (empty join) + the total", () => {
  const allUnavailable = METRICS.map((m) => ({ ...m, available: false }));
  assert.equal(ratingCalc(allUnavailable, 45), " = 45.0");
});

// --- ratingCalcExpected (derived by subtraction) ------------------------------

test("ratingCalcExpected keeps Bug Quality/MTTR/Sprint unchanged and derives Complex Tasks from the total", () => {
  // Same Bug Quality/MTTR/Sprint as METRICS (28.62+15+25=68.62); a different
  // expected total (85.31) implies Complex Tasks = 85.31 - 68.62 = 16.69.
  assert.equal(
    ratingCalcExpected(METRICS, 85.31),
    "Bug Quality 28.62 + MTTR 15.00 + Sprint Commitment 25.00 + Complex Tasks 16.69 = 85.3",
  );
});

test("ratingCalcExpected reproduces the exact Marked contribution when the two totals are equal — a real case (dashneish@salescode.ai FY2026-Q2, marked === LOC-predicted for every task)", () => {
  const total = METRICS.filter((m) => m.available && m.weight > 0).reduce((s, m) => s + m.contribution, 0);
  assert.equal(
    ratingCalcExpected(METRICS, total),
    ratingCalc(METRICS, total),
  );
});

test("ratingCalcExpected: Complex Tasks contribution can come out negative if the expected total is well below the others — surfaces the math rather than hiding it", () => {
  assert.equal(
    ratingCalcExpected(METRICS, 50),
    "Bug Quality 28.62 + MTTR 15.00 + Sprint Commitment 25.00 + Complex Tasks -18.62 = 50.0",
  );
});

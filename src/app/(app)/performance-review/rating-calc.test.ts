// Unit tests for the Details drill-down's employee-specific rating calcs —
// the "59 task(s), 254 complexity-pts -> 4.11 points x 0.30 x 20 = 24.63 / 30"
// strings shown in the metrics table's Detail column for Complex. (M)/(E) and
// Complex. NSA. (M)/(E).
// Run: ./node_modules/.bin/tsx --test "src/app/(app)/performance-review/rating-calc.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { complexTasksCalc, findComplexTasksMetric } from "./rating-calc";
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

// --- findComplexTasksMetric ---------------------------------------------------

test("finds the complexTasks entry among several metrics", () => {
  const metrics = [
    metric({ key: "bugQuality", label: "Bug Quality" }),
    metric({ key: "complexTasks", label: "Complex Tasks", raw: "12 task(s), 45 complexity-pts" }),
    metric({ key: "mttr", label: "MTTR" }),
  ];
  const found = findComplexTasksMetric(metrics);
  assert.equal(found?.raw, "12 task(s), 45 complexity-pts");
});

test("undefined array (a not-yet-recomputed row) returns undefined, not a throw", () => {
  assert.equal(findComplexTasksMetric(undefined), undefined);
});

test("an array with no complexTasks entry returns undefined", () => {
  assert.equal(findComplexTasksMetric([metric({ key: "bugQuality" })]), undefined);
});

// --- complexTasksCalc ---------------------------------------------------------

test("renders raw input, derived points, the weight/scale multiplication, and the /30 max", () => {
  const m = metric({
    key: "complexTasks",
    raw: "59 task(s), 254 complexity-pts",
    weight: 0.3,
    contribution: 24.63,
  });
  assert.equal(
    complexTasksCalc(m),
    "59 task(s), 254 complexity-pts → 4.10 points × 0.30 × 20 = 24.63 / 30",
  );
});

test("points is derived from contribution, not read from the metric's own .points field", () => {
  // .points deliberately disagrees with what contribution implies, so the
  // test fails if complexTasksCalc ever reads .points instead of deriving it.
  const m = metric({ key: "complexTasks", raw: "5 task(s), 25 complexity-pts", weight: 0.3, contribution: 6, points: 999 });
  assert.equal(complexTasksCalc(m), "5 task(s), 25 complexity-pts → 1.00 points × 0.30 × 20 = 6.00 / 30");
});

test("zero contribution (no complex tasks at all) renders 0.00 points, not NaN or a crash", () => {
  const m = metric({ key: "complexTasks", raw: "No tasks", weight: 0.3, contribution: 0 });
  assert.equal(complexTasksCalc(m), "No tasks → 0.00 points × 0.30 × 20 = 0.00 / 30");
});

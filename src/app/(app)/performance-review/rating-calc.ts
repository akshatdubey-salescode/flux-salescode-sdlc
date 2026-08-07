// Pure formatters for the Details drill-down's employee-specific rating
// calcs — extracted from page.tsx so the arithmetic can be unit-tested
// without a DOM/React runtime.
//
// Each of the four Complex./Complex. NSA. ratings is ONLY the Complex Tasks
// metric's own contribution (0-30), not a sum across Bug Quality/MTTR/Sprint
// Commitment — see build.ts file header for why. So there's nothing to sum
// here; the calc is just that one metric's own raw input -> points ->
// contribution chain.

import type { MetricBreakdown } from "@/lib/scorecard/engine";
import { WEIGHTS, SCORE_SCALE } from "@/lib/scorecard/config";

/** Pulls the Complex Tasks entry out of a metrics array — undefined when the
 * array itself is undefined (a row computed before that population's
 * breakdown was persisted; see ScorecardBreakdown's own comments). */
export function findComplexTasksMetric(
  metrics: MetricBreakdown[] | undefined,
): MetricBreakdown | undefined {
  return metrics?.find((m) => m.key === "complexTasks");
}

/**
 * "59 task(s), 254 complexity-pts → 4.11 points × 0.30 × 20 = 24.63 / 30" —
 * the employee-specific calc behind one of the four Complex./Complex. NSA.
 * columns. Takes the Complex Tasks MetricBreakdown from whichever
 * population/complexity-source array applies (detail.breakdown.metrics,
 * .expectedAllMetrics, .nsaMetrics, or .nsaExpectedMetrics).
 */
export function complexTasksCalc(metric: MetricBreakdown): string {
  const denom = WEIGHTS.complexTasks * SCORE_SCALE;
  const points = denom > 0 ? metric.contribution / denom : 0;
  const max = WEIGHTS.complexTasks * 5 * SCORE_SCALE;
  return (
    `${metric.raw} → ${points.toFixed(2)} points × ${WEIGHTS.complexTasks.toFixed(2)} × ` +
    `${SCORE_SCALE} = ${metric.contribution.toFixed(2)} / ${max.toFixed(0)}`
  );
}

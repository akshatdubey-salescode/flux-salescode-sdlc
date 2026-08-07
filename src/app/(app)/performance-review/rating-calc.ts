// Pure formatters for the Details drill-down's employee-specific rating
// calcs — extracted from page.tsx so the arithmetic (especially the
// subtraction-derived Expected variant) can be unit-tested without a DOM/
// React runtime.

import type { MetricBreakdown } from "@/lib/scorecard/engine";

/** The metrics that actually feed a rating's total — Code Churn/AI Tasks/
 * Effort carry weight 0 and are never tracked on this platform, so they never
 * appear in a rating's calc breakdown. */
export function activeContributions(metrics: MetricBreakdown[]): MetricBreakdown[] {
  return metrics.filter((m) => m.available && m.weight > 0);
}

/**
 * "Bug Quality 1.26 + MTTR 0.75 + Sprint Commitment 1.00 + Complex Tasks 0.68
 * = 78.5" — the employee-specific calc behind a Marked rating (Complex. (M)
 * or Complex. NSA. (M)), built straight from that population's own
 * per-metric contributions.
 */
export function ratingCalc(metrics: MetricBreakdown[], total: number): string {
  const parts = activeContributions(metrics).map(
    (m) => `${m.label} ${m.contribution.toFixed(2)}`,
  );
  return `${parts.join(" + ")} = ${total.toFixed(1)}`;
}

/**
 * Same as ratingCalc, but for an Expected rating (Complex. (E) or Complex.
 * NSA. (E)). Bug Quality/MTTR/Sprint Commitment are identical to the Marked
 * rating within the same population (only Complex Tasks differs — see
 * build.ts file header), so Complex Tasks' own contribution is derived by
 * subtraction from the known total rather than needing its own persisted
 * breakdown.
 */
export function ratingCalcExpected(metrics: MetricBreakdown[], expectedTotal: number): string {
  const active = activeContributions(metrics);
  const others = active.filter((m) => m.key !== "complexTasks");
  const othersSum = others.reduce((s, m) => s + m.contribution, 0);
  const complexTasksExpected = expectedTotal - othersSum;
  const parts = [
    ...others.map((m) => `${m.label} ${m.contribution.toFixed(2)}`),
    `Complex Tasks ${complexTasksExpected.toFixed(2)}`,
  ];
  return `${parts.join(" + ")} = ${expectedTotal.toFixed(1)}`;
}

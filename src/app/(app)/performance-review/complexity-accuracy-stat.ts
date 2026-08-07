// Pure formatter for a Complexity Accuracy reading (correct/checked, either
// the all-Jiras or the non-self-assigned one) — extracted from page.tsx's
// ComplexityAccuracyStat so the dash-vs-percentage decision is unit-testable
// without a DOM/React runtime. checked=0 means nothing to check yet: either
// no tasks at all this quarter, or — for the NSA reading specifically —
// every task was self-assigned.

export function formatComplexityAccuracy(correct: number, checked: number): string {
  if (checked === 0) return "— (run Sync LOC)";
  const pct = (correct / checked) * 100;
  return `${correct}/${checked} (${pct.toFixed(0)}%)`;
}

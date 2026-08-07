// Pure filter for the Feature Tasks table's "Non-self-assigned only" toggle —
// extracted from feature-tasks-table.tsx so the off-by-default, additive-only
// behavior can be unit-tested without a DOM/React runtime. Off (default)
// returns items unchanged — the exact list the table has always shown.

import type { ScorecardFeatureItem } from "./data";

export function filterFeatureTasks(
  items: ScorecardFeatureItem[],
  nonSelfAssignedOnly: boolean
): ScorecardFeatureItem[] {
  return nonSelfAssignedOnly ? items.filter((t) => !t.selfAssigned) : items;
}

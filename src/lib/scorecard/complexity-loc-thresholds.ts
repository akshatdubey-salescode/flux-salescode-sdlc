// Hardcoded complexity (1-5) <-> expected-LOC ranges, kept in their own file so
// a manager/reviewer can retune the numbers without touching engine.ts or
// build.ts. LOC here means additions + deletions summed across every PR
// matched to a Jira for its scoring quarter (see loc-sync.ts) — a proxy for
// how much code a task actually took to ship, used only to flag suspiciously
// small C4/C5 tasks for manual review, never to auto-downgrade a score.

export type ComplexityLocRange = {
  complexity: number;
  /** Inclusive floor. A task below this for its claimed complexity is suspect. */
  minLoc: number;
};

// Deliberately generous floors — the goal is to catch clear outliers (a C5
// task with a handful of lines changed), not to second-guess every borderline
// case. Genuinely complex-but-low-LOC work (config, algorithmic, cross-service
// wiring) is real and should stay a judgement call for the reviewer, not an
// auto-penalty — see MISMATCH_SUGGESTIONS below.
export const COMPLEXITY_LOC_RANGES: ComplexityLocRange[] = [
  { complexity: 1, minLoc: 0 },
  { complexity: 2, minLoc: 15 },
  { complexity: 3, minLoc: 40 },
  { complexity: 4, minLoc: 100 },
  { complexity: 5, minLoc: 250 },
];

/** Only complexities at/above this are worth flagging (per the manager's ask). */
export const FLAGGABLE_COMPLEXITY_THRESHOLD = 4;

export const MISMATCH_SUGGESTIONS: Record<number, string> = {
  4: "Marked Complexity 4 but the LOC is well below what C4 work usually takes — worth a quick look to confirm the complexity rating, not the score, is accurate.",
  5: "Marked Complexity 5 but the LOC is well below what C5 work usually takes — verify before treating this as a top-complexity task. Genuinely complex, low-LOC changes (e.g. config or cross-service wiring) can be legitimate, so use judgement rather than auto-downgrading.",
};

function floorFor(complexity: number): number | null {
  const row = COMPLEXITY_LOC_RANGES.find((r) => r.complexity === complexity);
  return row ? row.minLoc : null;
}

/** The highest complexity level whose floor the given LOC clears. 1 for loc=0. */
export function expectedComplexityForLoc(loc: number): number {
  let expected = COMPLEXITY_LOC_RANGES[0].complexity;
  for (const r of COMPLEXITY_LOC_RANGES) {
    if (loc >= r.minLoc) expected = r.complexity;
  }
  return expected;
}

/**
 * Whether a task's marked complexity matches what its LOC would predict —
 * the basis for the "Complexity Accuracy" rating (correct / checked, shown as
 * a %). Null (not "checked") when either input is missing — a task with no
 * matched PR contributes to neither the numerator nor the denominator.
 */
export function isComplexityCorrect(
  complexity: number | null,
  loc: number | null
): boolean | null {
  if (complexity == null || loc == null) return null;
  const capped = Math.min(5, Math.max(1, Math.round(complexity)));
  return capped === expectedComplexityForLoc(loc);
}

/**
 * True when a C4/C5 task's total LOC falls below that complexity's expected
 * floor. Complexities below FLAGGABLE_COMPLEXITY_THRESHOLD are never flagged —
 * only high-complexity, suspiciously-small tasks matter here. `loc` is null
 * when no PR has been matched to the Jira yet (nothing to compare, no flag).
 */
export function isComplexityLocMismatch(
  complexity: number | null,
  loc: number | null
): boolean {
  if (complexity == null || loc == null) return false;
  const capped = Math.min(5, Math.max(1, Math.round(complexity)));
  if (capped < FLAGGABLE_COMPLEXITY_THRESHOLD) return false;
  const floor = floorFor(capped);
  return floor != null && loc < floor;
}

/** Suggestion text for a flagged complexity, or null when not flaggable. */
export function mismatchSuggestion(complexity: number | null): string | null {
  if (complexity == null) return null;
  const capped = Math.min(5, Math.max(1, Math.round(complexity)));
  return MISMATCH_SUGGESTIONS[capped] ?? null;
}

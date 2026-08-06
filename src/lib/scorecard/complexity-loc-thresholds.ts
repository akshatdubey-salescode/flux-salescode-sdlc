// Complexity (1-5) <-> expected-LOC ranges — a DATABASE config
// (feature_flags.complexityLocRanges), not a hardcoded constant, so a
// manager/reviewer can retune the numbers without a deploy. Fetched fresh on
// every scoring run (see getComplexityLocRanges) — never cached, so an edit
// takes effect on the very next Recompute/Sync LOC, not after some cache TTL
// lapses. LOC here means additions + deletions summed across every PR
// matched to a Jira for its scoring quarter (see loc-sync.ts) — a proxy for
// how much code a task actually took to ship, used only to flag suspiciously
// small C4/C5 tasks for manual review, never to auto-downgrade a score. A
// Jira with no matched PR at all (loc: null) is treated as 0 LOC throughout
// this file — no observed code change predicts the lowest complexity, C1.

import { FEATURE_FLAGS, getFlagUncached } from "@/lib/feature-flags";
import defaultFlags from "@/lib/defaultFeatureFlags.json";

export type ComplexityLocRange = {
  complexity: number;
  /** Inclusive floor. A task below this for its claimed complexity is suspect. */
  minLoc: number;
};

// Fallback only — used when the DB flag is missing or malformed, never as a
// silent substitute for a real fetch. The single source of truth for the
// *default* value is defaultFeatureFlags.json; the live value always comes
// from getComplexityLocRanges().
//
// Deliberately generous floors — the goal is to catch clear outliers (a C5
// task with a handful of lines changed), not to second-guess every borderline
// case. Genuinely complex-but-low-LOC work (config, algorithmic, cross-service
// wiring) is real and should stay a judgement call for the reviewer, not an
// auto-penalty — see MISMATCH_SUGGESTIONS below.
export const DEFAULT_COMPLEXITY_LOC_RANGES: ComplexityLocRange[] =
  defaultFlags.complexityLocRanges;

/** Only complexities at/above this are worth flagging (per the manager's ask). */
export const FLAGGABLE_COMPLEXITY_THRESHOLD = 4;

export const MISMATCH_SUGGESTIONS: Record<number, string> = {
  4: "Marked Complexity 4 but the LOC is well below what C4 work usually takes — worth a quick look to confirm the complexity rating, not the score, is accurate.",
  5: "Marked Complexity 5 but the LOC is well below what C5 work usually takes — verify before treating this as a top-complexity task. Genuinely complex, low-LOC changes (e.g. config or cross-service wiring) can be legitimate, so use judgement rather than auto-downgrading.",
};

/**
 * Validates an arbitrary value (whatever's actually stored in the DB — a
 * superuser can type anything into the feature-flags editor) as a usable
 * ranges array. Returns null on anything malformed so the caller can fall
 * back rather than crash the scoring run over a typo.
 */
export function parseComplexityLocRanges(raw: unknown): ComplexityLocRange[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ranges: ComplexityLocRange[] = [];
  for (const entry of raw) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { complexity?: unknown }).complexity !== "number" ||
      typeof (entry as { minLoc?: unknown }).minLoc !== "number" ||
      !Number.isFinite((entry as { complexity: number }).complexity) ||
      !Number.isFinite((entry as { minLoc: number }).minLoc)
    ) {
      return null;
    }
    ranges.push({
      complexity: (entry as { complexity: number }).complexity,
      minLoc: (entry as { minLoc: number }).minLoc,
    });
  }
  return ranges;
}

/**
 * The live complexity↔LOC ranges — fetched straight from feature_flags on
 * every call via getFlagUncached (no cache layer at all), so a superuser
 * editing the flag takes effect on the very next scoring run. Falls back to
 * DEFAULT_COMPLEXITY_LOC_RANGES if the flag is absent or its stored value
 * doesn't parse as a valid ranges array.
 */
export async function getComplexityLocRanges(): Promise<ComplexityLocRange[]> {
  const raw = await getFlagUncached(FEATURE_FLAGS.COMPLEXITY_LOC_RANGES);
  return parseComplexityLocRanges(raw) ?? DEFAULT_COMPLEXITY_LOC_RANGES;
}

function floorFor(complexity: number, ranges: ComplexityLocRange[]): number | null {
  const row = ranges.find((r) => r.complexity === complexity);
  return row ? row.minLoc : null;
}

/**
 * The highest complexity level whose floor the given LOC clears. `loc: null`
 * (no PR matched to the Jira at all) is treated the same as loc=0 — no
 * observed code changes predicts the lowest complexity, C1 — consistent with
 * how a missing/unset marked complexity already defaults to C1 elsewhere
 * (COMPLEXITY_WEIGHTS / DEFAULT_COMPLEXITY_WEIGHT in config.ts). `ranges` is
 * a required parameter, not an internal default — callers fetch it fresh via
 * getComplexityLocRanges() and thread it through, so it's never silently
 * stale nor silently hardcoded.
 */
export function expectedComplexityForLoc(
  loc: number | null,
  ranges: ComplexityLocRange[]
): number {
  const effectiveLoc = loc ?? 0;
  let expected = ranges[0].complexity;
  for (const r of ranges) {
    if (effectiveLoc >= r.minLoc) expected = r.complexity;
  }
  return expected;
}

/**
 * Whether a task's marked complexity matches what its LOC would predict —
 * the basis for the "Complexity Accuracy" rating (correct / checked, shown as
 * a %). Never excludes a task: an unset marked complexity defaults to C1 (the
 * same convention complexityWeight() already uses in build.ts), and a task
 * with no matched PR predicts C1 too (see expectedComplexityForLoc) — so
 * every complexity-bearing task is "checked" against something, none dropped.
 */
export function isComplexityCorrect(
  complexity: number | null,
  loc: number | null,
  ranges: ComplexityLocRange[]
): boolean {
  const capped = Math.min(5, Math.max(1, Math.round(complexity ?? 1)));
  return capped === expectedComplexityForLoc(loc, ranges);
}

/**
 * True when a C4/C5 task's total LOC falls below that complexity's expected
 * floor. Complexities below FLAGGABLE_COMPLEXITY_THRESHOLD are never flagged —
 * only high-complexity, suspiciously-small tasks matter here. `loc: null` (no
 * PR matched at all) is treated as 0 — the most extreme case of "claimed
 * complex, no evidence of it" — so it flags too, not just a low-but-nonzero
 * matched LOC.
 */
export function isComplexityLocMismatch(
  complexity: number | null,
  loc: number | null,
  ranges: ComplexityLocRange[]
): boolean {
  if (complexity == null) return false;
  const capped = Math.min(5, Math.max(1, Math.round(complexity)));
  if (capped < FLAGGABLE_COMPLEXITY_THRESHOLD) return false;
  const floor = floorFor(capped, ranges);
  return floor != null && (loc ?? 0) < floor;
}

/** Suggestion text for a flagged complexity, or null when not flaggable. */
export function mismatchSuggestion(complexity: number | null): string | null {
  if (complexity == null) return null;
  const capped = Math.min(5, Math.max(1, Math.round(complexity)));
  return MISMATCH_SUGGESTIONS[capped] ?? null;
}

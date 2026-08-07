// Unit tests for the complexity <-> LOC threshold logic that drives the
// Complexity Rating (E) score, the Complexity Accuracy tally, and the
// C4/C5 mismatch flag. The ranges themselves live in feature_flags (fetched
// fresh, never cached, via getComplexityLocRanges) — these tests exercise
// the pure logic with an explicit fixture array, not the DB fetch itself.
// Run: ./node_modules/.bin/tsx --test src/lib/scorecard/complexity-loc-thresholds.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COMPLEXITY_LOC_RANGES,
  FLAGGABLE_COMPLEXITY_THRESHOLD,
  expectedComplexityForLoc,
  isComplexityCorrect,
  isComplexityLocMismatch,
  mismatchSuggestion,
  parseComplexityLocRanges,
} from "./complexity-loc-thresholds";

// Fixture mirroring the shipped default, used explicitly rather than relying
// on any implicit fallback — every call below states which ranges it's using.
const RANGES = DEFAULT_COMPLEXITY_LOC_RANGES;

// --- expectedComplexityForLoc: floor boundaries -----------------------------

test("loc=0 predicts C1", () => {
  assert.equal(expectedComplexityForLoc(0, RANGES), 1);
});

test("loc=null (no matched PR) is treated as 0 → predicts C1", () => {
  assert.equal(expectedComplexityForLoc(null, RANGES), 1);
});

test("one below the C2 floor still predicts C1", () => {
  assert.equal(expectedComplexityForLoc(14, RANGES), 1);
});

test("exactly at the C2 floor predicts C2 (inclusive)", () => {
  assert.equal(expectedComplexityForLoc(15, RANGES), 2);
});

test("one below the C3 floor predicts C2", () => {
  assert.equal(expectedComplexityForLoc(39, RANGES), 2);
});

test("exactly at the C3 floor predicts C3", () => {
  assert.equal(expectedComplexityForLoc(40, RANGES), 3);
});

test("one below the C4 floor predicts C3", () => {
  assert.equal(expectedComplexityForLoc(99, RANGES), 3);
});

test("exactly at the C4 floor predicts C4", () => {
  assert.equal(expectedComplexityForLoc(100, RANGES), 4);
});

test("one below the C5 floor predicts C4", () => {
  assert.equal(expectedComplexityForLoc(249, RANGES), 4);
});

test("exactly at the C5 floor predicts C5", () => {
  assert.equal(expectedComplexityForLoc(250, RANGES), 5);
});

test("well above the C5 floor still predicts C5 (no higher tier)", () => {
  assert.equal(expectedComplexityForLoc(50_000, RANGES), 5);
});

test("every configured range's floor round-trips to its own complexity", () => {
  for (const r of RANGES) {
    assert.equal(
      expectedComplexityForLoc(r.minLoc, RANGES),
      r.complexity,
      `floor ${r.minLoc} should predict C${r.complexity}`
    );
  }
});

test("a custom (non-default) ranges array is honored, not the shipped default", () => {
  const custom = [
    { complexity: 1, minLoc: 0 },
    { complexity: 5, minLoc: 10 },
  ];
  // Only 10 loc, but with this custom config anything >= 10 predicts C5.
  assert.equal(expectedComplexityForLoc(10, custom), 5);
  assert.equal(expectedComplexityForLoc(9, custom), 1);
});

// --- isComplexityCorrect -----------------------------------------------------

test("marked matches expected → correct", () => {
  assert.equal(isComplexityCorrect(3, 50, RANGES), true); // 50 loc predicts C3
});

test("marked disagrees with expected → incorrect", () => {
  assert.equal(isComplexityCorrect(3, 14, RANGES), false); // 14 loc predicts C1
});

test("unset marked complexity (null) defaults to C1, never excluded", () => {
  // loc=null also predicts C1 → 1 === 1 → correct, and no null/undefined path exists
  assert.equal(isComplexityCorrect(null, null, RANGES), true);
});

test("unset marked complexity vs nonzero loc predicting a higher tier → incorrect, not excluded", () => {
  assert.equal(isComplexityCorrect(null, 200, RANGES), false); // defaults marked to 1, loc predicts C4
});

test("marked complexity of 0 clamps up to C1", () => {
  assert.equal(isComplexityCorrect(0, 0, RANGES), true);
});

test("marked complexity above 5 clamps down to C5", () => {
  assert.equal(isComplexityCorrect(9, 300, RANGES), true); // clamps to 5, loc predicts C5
});

test("marked complexity rounds to nearest integer before comparing", () => {
  assert.equal(isComplexityCorrect(2.6, 50, RANGES), true); // rounds to 3, loc(50) predicts C3
  assert.equal(isComplexityCorrect(2.4, 50, RANGES), false); // rounds to 2, loc(50) predicts C3
});

test("isComplexityCorrect never returns null — always a plain boolean", () => {
  const result = isComplexityCorrect(null, null, RANGES);
  assert.equal(typeof result, "boolean");
});

// --- isComplexityLocMismatch (the narrow ⚠ flag) ----------------------------

test("unset marked complexity is never flagged", () => {
  assert.equal(isComplexityLocMismatch(null, 0, RANGES), false);
  assert.equal(isComplexityLocMismatch(null, null, RANGES), false);
});

test("complexities below the flaggable threshold are never flagged, regardless of loc", () => {
  assert.equal(isComplexityLocMismatch(1, 0, RANGES), false);
  assert.equal(isComplexityLocMismatch(2, 0, RANGES), false);
  assert.equal(isComplexityLocMismatch(3, 0, RANGES), false);
});

test("C4 below its floor is flagged", () => {
  assert.equal(isComplexityLocMismatch(4, 99, RANGES), true);
});

test("C4 at exactly its floor is not flagged (inclusive floor)", () => {
  assert.equal(isComplexityLocMismatch(4, 100, RANGES), false);
});

test("C5 below its floor is flagged", () => {
  assert.equal(isComplexityLocMismatch(5, 249, RANGES), true);
});

test("C5 at exactly its floor is not flagged", () => {
  assert.equal(isComplexityLocMismatch(5, 250, RANGES), false);
});

test("no matched PR (loc=null) on a C4/C5 task is treated as 0 LOC — flagged, not exempted", () => {
  assert.equal(isComplexityLocMismatch(4, null, RANGES), true);
  assert.equal(isComplexityLocMismatch(5, null, RANGES), true);
});

test("a C4/C5 task with ample LOC is not flagged", () => {
  assert.equal(isComplexityLocMismatch(4, 500, RANGES), false);
  assert.equal(isComplexityLocMismatch(5, 1000, RANGES), false);
});

test("FLAGGABLE_COMPLEXITY_THRESHOLD is the exact cutover point", () => {
  assert.equal(isComplexityLocMismatch(FLAGGABLE_COMPLEXITY_THRESHOLD - 1, 0, RANGES), false);
  assert.equal(isComplexityLocMismatch(FLAGGABLE_COMPLEXITY_THRESHOLD, 0, RANGES), true);
});

// --- mismatchSuggestion -------------------------------------------------------

test("no suggestion for an unset complexity", () => {
  assert.equal(mismatchSuggestion(null), null);
});

test("no suggestion below the flaggable range", () => {
  assert.equal(mismatchSuggestion(1), null);
  assert.equal(mismatchSuggestion(3), null);
});

test("C4 and C5 each have distinct, non-empty suggestion text", () => {
  const c4 = mismatchSuggestion(4);
  const c5 = mismatchSuggestion(5);
  assert.ok(c4 && c4.length > 0);
  assert.ok(c5 && c5.length > 0);
  assert.notEqual(c4, c5);
});

test("mismatchSuggestion rounds before lookup, same as isComplexityLocMismatch", () => {
  assert.equal(mismatchSuggestion(4.4), mismatchSuggestion(4));
});

// --- parseComplexityLocRanges: validating whatever's actually in the DB -----

test("a well-formed array round-trips unchanged", () => {
  const raw = [{ complexity: 1, minLoc: 0 }, { complexity: 2, minLoc: 20 }];
  assert.deepEqual(parseComplexityLocRanges(raw), raw);
});

test("not an array → invalid", () => {
  assert.equal(parseComplexityLocRanges({ complexity: 1, minLoc: 0 }), null);
  assert.equal(parseComplexityLocRanges("nonsense"), null);
  assert.equal(parseComplexityLocRanges(null), null);
  assert.equal(parseComplexityLocRanges(undefined), null);
});

test("an empty array → invalid (never usable ranges)", () => {
  assert.equal(parseComplexityLocRanges([]), null);
});

test("an entry missing complexity or minLoc → invalid", () => {
  assert.equal(parseComplexityLocRanges([{ minLoc: 0 }]), null);
  assert.equal(parseComplexityLocRanges([{ complexity: 1 }]), null);
});

test("an entry with a non-numeric field → invalid", () => {
  assert.equal(parseComplexityLocRanges([{ complexity: "1", minLoc: 0 }]), null);
  assert.equal(parseComplexityLocRanges([{ complexity: 1, minLoc: "0" }]), null);
});

test("an entry with NaN/Infinity → invalid", () => {
  assert.equal(parseComplexityLocRanges([{ complexity: 1, minLoc: Infinity }]), null);
  assert.equal(parseComplexityLocRanges([{ complexity: NaN, minLoc: 0 }]), null);
});

test("one malformed entry invalidates the whole array, not just that entry", () => {
  const raw = [{ complexity: 1, minLoc: 0 }, { complexity: 2, minLoc: "oops" }];
  assert.equal(parseComplexityLocRanges(raw), null);
});

test("the shipped default itself parses as valid", () => {
  assert.deepEqual(parseComplexityLocRanges(DEFAULT_COMPLEXITY_LOC_RANGES), DEFAULT_COMPLEXITY_LOC_RANGES);
});

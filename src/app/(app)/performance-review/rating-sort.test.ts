// Unit tests for ratingValueForSortKey — the leaderboard's mapping from a
// sort key to the rating field it reads. "score" is the 0-100 composite;
// "m"/"e"/"nsaM"/"nsaE" are each a dedicated 0-30 Complex Tasks-only field —
// see build.ts file header.
// Run: ./node_modules/.bin/tsx --test "src/app/(app)/performance-review/rating-sort.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { ratingValueForSortKey } from "./rating-sort";
import { WEIGHTS, SCORE_SCALE } from "@/lib/scorecard/config";

const row = {
  finalScore: 78.5,
  markedComplexityScoreAll: 24.63,
  expectedComplexityScoreAll: 21.0,
  markedComplexityScore: 16.7,
  expectedComplexityScore: 15.9,
  scoreNsaExpected: 71.2,
  bugQualityPoints: 4.2,
  sprintCommitmentPoints: 3.8,
  complexTasksPoints: 4.5,
  mttrPoints: null,
};

test("score reads finalScore (the 0-100 composite)", () => {
  assert.equal(ratingValueForSortKey(row, "score"), 78.5);
});

test("m reads markedComplexityScoreAll", () => {
  assert.equal(ratingValueForSortKey(row, "m"), 24.63);
});

test("e reads expectedComplexityScoreAll", () => {
  assert.equal(ratingValueForSortKey(row, "e"), 21.0);
});

test("nsaM reads markedComplexityScore", () => {
  assert.equal(ratingValueForSortKey(row, "nsaM"), 16.7);
});

test("nsaE reads expectedComplexityScore", () => {
  assert.equal(ratingValueForSortKey(row, "nsaE"), 15.9);
});

test("scoreNsaE reads scoreNsaExpected (a full 0-100 composite, not the 0-30 nsaE field)", () => {
  assert.equal(ratingValueForSortKey(row, "scoreNsaE"), 71.2);
});

test("score and m are on unrelated scales — neither is derived from the other", () => {
  assert.notEqual(ratingValueForSortKey(row, "score"), ratingValueForSortKey(row, "m"));
});

test("score and scoreNsaE are both 0-100 composites but read independent fields", () => {
  assert.notEqual(ratingValueForSortKey(row, "score"), ratingValueForSortKey(row, "scoreNsaE"));
});

test("m and nsaM diverge whenever self-assigned Jiras exist", () => {
  const withSelfAssigned = {
    finalScore: 100,
    markedComplexityScoreAll: 28,
    expectedComplexityScoreAll: 26,
    markedComplexityScore: 14,
    expectedComplexityScore: 12,
    scoreNsaExpected: 82,
    bugQualityPoints: null,
    sprintCommitmentPoints: null,
    complexTasksPoints: null,
    mttrPoints: null,
  };
  assert.notEqual(
    ratingValueForSortKey(withSelfAssigned, "m"),
    ratingValueForSortKey(withSelfAssigned, "nsaM"),
  );
  assert.notEqual(
    ratingValueForSortKey(withSelfAssigned, "e"),
    ratingValueForSortKey(withSelfAssigned, "nsaE"),
  );
});

// --- bugQuality/sprintCommitment/complexTasks/mttr: points × weight × scale,
// matching the Contribution cell's own formula, not raw 0-5 points ----------

test("bugQuality reads points × its weight × SCORE_SCALE", () => {
  assert.equal(
    ratingValueForSortKey(row, "bugQuality"),
    row.bugQualityPoints * WEIGHTS.bugQuality * SCORE_SCALE,
  );
});

test("sprintCommitment reads points × its weight × SCORE_SCALE", () => {
  assert.equal(
    ratingValueForSortKey(row, "sprintCommitment"),
    row.sprintCommitmentPoints * WEIGHTS.sprintCommitment * SCORE_SCALE,
  );
});

test("complexTasks reads points × its weight × SCORE_SCALE", () => {
  assert.equal(
    ratingValueForSortKey(row, "complexTasks"),
    row.complexTasksPoints * WEIGHTS.complexTasks * SCORE_SCALE,
  );
});

test("mttr with null points (unavailable) sorts as -1, below every real contribution", () => {
  assert.equal(ratingValueForSortKey(row, "mttr"), -1);
});

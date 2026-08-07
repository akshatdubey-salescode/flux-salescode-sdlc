// Unit tests for ratingValueForSortKey — the leaderboard's mapping from a
// sort key to the rating field it reads. Covers the 2x2 Jira Complexity
// Rating grid added alongside Score.
// Run: ./node_modules/.bin/tsx --test "src/app/(app)/performance-review/rating-sort.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { ratingValueForSortKey } from "./rating-sort";

const row = {
  finalScore: 78.5,
  expectedComplexityScoreAll: 71.0,
  markedComplexityScore: 45,
  expectedComplexityScore: 45,
};

test("score reads finalScore", () => {
  assert.equal(ratingValueForSortKey(row, "score"), 78.5);
});

test("m reads finalScore too — same population and formula as Score", () => {
  assert.equal(ratingValueForSortKey(row, "m"), row.finalScore);
});

test("e reads expectedComplexityScoreAll", () => {
  assert.equal(ratingValueForSortKey(row, "e"), 71.0);
});

test("nsaM reads markedComplexityScore", () => {
  assert.equal(ratingValueForSortKey(row, "nsaM"), 45);
});

test("nsaE reads expectedComplexityScore", () => {
  assert.equal(ratingValueForSortKey(row, "nsaE"), 45);
});

test("score and m diverge from the NSA readings whenever self-assigned Jiras exist", () => {
  const withSelfAssigned = {
    finalScore: 100,
    expectedComplexityScoreAll: 90,
    markedComplexityScore: 40,
    expectedComplexityScore: 35,
  };
  assert.notEqual(
    ratingValueForSortKey(withSelfAssigned, "score"),
    ratingValueForSortKey(withSelfAssigned, "nsaM"),
  );
  assert.notEqual(
    ratingValueForSortKey(withSelfAssigned, "e"),
    ratingValueForSortKey(withSelfAssigned, "nsaE"),
  );
});

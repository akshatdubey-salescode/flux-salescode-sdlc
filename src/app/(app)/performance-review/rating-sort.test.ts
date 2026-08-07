// Unit tests for ratingValueForSortKey — the leaderboard's mapping from a
// sort key to the rating field it reads. "score" is the 0-100 composite;
// "m"/"e"/"nsaM"/"nsaE" are each a dedicated 0-30 Complex Tasks-only field —
// see build.ts file header.
// Run: ./node_modules/.bin/tsx --test "src/app/(app)/performance-review/rating-sort.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { ratingValueForSortKey } from "./rating-sort";

const row = {
  finalScore: 78.5,
  markedComplexityScoreAll: 24.63,
  expectedComplexityScoreAll: 21.0,
  markedComplexityScore: 16.7,
  expectedComplexityScore: 15.9,
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

test("score and m are on unrelated scales — neither is derived from the other", () => {
  assert.notEqual(ratingValueForSortKey(row, "score"), ratingValueForSortKey(row, "m"));
});

test("m and nsaM diverge whenever self-assigned Jiras exist", () => {
  const withSelfAssigned = {
    finalScore: 100,
    markedComplexityScoreAll: 28,
    expectedComplexityScoreAll: 26,
    markedComplexityScore: 14,
    expectedComplexityScore: 12,
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

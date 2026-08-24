// Unit tests for formatComplexityAccuracy — the Details drill-down's two
// Complexity Accuracy readings (all-Jiras, non-self-assigned).
// Run: ./node_modules/.bin/tsx --test "src/app/(app)/performance-review/complexity-accuracy-stat.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatComplexityAccuracy } from "./complexity-accuracy-stat";

test("checked=0 renders the dash, regardless of correct", () => {
  assert.equal(formatComplexityAccuracy(0, 0), "— (run Sync LOC)");
});

test("all correct renders 100%", () => {
  assert.equal(formatComplexityAccuracy(5, 5), "5/5 (100%)");
});

test("none correct renders 0% — the Satvik Chaudhary case (all-Jiras reading)", () => {
  assert.equal(formatComplexityAccuracy(0, 5), "0/5 (0%)");
});

test("a partial ratio rounds to the nearest whole percent", () => {
  assert.equal(formatComplexityAccuracy(1, 3), "1/3 (33%)");
  assert.equal(formatComplexityAccuracy(2, 3), "2/3 (67%)");
});

test("correct and checked are shown as plain integers, not recomputed", () => {
  assert.equal(formatComplexityAccuracy(9, 30), "9/30 (30%)");
});

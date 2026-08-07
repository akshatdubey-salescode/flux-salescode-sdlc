// Unit tests for isSelfAssigned (the gate that excludes self-created-and-
// assigned Jiras from every metric) and buildComplexityBuckets (the
// distribution-table bucketing shared by the marked and expected complexity
// distributions). The rest of build.ts is DB-driven (buildScorecards itself)
// and isn't unit-tested here; these are the pure functions it exports.
// Run: ./node_modules/.bin/tsx --test src/lib/scorecard/build.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSelfAssigned, buildComplexityBuckets } from "./build";

test("reporter same as credited person → self-assigned", () => {
  assert.equal(isSelfAssigned("dev@salescode.ai", "dev@salescode.ai"), true);
});

test("reporter different from credited person → not self-assigned", () => {
  assert.equal(isSelfAssigned("manager@salescode.ai", "dev@salescode.ai"), false);
});

test("comparison is case-insensitive", () => {
  assert.equal(isSelfAssigned("Dev@SalesCode.AI", "dev@salescode.ai"), true);
});

test("comparison tolerates surrounding whitespace on the reporter email", () => {
  assert.equal(isSelfAssigned("  dev@salescode.ai  ", "dev@salescode.ai"), true);
});

test("null reporter → not self-assigned", () => {
  assert.equal(isSelfAssigned(null, "dev@salescode.ai"), false);
});

test("undefined reporter → not self-assigned", () => {
  assert.equal(isSelfAssigned(undefined, "dev@salescode.ai"), false);
});

test("empty-string reporter → not self-assigned", () => {
  assert.equal(isSelfAssigned("", "dev@salescode.ai"), false);
});

// --- buildComplexityBuckets --------------------------------------------------

test("one bucket per non-zero complexity level, weighted C1=1..C5=10", () => {
  const counts = new Map([["1", 3], ["2", 17], ["3", 36], ["4", 2], ["5", 1]]);
  assert.deepEqual(buildComplexityBuckets(counts), [
    { label: "C1", count: 3, weightEach: 1, totalWeight: 3 },
    { label: "C2", count: 17, weightEach: 3, totalWeight: 51 },
    { label: "C3", count: 36, weightEach: 5, totalWeight: 180 },
    { label: "C4", count: 2, weightEach: 7, totalWeight: 14 },
    { label: "C5", count: 1, weightEach: 10, totalWeight: 10 },
  ]);
});

test("a zero-count level is omitted entirely, not shown as a zero row", () => {
  const counts = new Map([["1", 5], ["3", 2]]);
  assert.deepEqual(
    buildComplexityBuckets(counts).map((b) => b.label),
    ["C1", "C3"],
  );
});

test("an \"unset\" count becomes its own \"Unset (→ C1)\" bucket, weighted like C1", () => {
  const counts = new Map([["unset", 4]]);
  assert.deepEqual(buildComplexityBuckets(counts), [
    { label: "Unset (→ C1)", count: 4, weightEach: 1, totalWeight: 4 },
  ]);
});

test("\"unset\" always sorts last, after every numbered level present", () => {
  const counts = new Map([["unset", 1], ["1", 2], ["5", 1]]);
  assert.deepEqual(
    buildComplexityBuckets(counts).map((b) => b.label),
    ["C1", "C5", "Unset (→ C1)"],
  );
});

test("empty counts → no buckets at all", () => {
  assert.deepEqual(buildComplexityBuckets(new Map()), []);
});

test("expectedComplexityCounts never has an \"unset\" key in practice, but the function doesn't special-case that away — it just never sees one", () => {
  const counts = new Map([["1", 1], ["2", 1], ["3", 1], ["4", 1], ["5", 1]]);
  const buckets = buildComplexityBuckets(counts);
  assert.equal(buckets.some((b) => b.label.startsWith("Unset")), false);
  assert.equal(buckets.length, 5);
});

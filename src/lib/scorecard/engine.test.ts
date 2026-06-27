// Unit tests for the Bug Quality formula after the resolution-credit split:
// output (features + priority-weighted bug-resolution credit) vs weighted bug
// load. Run: ./node_modules/.bin/tsx --test src/lib/scorecard/engine.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { bugQualityPoints } from "./engine";

const approx = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);

test("no data → full score (5)", () => {
  approx(bugQualityPoints(0, 0, 0), 5);
});

test("features only, no bugs → full score", () => {
  approx(bugQualityPoints(40, 0, 0), 5);
});

test("owned bugs with no output → 0", () => {
  approx(bugQualityPoints(0, 0, 10), 0);
});

test("reference example unchanged when resolution credit is 0 (40 vs 10 → 4.0)", () => {
  approx(bugQualityPoints(40, 0, 10), 4.0);
});

test("resolving bugs lifts the score: 0 features, 10 resolved, 10 owned → 2.5", () => {
  // output 10 / (10 + 10) = 0.5 → 2.5
  approx(bugQualityPoints(0, 10, 10), 2.5);
});

test("resolution credit adds to feature output in the numerator", () => {
  // (5 + 5) / (5 + 5 + 10) = 0.5 → 2.5
  approx(bugQualityPoints(5, 5, 10), 2.5);
});

test("a pure resolver (fixes bugs, owns none) gets full score", () => {
  // output 7 / (7 + 0) → 5
  approx(bugQualityPoints(0, 7, 0), 5);
});

test("priority weight matters: a P0 fix (10) outweighs the owned penalty of a low bug (1)", () => {
  // (0 + 10) / (10 + 1) ≈ 4.545
  approx(bugQualityPoints(0, 10, 1), (10 / 11) * 5);
});

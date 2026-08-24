// Unit tests for filterFeatureTasks — the Feature Tasks table's "Non-self-
// assigned only" toggle. Default (off) must return the exact list unchanged,
// so the table's default view never differs from before this toggle existed.
// Run: ./node_modules/.bin/tsx --test "src/app/(app)/performance-review/feature-tasks-filter.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterFeatureTasks } from "./feature-tasks-filter";
import type { ScorecardFeatureItem } from "./data";

function item(key: string, selfAssigned: boolean): ScorecardFeatureItem {
  return {
    key,
    summary: `summary for ${key}`,
    complexity: 5,
    loc: null,
    expectedComplexity: 1,
    complexityMismatch: false,
    mismatchSuggestion: null,
    selfAssigned,
    selfAssignedOverridden: false,
  };
}

const items = [item("A-1", false), item("A-2", true), item("A-3", false), item("A-4", true)];

test("off (default) returns every item, unchanged — including self-assigned ones", () => {
  const result = filterFeatureTasks(items, false);
  assert.deepEqual(result, items);
  assert.equal(result.length, 4);
});

test("off does not filter even when every item is self-assigned", () => {
  const allSelfAssigned = [item("B-1", true), item("B-2", true)];
  assert.deepEqual(filterFeatureTasks(allSelfAssigned, false), allSelfAssigned);
});

test("on hides self-assigned items, keeping the rest", () => {
  const result = filterFeatureTasks(items, true);
  assert.deepEqual(
    result.map((i) => i.key),
    ["A-1", "A-3"],
  );
});

test("on with everything self-assigned returns an empty list, not an error", () => {
  const allSelfAssigned = [item("B-1", true), item("B-2", true)];
  assert.deepEqual(filterFeatureTasks(allSelfAssigned, true), []);
});

test("on with nothing self-assigned returns every item", () => {
  const noneSelfAssigned = [item("C-1", false), item("C-2", false)];
  assert.deepEqual(filterFeatureTasks(noneSelfAssigned, true), noneSelfAssigned);
});

test("empty input, either toggle state, returns an empty list", () => {
  assert.deepEqual(filterFeatureTasks([], false), []);
  assert.deepEqual(filterFeatureTasks([], true), []);
});

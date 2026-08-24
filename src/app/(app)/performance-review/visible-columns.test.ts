// Unit tests for parseVisibleColumns — validating whatever's actually in the
// DB (feature_flags.performanceReviewVisibleColumns) as a usable column-key
// list. getVisibleColumns itself is DB-driven and isn't unit-tested here.
// Run: ./node_modules/.bin/tsx --test "src/app/(app)/performance-review/visible-columns.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVisibleColumns, DEFAULT_VISIBLE_COLUMNS } from "./visible-columns";
import { ALL_NUMERIC_COLUMNS } from "./rating-sort";

test("a valid subset of known column keys parses as-is", () => {
  const raw = ["score", "mttr"];
  assert.deepEqual(parseVisibleColumns(raw), raw);
});

test("the full default list parses as-is", () => {
  assert.deepEqual(parseVisibleColumns(DEFAULT_VISIBLE_COLUMNS), DEFAULT_VISIBLE_COLUMNS);
});

test("every canonical column key is individually valid", () => {
  for (const key of ALL_NUMERIC_COLUMNS) {
    assert.deepEqual(parseVisibleColumns([key]), [key]);
  }
});

for (const bad of [{ a: 1 }, "nonsense", null, undefined, 42]) {
  test(`non-array input (${JSON.stringify(bad)}) is rejected`, () => {
    assert.equal(parseVisibleColumns(bad), null);
  });
}

test("empty array is rejected (falls back rather than rendering zero columns)", () => {
  assert.equal(parseVisibleColumns([]), null);
});

test("an unknown column key anywhere in the array rejects the whole list", () => {
  assert.equal(parseVisibleColumns(["score", "totallyMadeUp"]), null);
});

test("a non-string entry rejects the whole list", () => {
  assert.equal(parseVisibleColumns(["score", 5]), null);
});

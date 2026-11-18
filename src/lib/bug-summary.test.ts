// Unit tests for the End-date rule on bug-detail rows.
//
// Run: ./node_modules/.bin/tsx --test "src/lib/bug-summary.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { bugEndDate } from "./bug-summary";

const DONE_AT = new Date("2026-10-05T10:00:00.000Z");

test("closed bug: end date is the completion time", () => {
  assert.equal(bugEndDate(false, DONE_AT), "2026-10-05T10:00:00.000Z");
  assert.equal(bugEndDate(false, "2026-10-05T10:00:00.000Z"), "2026-10-05T10:00:00.000Z");
});

test("open bug stays blank, even when it was closed once and reopened", () => {
  assert.equal(bugEndDate(true, null), null);
  assert.equal(bugEndDate(true, DONE_AT), null);
});

test("closed bug with no recorded completion, or an unparseable one, stays blank", () => {
  assert.equal(bugEndDate(false, null), null);
  assert.equal(bugEndDate(false, undefined), null);
  assert.equal(bugEndDate(false, "not a date"), null);
});

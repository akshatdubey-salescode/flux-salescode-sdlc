// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/reviewers.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_REVIEWERS, validateReviewers } from "./reviewers";

test("valid reviewers are lower-cased, de-duplicated and named", () => {
  const r = validateReviewers([{ email: " Asha@Salescode.ai ", name: " Asha " }, { email: "asha@salescode.ai" }, { email: "bo@salescode.ai" }], "me@salescode.ai");
  assert.ok(r.ok);
  assert.deepEqual(r.reviewers, [{ email: "asha@salescode.ai", name: "Asha" }, { email: "bo@salescode.ai", name: null }]);
});

test("at least one reviewer is required", () => {
  for (const bad of [undefined, null, [], "x", {}]) {
    const r = validateReviewers(bad, "me@salescode.ai");
    assert.ok(!r.ok);
    assert.match(r.error, /at least one reviewer/i);
  }
});

test("the committer cannot review their own submission (any casing)", () => {
  const r = validateReviewers([{ email: "ME@salescode.ai" }], "me@salescode.ai");
  assert.ok(!r.ok);
  assert.match(r.error, /own submission/);
});

test("invalid emails and too many reviewers are rejected", () => {
  assert.ok(!validateReviewers([{ email: "not-an-email" }], "me@salescode.ai").ok);
  assert.ok(!validateReviewers([{ email: 5 as unknown as string }], "me@salescode.ai").ok);
  const many = Array.from({ length: MAX_REVIEWERS + 1 }, (_, i) => ({ email: `r${i}@salescode.ai` }));
  assert.ok(!validateReviewers(many, "me@salescode.ai").ok);
});

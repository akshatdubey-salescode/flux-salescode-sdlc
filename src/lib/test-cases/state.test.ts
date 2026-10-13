// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/state.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COMMENT_LENGTH,
  canComment,
  canDecide,
  canResolve,
  roundStatusFrom,
  validateCommentBody,
  validateDecision,
} from "./state";

const reviewers = [{ email: "Asha@salescode.ai" }, { email: "bo@salescode.ai" }];
const asha = { email: "asha@salescode.ai", isAdmin: false };
const outsider = { email: "zed@salescode.ai", isAdmin: false };
const admin = { email: "root@salescode.ai", isAdmin: true };

test("one approval approves the round; otherwise a change request stands; otherwise in review", () => {
  assert.equal(roundStatusFrom([]), "in_review");
  assert.equal(roundStatusFrom(["pending", "pending"]), "in_review");
  assert.equal(roundStatusFrom(["changes_requested", "pending"]), "changes_requested");
  assert.equal(roundStatusFrom(["approved", "pending"]), "approved");
  assert.equal(roundStatusFrom(["approved", "changes_requested"]), "approved", "one approval is enough");
});

test("only listed reviewers (any casing) or admins may decide, and only on the latest round", () => {
  assert.deepEqual(canDecide(asha, reviewers, true), { ok: true });
  assert.deepEqual(canDecide(admin, reviewers, true), { ok: true });
  assert.equal(canDecide(outsider, reviewers, true).ok, false);
  const old = canDecide(asha, reviewers, false);
  assert.equal(old.ok, false);
  assert.match((old as { reason: string }).reason, /superseded/);
});

test("reviewers, the submitter and admins can comment; others cannot", () => {
  assert.ok(canComment(asha, reviewers, "me@salescode.ai").ok);
  assert.ok(canComment({ email: "ME@salescode.ai", isAdmin: false }, reviewers, "me@salescode.ai").ok);
  assert.ok(canComment(admin, reviewers, "me@salescode.ai").ok);
  assert.ok(!canComment(outsider, reviewers, "me@salescode.ai").ok);
});

test("resolving: the author, submitter, reviewers and admins; not outsiders", () => {
  assert.ok(canResolve(outsider, "zed@salescode.ai", reviewers, "me@salescode.ai").ok, "own comment");
  assert.ok(canResolve({ email: "me@salescode.ai", isAdmin: false }, "asha@salescode.ai", reviewers, "me@salescode.ai").ok);
  assert.ok(!canResolve(outsider, "asha@salescode.ai", reviewers, "me@salescode.ai").ok);
});

test("a change request must say what to change; unknown decisions are rejected", () => {
  assert.ok(validateDecision("approved", "").ok);
  assert.ok(validateDecision("changes_requested", "Add negative cases").ok);
  assert.ok(!validateDecision("changes_requested", "   ").ok);
  assert.ok(!validateDecision("maybe", "x").ok);
});

test("comment bodies are trimmed, required and capped", () => {
  assert.deepEqual(validateCommentBody("  hi  "), { ok: true, body: "hi" });
  assert.ok(!validateCommentBody("   ").ok);
  assert.ok(!validateCommentBody(5).ok);
  assert.ok(!validateCommentBody("x".repeat(MAX_COMMENT_LENGTH + 1)).ok);
});

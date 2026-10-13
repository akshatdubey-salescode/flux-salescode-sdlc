// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/gate.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { gateDecision } from "./gate";

const base = { fromStatus: "pending", toStatus: "delivered", hasSet: true, devSigned: false, testerSigned: false };

test("an issue with TCs and no sign-off cannot be marked delivered or partially delivered", () => {
  assert.equal(gateDecision(base).blocked, true);
  assert.equal(gateDecision({ ...base, toStatus: "partially_delivered" }).blocked, true);
});

test("one sign-off (dev or tester) is enough", () => {
  assert.equal(gateDecision({ ...base, devSigned: true }).blocked, false);
  assert.equal(gateDecision({ ...base, testerSigned: true }).blocked, false);
});

test("issues without TCs are never blocked", () => {
  assert.equal(gateDecision({ ...base, hasSet: false }).blocked, false);
});

test("resaving the same status (comment edit), reverting, and not-delivered are not gated", () => {
  assert.equal(gateDecision({ ...base, fromStatus: "delivered" }).blocked, false);
  assert.equal(gateDecision({ ...base, fromStatus: "delivered", toStatus: "pending" }).blocked, false);
  assert.equal(gateDecision({ ...base, toStatus: "not_delivered" }).blocked, false);
  assert.equal(gateDecision({ ...base, toStatus: "pending" }).blocked, false);
});

test("moving between delivered outcomes without sign-off is still gated", () => {
  assert.equal(gateDecision({ ...base, fromStatus: "partially_delivered", toStatus: "delivered" }).blocked, true);
});

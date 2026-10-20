// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/state.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COMMENT_LENGTH,
  canComment,
  canDecide,
  canResolve,
  canSignOff,
  applyCarryOver,
  canApprove,
  canOverride,
  planOverride,
  roundStatusFrom,
  validateOverrideReason,
  validateCommentBody,
  validateDecision,
} from "./state";

const reviewers = [{ email: "Asha@salescode.ai" }, { email: "bo@salescode.ai" }];
const asha = { email: "asha@salescode.ai", isAdmin: false };
const outsider = { email: "zed@salescode.ai", isAdmin: false };
const admin = { email: "root@salescode.ai", isAdmin: true };

test("a standing change request wins; re-review holds the round; otherwise one approval approves", () => {
  assert.equal(roundStatusFrom([]), "in_review");
  assert.equal(roundStatusFrom(["pending", "pending"]), "in_review");
  assert.equal(roundStatusFrom(["changes_requested", "pending"]), "changes_requested");
  assert.equal(roundStatusFrom(["approved", "pending"]), "approved");
  // Another reviewer's approval does not outrank a standing change request.
  assert.equal(roundStatusFrom(["approved", "changes_requested"]), "changes_requested");
  // After resubmission the requester must look again; the approval carried over does not finish the round.
  assert.equal(roundStatusFrom(["approved", "re_review"]), "in_review");
  assert.equal(roundStatusFrom(["re_review", "pending"]), "in_review");
  // Overridden feedback no longer holds anything back.
  assert.equal(roundStatusFrom(["approved", "overridden"]), "approved");
  assert.equal(roundStatusFrom(["overridden", "pending"]), "in_review");
});

test("approval is blocked while another reviewer's change request stands, but not your own", () => {
  const rs = [
    { email: "asha@salescode.ai", name: "Asha", state: "changes_requested" as const },
    { email: "bo@salescode.ai", name: "Bo", state: "pending" as const },
  ];
  const bo = { email: "bo@salescode.ai", isAdmin: false };
  const blocked = canApprove(bo, rs);
  assert.equal(blocked.ok, false);
  assert.match((blocked as { reason: string }).reason, /Asha has requested changes/);
  assert.ok(canApprove({ email: "ASHA@salescode.ai", isAdmin: false }, rs).ok, "the requester can withdraw by approving");
  assert.ok(canApprove(bo, [{ ...rs[0], state: "re_review" }, rs[1]]).ok, "after resubmission others can approve again");
  assert.ok(canApprove(bo, [{ ...rs[0], state: "overridden" }, rs[1]]).ok);
});

test("override needs a reviewer (or admin), the latest round, open feedback and a real reason", () => {
  const rs = [
    { email: "asha@salescode.ai", state: "changes_requested" as const },
    { email: "bo@salescode.ai", state: "pending" as const },
  ];
  const bo = { email: "bo@salescode.ai", isAdmin: false };
  assert.ok(canOverride({ actor: bo, reviewers: rs, isLatestRound: true, openFeedback: true }).ok);
  assert.ok(canOverride({ actor: admin, reviewers: rs, isLatestRound: true, openFeedback: true }).ok);
  assert.ok(!canOverride({ actor: outsider, reviewers: rs, isLatestRound: true, openFeedback: true }).ok);
  assert.ok(!canOverride({ actor: bo, reviewers: rs, isLatestRound: false, openFeedback: true }).ok);
  const none = canOverride({ actor: bo, reviewers: rs, isLatestRound: true, openFeedback: false });
  assert.match((none as { reason: string }).reason, /no open feedback/);

  assert.equal(validateOverrideReason("too short").ok, false);
  assert.equal(validateOverrideReason(undefined).ok, false);
  assert.deepEqual(validateOverrideReason("  Duplicate of TC-12, safe to ignore  "), { ok: true, reason: "Duplicate of TC-12, safe to ignore" });
});

test("an override approves for the actor and marks standing feedback overridden", () => {
  const plan = planOverride(
    [
      { email: "Asha@salescode.ai", state: "changes_requested" },
      { email: "bo@salescode.ai", state: "pending" },
      { email: "cy@salescode.ai", state: "re_review" },
      { email: "di@salescode.ai", state: "approved" },
    ],
    "bo@salescode.ai",
  );
  assert.equal(plan.states.get("bo@salescode.ai"), "approved");
  assert.equal(plan.states.get("asha@salescode.ai"), "overridden");
  assert.equal(plan.states.get("cy@salescode.ai"), "overridden");
  assert.equal(plan.states.get("di@salescode.ai"), "approved");
  assert.deepEqual(plan.overridden.sort(), ["asha@salescode.ai", "cy@salescode.ai"]);
  // An admin who isn't a listed reviewer is added as the approver.
  assert.equal(planOverride([{ email: "a@x.com", state: "changes_requested" }], "root@x.com").states.get("root@x.com"), "approved");
});

test("resubmission carries approvals and pending forward; only requesters go back to re-review", () => {
  const at = new Date("2026-01-01T10:00:00Z");
  const prev = [
    { email: "asha@salescode.ai", name: "Asha", state: "changes_requested" as const, decidedAt: at, decidedRoundNo: 1 },
    { email: "bo@salescode.ai", name: "Bo", state: "approved" as const, decidedAt: at, decidedRoundNo: 1 },
    { email: "cy@salescode.ai", name: "Cy", state: "pending" as const, decidedAt: null, decidedRoundNo: null },
    { email: "di@salescode.ai", name: "Di", state: "re_review" as const, decidedAt: null, decidedRoundNo: null },
    { email: "ed@salescode.ai", name: "Ed", state: "overridden" as const, decidedAt: at, decidedRoundNo: 1 },
    { email: "gone@salescode.ai", name: "Gone", state: "approved" as const, decidedAt: at, decidedRoundNo: 1 },
  ];
  const next = ["Asha@salescode.ai", "bo@salescode.ai", "cy@salescode.ai", "di@salescode.ai", "ed@salescode.ai", "new@salescode.ai"].map((email) => ({ email, name: null }));
  const out = Object.fromEntries(applyCarryOver(prev, next).map((r) => [r.email, r]));

  assert.equal(out["asha@salescode.ai"].state, "re_review");
  assert.equal(out["asha@salescode.ai"].decidedAt, null, "a request for changes is not a standing decision");
  assert.equal(out["asha@salescode.ai"].name, "Asha", "the known name is kept");
  assert.equal(out["bo@salescode.ai"].state, "approved");
  assert.equal(out["bo@salescode.ai"].decidedRoundNo, 1, "the approval remembers the round it was given in");
  assert.equal(out["cy@salescode.ai"].state, "pending");
  assert.equal(out["di@salescode.ai"].state, "re_review");
  assert.equal(out["ed@salescode.ai"].state, "overridden");
  assert.equal(out["new@salescode.ai"].state, "pending");
  assert.equal(out["gone@salescode.ai"], undefined, "removed reviewers drop out");
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

const dev = { email: "Dev@salescode.ai", isAdmin: false };
const qa = { email: "qa@salescode.ai", isAdmin: false };
const people = { dev: ["dev@salescode.ai"], qa: ["qa@salescode.ai"] };
const open = { roundApproved: true, isLatestRound: true, openFeedback: 0 };

test("sign-off needs an approved, latest round", () => {
  assert.ok(canSignOff({ role: "dev", actor: dev, people, ...open }).ok);
  const notApproved = canSignOff({ role: "dev", actor: dev, people, roundApproved: false, isLatestRound: true, openFeedback: 0 });
  assert.equal(notApproved.ok, false);
  assert.match((notApproved as { reason: string }).reason, /approves/);
  const old = canSignOff({ role: "dev", actor: dev, people, roundApproved: true, isLatestRound: false, openFeedback: 0 });
  assert.match((old as { reason: string }).reason, /superseded/);
});

test("open feedback blocks sign-off for everyone, admins included, with a count in the message", () => {
  const one = canSignOff({ role: "dev", actor: dev, people, ...open, openFeedback: 1 });
  assert.equal(one.ok, false);
  assert.match((one as { reason: string }).reason, /Resolve or waive the 1 open feedback item before/);
  const three = canSignOff({ role: "dev", actor: admin, people, ...open, openFeedback: 3 });
  assert.match((three as { reason: string }).reason, /3 open feedback items/);
  assert.ok(canSignOff({ role: "dev", actor: dev, people, ...open, openFeedback: 0 }).ok);
});

test("the developer signs as dev, the QA assignee as tester, and admins as either", () => {
  assert.ok(!canSignOff({ role: "dev", actor: qa, people, ...open }).ok);
  assert.ok(!canSignOff({ role: "tester", actor: dev, people, ...open }).ok);
  assert.ok(canSignOff({ role: "tester", actor: qa, people, ...open }).ok);
  assert.ok(canSignOff({ role: "dev", actor: admin, people, ...open }).ok);
  assert.ok(canSignOff({ role: "tester", actor: admin, people, ...open }).ok);
  assert.ok(!canSignOff({ role: "dev", actor: outsider, people, ...open }).ok);
});

test("with no QA assignee recorded, any non-developer may sign as tester", () => {
  const noQa = { dev: ["dev@salescode.ai"], qa: [] };
  assert.ok(canSignOff({ role: "tester", actor: outsider, people: noQa, ...open }).ok);
  const own = canSignOff({ role: "tester", actor: dev, people: noQa, ...open });
  assert.equal(own.ok, false);
  assert.match((own as { reason: string }).reason, /can't also sign off/);
});

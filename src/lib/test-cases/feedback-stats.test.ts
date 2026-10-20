// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/feedback-stats.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseFeedback, type FeedbackEvent } from "./feedback-stats";

const ev = (over: Partial<FeedbackEvent>): FeedbackEvent => ({
  roundNo: 1, kind: "comment", source: "reviewer", authorEmail: "asha@salescode.ai", authorName: "Asha", resolved: false, waived: false, ...over,
});

test("counts across rounds, by reviewer and by round", () => {
  const s = summariseFeedback({
    roundCount: 2,
    latestRoundNo: 2,
    reviewersNow: [
      { email: "asha@salescode.ai", name: "Asha", state: "re_review" },
      { email: "bo@salescode.ai", name: "Bo", state: "approved" },
    ],
    events: [
      ev({ kind: "comment", resolved: true }), // addressed
      ev({ kind: "comment", resolved: true, waived: true, authorEmail: "bo@salescode.ai", authorName: "Bo" }),
      ev({ kind: "changes_requested" }),
      ev({ kind: "approved", authorEmail: "bo@salescode.ai", authorName: "Bo" }),
      ev({ kind: "comment", roundNo: 2 }), // open on the latest round
      ev({ kind: "override", roundNo: 2, authorEmail: "bo@salescode.ai", authorName: "Bo" }),
    ],
  });
  assert.equal(s.raised, 4, "3 comments + 1 change request");
  assert.equal(s.changeRequests, 1);
  assert.equal(s.approvals, 1);
  assert.equal(s.overrides, 1);
  assert.equal(s.resolved, 1);
  assert.equal(s.waived, 1);
  assert.equal(s.openComments, 1);
  assert.equal(s.resubmissions, 1);
  assert.equal(s.awaitingReReview, 1);
  assert.equal(s.blockingReviewers, 0);

  const asha = s.byReviewer.find((r) => r.email === "asha@salescode.ai")!;
  assert.deepEqual([asha.state, asha.changeRequests, asha.comments, asha.approvals], ["re_review", 1, 2, 0]);
  const bo = s.byReviewer.find((r) => r.email === "bo@salescode.ai")!;
  assert.deepEqual([bo.state, bo.approvals, bo.overrides, bo.comments], ["approved", 1, 1, 1]);

  assert.deepEqual(s.perRound.map((r) => [r.roundNo, r.comments, r.changeRequests, r.resolved, r.waived, r.overrides]), [
    [1, 2, 1, 1, 1, 0],
    [2, 1, 0, 0, 0, 1],
  ]);
});

test("only the latest round's unresolved comments are open; older ones stay as history", () => {
  const s = summariseFeedback({
    roundCount: 2, latestRoundNo: 2, reviewersNow: [],
    events: [ev({ roundNo: 1 }), ev({ roundNo: 1 }), ev({ roundNo: 2, resolved: true })],
  });
  assert.equal(s.openComments, 0);
  assert.equal(s.raised, 3);
});

test("a standing change request is a blocking reviewer", () => {
  const s = summariseFeedback({ roundCount: 1, latestRoundNo: 1, events: [ev({ kind: "changes_requested" })], reviewersNow: [{ email: "asha@salescode.ai", name: "Asha", state: "changes_requested" }] });
  assert.equal(s.blockingReviewers, 1);
});

test("LLM feedback is tracked separately and not attributed to a reviewer", () => {
  const s = summariseFeedback({
    roundCount: 1, latestRoundNo: 1, reviewersNow: [],
    events: [ev({ source: "llm", authorEmail: "llm", authorName: "LLM review" }), ev({ source: "llm", authorEmail: "llm", resolved: true, waived: true })],
  });
  assert.deepEqual(s.llm, { raised: 2, open: 1 });
  assert.equal(s.byReviewer.length, 0, "the LLM is not a reviewer row");
  assert.equal(s.waived, 1);
});

test("a reviewer who left (no longer assigned) still appears with their history", () => {
  const s = summariseFeedback({ roundCount: 1, latestRoundNo: 1, reviewersNow: [], events: [ev({ kind: "approved" })] });
  assert.equal(s.byReviewer[0].state, null);
  assert.equal(s.byReviewer[0].approvals, 1);
});

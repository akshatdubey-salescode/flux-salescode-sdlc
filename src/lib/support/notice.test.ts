import { test } from "node:test";
import assert from "node:assert/strict";
import { approverNoticeCandidate } from "./notice";

test("a freshly created report is a notice candidate", () => {
  assert.equal(approverNoticeCandidate(true, { id: "r1", created: true }), "r1");
});

test("a report that already existed (manual Build now earlier) is still a candidate", () => {
  assert.equal(approverNoticeCandidate(true, { id: "r1", created: false }), "r1");
});

test("a report that is sending/sent/failed/lapsed is not a candidate", () => {
  assert.equal(approverNoticeCandidate(true, { blocked: "already_final" }), null);
});

test("nothing is claimed while sending is disabled (UAT/previews)", () => {
  assert.equal(approverNoticeCandidate(false, { id: "r1", created: true }), null);
  assert.equal(approverNoticeCandidate(false, { id: "r1", created: false }), null);
});

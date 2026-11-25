import { test } from "node:test";
import assert from "node:assert/strict";
import { approverNoticeCandidate, isBuildDue, isScheduledDay } from "./notice";

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

test("isBuildDue: only the half hour from 17:00 local", () => {
  assert.equal(isBuildDue(16 * 60 + 59), false);
  assert.equal(isBuildDue(17 * 60), true);
  assert.equal(isBuildDue(17 * 60 + 15), true); // e.g. Nepal at a :30 UTC run
  assert.equal(isBuildDue(17 * 60 + 29), true);
  assert.equal(isBuildDue(17 * 60 + 30), false);
});

test("isScheduledDay: daily is every day; weekly only on its weekday", () => {
  // 27 Nov 2026 is a Friday, 26 Nov a Thursday.
  assert.equal(isScheduledDay("daily", 5, "2026-11-26"), true);
  assert.equal(isScheduledDay("weekly", 5, "2026-11-27"), true);
  assert.equal(isScheduledDay("weekly", 5, "2026-11-26"), false);
  assert.equal(isScheduledDay("weekly", 0, "2026-11-29"), true); // Sunday
});

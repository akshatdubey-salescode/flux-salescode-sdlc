// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/history.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHistory, type HistoryComment, type HistoryRound } from "./history";

const d = (s: string) => new Date(`2026-10-${s}:00Z`);
const round = (roundNo: number, at: string, over: Partial<HistoryRound> = {}): HistoryRound => ({
  roundNo, at: d(at), by: "Sub Mitter", tcCount: 10, tabs: ["Main"], notes: null, carriedApprovals: [], awaitingReReview: [], ...over,
});
const comment = (id: string, roundNo: number, at: string, over: Partial<HistoryComment> = {}): HistoryComment => ({
  id, roundNo, kind: "comment", source: "reviewer", author: "Asha", body: "text", at: d(at), caseCode: null, tab: null,
  resolved: false, waived: false, resolvedBy: null, resolvedAt: null, meta: null, ...over,
});

test("everything from every round is in one list, newest first", () => {
  const h = buildHistory({
    rounds: [round(1, "01T09:00"), round(2, "03T09:00", { carriedApprovals: ["Bo"], awaitingReReview: ["Asha"], tabs: ["Main", "Extra"] })],
    comments: [
      comment("c1", 1, "01T10:00", { kind: "changes_requested", body: "Add negative cases" }),
      comment("c2", 1, "01T11:00", { kind: "approved", author: "Bo", body: "" }),
      comment("c3", 2, "03T10:00", { caseCode: "TC-4", tab: "Extra", body: "Check boundary" }),
    ],
    signoffs: [{ id: "s1", roundNo: 2, role: "dev", by: "Dev", at: d("04T09:00"), pass: 8, fail: 1, blocked: 0, notRun: 1 }],
  });
  assert.deepEqual(h.map((e) => e.id), ["s1", "c3", "round-2", "c2", "c1", "round-1"]);
  const r2 = h.find((e) => e.id === "round-2")!;
  assert.equal(r2.title, "Resubmitted test cases (Round 2)");
  assert.match(r2.detail!, /2 tabs: Main, Extra/);
  assert.match(r2.detail!, /approvals carried over: Bo/);
  assert.match(r2.detail!, /waiting to re-review: Asha/);
  assert.equal(h.find((e) => e.id === "round-1")!.title, "Submitted test cases");
  assert.deepEqual([h.find((e) => e.id === "c3")!.caseCode, h.find((e) => e.id === "c3")!.tab], ["TC-4", "Extra"]);
  assert.equal(h.find((e) => e.id === "s1")!.title, "Developer signed off");
});

test("an override entry says who, what was waived and why; waived comments don't also appear as resolved", () => {
  const h = buildHistory({
    rounds: [round(1, "01T09:00")],
    comments: [
      comment("c1", 1, "01T10:00", { resolved: true, waived: true, resolvedBy: "bo@x.com", resolvedAt: d("01T12:00") }),
      comment("o1", 1, "01T12:00", {
        kind: "override", author: "Bo", body: "Duplicate of TC-12, safe to ignore",
        meta: { overriddenReviewers: [{ email: "asha@x.com", name: "Asha" }], waivedComments: 1 },
      }),
    ],
    signoffs: [],
  });
  const o = h.find((e) => e.kind === "override")!;
  assert.equal(o.actor, "Bo");
  assert.equal(o.detail, "Waived feedback of Asha and 1 open comment. Reason: Duplicate of TC-12, safe to ignore");
  assert.equal(h.filter((e) => e.kind === "resolved").length, 0);
});

test("a comment someone addressed gets its own resolved entry at the time it was resolved", () => {
  const h = buildHistory({
    rounds: [round(1, "01T09:00")],
    comments: [comment("c1", 1, "01T10:00", { resolved: true, resolvedBy: "Sub Mitter", resolvedAt: d("02T10:00"), body: "Fix the title" })],
    signoffs: [],
  });
  assert.deepEqual(h.map((e) => e.kind), ["resolved", "comment", "submitted"]);
  assert.equal(h[0].actor, "Sub Mitter");
});

test("LLM feedback is tagged with its source so it can be told apart", () => {
  const h = buildHistory({ rounds: [round(1, "01T09:00")], comments: [comment("l1", 1, "01T09:30", { source: "llm", author: "LLM review" })], signoffs: [] });
  assert.equal(h.find((e) => e.id === "l1")!.source, "llm");
});

test("long notes and comments are cut for the timeline entry but not the stored text", () => {
  const long = "x".repeat(400);
  const h = buildHistory({ rounds: [round(1, "01T09:00", { notes: long })], comments: [], signoffs: [] });
  assert.ok(h[0].detail!.length < 300);
});

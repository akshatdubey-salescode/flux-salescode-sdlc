import test from "node:test";
import assert from "node:assert/strict";
import { sprintHasFinished, workstreamHasFinished } from "./lifecycle";

const TODAY = "2026-09-08";

const active = { completedAt: null, endDate: "2026-09-20" };
const closed = { completedAt: "2026-09-05T00:00:00.000Z", endDate: "2026-09-20" };
const lapsed = { completedAt: null, endDate: "2026-09-07" };
const endsToday = { completedAt: null, endDate: TODAY };

test("a sprint still inside its dates is not finished", () => {
  assert.equal(sprintHasFinished(active, TODAY), false);
});

test("a closed sprint is finished even with days left on the clock", () => {
  assert.equal(sprintHasFinished(closed, TODAY), true);
});

test("an un-closed sprint whose end date has gone by is finished", () => {
  assert.equal(sprintHasFinished(lapsed, TODAY), true);
});

test("the last day of a sprint still counts as running", () => {
  // The final update is worth sending ON the end date, not the day before.
  assert.equal(sprintHasFinished(endsToday, TODAY), false);
});

test("completedAt is read as set-or-not, so a Date works like an ISO string", () => {
  assert.equal(sprintHasFinished({ completedAt: new Date(), endDate: "2026-09-20" }, TODAY), true);
});

test("a workstream is finished only when every sprint in it is", () => {
  assert.equal(workstreamHasFinished([closed, lapsed], TODAY), true);
  assert.equal(workstreamHasFinished([closed, active], TODAY), false);
});

test("an empty workstream is not finished — sprints get moved in later", () => {
  assert.equal(workstreamHasFinished([], TODAY), false);
});

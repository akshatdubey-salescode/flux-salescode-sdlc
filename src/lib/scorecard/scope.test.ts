// Unit tests for the performance-review quarter-scope rule (scope.ts).
// Run: ./node_modules/.bin/tsx --test src/lib/scorecard/scope.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isWorkInQuarter, toDay, type ScopeRow } from "./scope";

// Q1 FY2026 (Apr–Jun 2026). Previous quarter = Jan–Mar 2026.
const Q = { start: "2026-04-01", end: "2026-06-30" };

// Build a ScopeRow from plain YYYY-MM-DD strings. Actual dates go in the custom
// fields as datetimes (ids "as"/"ae"); planned Start/End as date-only ("sd"/"ed").
function row(o: {
  created?: string;
  completed?: string;
  actualStart?: string;
  actualEnd?: string;
  startDate?: string;
  endDate?: string;
}): ScopeRow {
  const cf: Record<string, unknown> = {};
  if (o.actualStart) cf["as"] = `${o.actualStart}T00:00:00.000Z`;
  if (o.actualEnd) cf["ae"] = `${o.actualEnd}T00:00:00.000Z`;
  if (o.startDate) cf["sd"] = o.startDate;
  if (o.endDate) cf["ed"] = o.endDate;
  return {
    customFields: cf,
    createdAt: o.created ? new Date(`${o.created}T00:00:00.000Z`) : null,
    completedAt: o.completed ? new Date(`${o.completed}T00:00:00.000Z`) : null,
    startDateFieldIds: ["sd"],
    endDateFieldIds: ["ed"],
    actualStartFieldIds: ["as"],
    actualEndFieldIds: ["ae"],
  };
}

// --- The five rows we agreed on ------------------------------------------------

test("created this quarter, worked this quarter → counted", () => {
  const r = row({ created: "2026-04-10", completed: "2026-05-20", actualStart: "2026-04-12", actualEnd: "2026-05-18" });
  assert.equal(isWorkInQuarter(r, Q), true);
});

test("created LAST quarter, worked this quarter → counted (creation ignored)", () => {
  const r = row({ created: "2026-02-01", completed: "2026-05-20", actualStart: "2026-04-05", actualEnd: "2026-05-18" });
  assert.equal(isWorkInQuarter(r, Q), true);
});

test("created this quarter, worked LAST quarter → excluded (finished elsewhere)", () => {
  const r = row({ created: "2026-04-27", completed: "2026-04-29", actualStart: "2026-02-01", actualEnd: "2026-03-15" });
  assert.equal(isWorkInQuarter(r, Q), false);
});

test("genuine spanning (real start last quarter, finished this quarter) → counted", () => {
  const r = row({ created: "2026-02-10", completed: "2026-05-01", actualStart: "2026-02-15", actualEnd: "2026-04-20" });
  assert.equal(isWorkInQuarter(r, Q), true);
});

test("DVSCPSHB-581 shape: start backdated before creation → excluded", () => {
  // created Apr 27, but Actual start Jan 1 (before the ticket existed) → backfill.
  const r = row({ created: "2026-04-27", completed: "2026-04-29", actualStart: "2026-01-01", actualEnd: "2026-04-02" });
  assert.equal(isWorkInQuarter(r, Q), false);
});

// --- Logged-late: start before creation but still inside the quarter -----------

test("logged late: planned start a few days before creation, all in quarter → counted", () => {
  // AC-104 shape: created Jun 8, planned start Jun 1, done Jun 22 — all this quarter.
  const r = row({ created: "2026-06-08", completed: "2026-06-22", startDate: "2026-06-01", endDate: "2026-06-03" });
  assert.equal(isWorkInQuarter(r, Q), true);
});

test("logged late: actual start before creation but inside the quarter → counted", () => {
  // AC-135 shape: created Jun 24, actual start Apr 5 / end Apr 6 — work is this quarter.
  const r = row({ created: "2026-06-24", completed: "2026-06-24", actualStart: "2026-04-05", actualEnd: "2026-04-06" });
  assert.equal(isWorkInQuarter(r, Q), true);
});

// --- Fallbacks & edges ---------------------------------------------------------

test("no Actual/planned dates at all → falls back to created+completed (counted)", () => {
  const r = row({ created: "2026-04-10", completed: "2026-05-01" });
  assert.equal(isWorkInQuarter(r, Q), true);
});

test("no Actual dates: falls back to planned Start/End — end out of quarter → excluded", () => {
  const r = row({ created: "2026-04-10", completed: "2026-05-01", startDate: "2026-04-12", endDate: "2026-07-05" });
  assert.equal(isWorkInQuarter(r, Q), false);
});

test("no Actual dates: planned start backdated before creation → excluded", () => {
  const r = row({ created: "2026-04-27", completed: "2026-04-29", startDate: "2026-01-15", endDate: "2026-04-20" });
  assert.equal(isWorkInQuarter(r, Q), false);
});

test("Actual end takes priority over the Done date when deciding the finish quarter", () => {
  // Done (completed) is in-quarter, but Actual end says the work finished last quarter.
  const r = row({ created: "2026-03-01", completed: "2026-04-05", actualStart: "2026-02-01", actualEnd: "2026-03-20" });
  assert.equal(isWorkInQuarter(r, Q), false);
});

test("start exactly equal to created is NOT treated as backdated", () => {
  const r = row({ created: "2026-04-15", completed: "2026-05-10", actualStart: "2026-04-15", actualEnd: "2026-05-09" });
  assert.equal(isWorkInQuarter(r, Q), true);
});

test("toDay formats a Date as UTC YYYY-MM-DD and passes null through", () => {
  assert.equal(toDay(new Date("2026-04-02T18:30:00.000Z")), "2026-04-02");
  assert.equal(toDay(null), null);
});

// Unit tests for the shared Bug Summary filter + sort helpers (used by the UI
// and the external /api/v1 bug endpoint).
//
// Run: ./node_modules/.bin/tsx --test "src/lib/bug-summary-filters.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBugScopeFilters,
  applyBugDetailFilters,
  sortBugs,
  asBugSortKey,
  type BugRow,
} from "./bug-summary";

function bug(over: Partial<BugRow>): BugRow {
  return {
    id: over.jiraKey ?? "x",
    jiraKey: "SC-1",
    summary: "",
    projectKey: "SC",
    projectName: "Salescode",
    jiraBaseUrl: null,
    status: "Open",
    statusCategory: null,
    priority: "P2",
    priorityBucket: "P2",
    environment: "Production",
    rcaGiven: false,
    rcaText: null,
    ownerName: "Missing Issue Owner",
    ownerEmail: null,
    assigneeName: null,
    assigneeEmail: null,
    isOpen: true,
    isInvalid: false,
    jiraCreatedAt: null,
    jiraUpdatedAt: null,
    jiraClosedAt: null,
    ...over,
  };
}

const keys = (rows: BugRow[]) => rows.map((b) => b.jiraKey);

test("scope filters: project, env and invalid exclusion", () => {
  const rows = [
    bug({ jiraKey: "SC-1" }),
    bug({ jiraKey: "DEV-1", projectKey: "DEV" }),
    bug({ jiraKey: "SC-2", environment: "UAT" }),
    bug({ jiraKey: "SC-3", isInvalid: true }),
  ];
  assert.deepEqual(keys(applyBugScopeFilters(rows, {})), ["SC-1", "DEV-1", "SC-2", "SC-3"]);
  assert.deepEqual(keys(applyBugScopeFilters(rows, { projects: new Set(["DEV"]) })), ["DEV-1"]);
  assert.equal(applyBugScopeFilters(rows, { projects: new Set() }).length, 4);
  assert.deepEqual(keys(applyBugScopeFilters(rows, { env: "UAT" })), ["SC-2"]);
  assert.deepEqual(keys(applyBugScopeFilters(rows, { excludeInvalid: true })), ["SC-1", "DEV-1", "SC-2"]);
});

test("owner filter matches owner OR assignee, by email else name", () => {
  const rows = [
    bug({ jiraKey: "SC-1", ownerEmail: "a@x.ai", ownerName: "A" }),
    bug({ jiraKey: "SC-2", assigneeEmail: "a@x.ai", assigneeName: "A" }),
    bug({ jiraKey: "SC-3", ownerName: "Bee" }),
    bug({ jiraKey: "SC-4", ownerEmail: "c@x.ai", ownerName: "C" }),
  ];
  assert.deepEqual(keys(applyBugDetailFilters(rows, { owner: "a@x.ai" })), ["SC-1", "SC-2"]);
  assert.deepEqual(keys(applyBugDetailFilters(rows, { owner: "Bee" })), ["SC-3"]);
});

test("search is case-insensitive across text columns", () => {
  const rows = [
    bug({ jiraKey: "SC-1", summary: "Login crash" }),
    bug({ jiraKey: "SC-2", status: "In QA" }),
  ];
  assert.deepEqual(keys(applyBugDetailFilters(rows, { q: "  LOGIN " })), ["SC-1"]);
  assert.deepEqual(keys(applyBugDetailFilters(rows, { q: "in qa" })), ["SC-2"]);
});

test("key sort is numeric-aware; ties break on key", () => {
  const rows = [bug({ jiraKey: "SC-10" }), bug({ jiraKey: "SC-9" }), bug({ jiraKey: "SC-100" })];
  assert.deepEqual(keys(sortBugs(rows, "key", "asc")), ["SC-9", "SC-10", "SC-100"]);
  assert.deepEqual(keys(sortBugs(rows, "key", "desc")), ["SC-100", "SC-10", "SC-9"]);
  // All P2 → priority ties fall back to key order.
  assert.deepEqual(keys(sortBugs(rows, "priority", "asc")), ["SC-9", "SC-10", "SC-100"]);
});

test("priority sorts P1 → Other", () => {
  const rows = [
    bug({ jiraKey: "SC-1", priorityBucket: "Other" }),
    bug({ jiraKey: "SC-2", priorityBucket: "P1" }),
    bug({ jiraKey: "SC-3", priorityBucket: "P3" }),
  ];
  assert.deepEqual(keys(sortBugs(rows, "priority", "asc")), ["SC-2", "SC-3", "SC-1"]);
});

test("end sort keeps open bugs last in both directions", () => {
  const rows = [
    bug({ jiraKey: "SC-1", jiraClosedAt: null }),
    bug({ jiraKey: "SC-2", jiraClosedAt: "2026-01-01T00:00:00Z" }),
    bug({ jiraKey: "SC-3", jiraClosedAt: "2026-02-01T00:00:00Z" }),
  ];
  assert.deepEqual(keys(sortBugs(rows, "end", "asc")), ["SC-2", "SC-3", "SC-1"]);
  assert.deepEqual(keys(sortBugs(rows, "end", "desc")), ["SC-3", "SC-2", "SC-1"]);
});

test("unknown sort key falls back to priority", () => {
  assert.equal(asBugSortKey("nope"), "priority");
  assert.equal(asBugSortKey(null), "priority");
  assert.equal(asBugSortKey("updated"), "updated");
});

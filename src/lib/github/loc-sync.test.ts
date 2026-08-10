// Unit tests for the pure matching logic extracted from runLocSyncJob:
// extractCandidateJiraKeys (the generous-separator regex) and
// resolvePrCredit (author + lenient-date-floor check, Dev Owner preferred
// over Assignee). The rest of loc-sync.ts (runLocSyncJob itself) is
// DB/GitHub-API-driven and isn't unit-tested here — see the module header
// for what these two functions feed.
// Run: ./node_modules/.bin/tsx --test src/lib/github/loc-sync.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCandidateJiraKeys, resolvePrCredit, isJobStale } from "./loc-sync";

// --- extractCandidateJiraKeys: separator generosity -------------------------

test("dash-separated key, canonical form", () => {
  assert.deepEqual(extractCandidateJiraKeys("CAV-3940 fix"), ["CAV-3940"]);
});

test("underscore-separated key resolves to canonical dash form", () => {
  assert.deepEqual(extractCandidateJiraKeys("CAV_3940-fix-thing"), ["CAV-3940"]);
});

test("dot-separated, lower-cased key resolves to canonical upper dash form", () => {
  assert.deepEqual(extractCandidateJiraKeys("cav.3940: fix"), ["CAV-3940"]);
});

test("space-separated key resolves to canonical dash form", () => {
  assert.deepEqual(extractCandidateJiraKeys("CAV 3940 fix"), ["CAV-3940"]);
});

test("no-separator key resolves to canonical dash form", () => {
  assert.deepEqual(extractCandidateJiraKeys("cav3940-fix"), ["CAV-3940"]);
});

test("same key appearing in both title and branch collapses to one entry", () => {
  const keys = extractCandidateJiraKeys("CAV-3940 promo report CAV-3940-promo-report-pipeline");
  assert.deepEqual(keys, ["CAV-3940"]);
});

test("two distinct keys in one PR both surface (documents the multi-key case)", () => {
  const keys = extractCandidateJiraKeys("CAV-100 CAV-101: shared refactor");
  assert.deepEqual(new Set(keys), new Set(["CAV-100", "CAV-101"]));
  assert.equal(keys.length, 2);
});

test("text with no Jira-like pattern yields no candidates", () => {
  assert.deepEqual(extractCandidateJiraKeys("refactor stuff and clean up"), []);
});

test("a short word+digit combo below the minimum key length yields no candidate", () => {
  // "v2" alone can't split into a >=2-char prefix and a >=1-digit number.
  assert.deepEqual(extractCandidateJiraKeys("v2"), []);
});

// --- resolvePrCredit: author + lenient date floor, Dev Owner preferred ------

const day = (iso: string) => new Date(iso);

test("no candidate for the key → no credit", () => {
  assert.equal(resolvePrCredit(undefined, "dev@salescode.ai", day("2026-06-01")), null);
});

test("no resolved author email → no credit", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", devOwnerEmail: null, createdAt: null };
  assert.equal(resolvePrCredit(candidate, undefined, day("2026-06-01")), null);
});

test("author matches neither Assignee nor Dev Owner → no credit", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", devOwnerEmail: null, createdAt: null };
  assert.equal(resolvePrCredit(candidate, "someone.else@salescode.ai", day("2026-06-01")), null);
});

test("author matches Assignee, no Dev Owner set → credited to Assignee", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", devOwnerEmail: null, createdAt: null };
  assert.equal(resolvePrCredit(candidate, "dev@salescode.ai", day("2020-01-01")), "dev@salescode.ai");
});

test("author matches Dev Owner, not Assignee → credited to Dev Owner", () => {
  const candidate = { assigneeEmail: "assignee@salescode.ai", devOwnerEmail: "owner@salescode.ai", createdAt: null };
  assert.equal(resolvePrCredit(candidate, "owner@salescode.ai", day("2026-06-01")), "owner@salescode.ai");
});

test("author matches Assignee while a different Dev Owner is set → still credited to Assignee (this PR just wasn't the Dev Owner's)", () => {
  const candidate = { assigneeEmail: "assignee@salescode.ai", devOwnerEmail: "owner@salescode.ai", createdAt: null };
  assert.equal(resolvePrCredit(candidate, "assignee@salescode.ai", day("2026-06-01")), "assignee@salescode.ai");
});

test("Dev Owner and Assignee are the same person → credited to that one email", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", devOwnerEmail: "dev@salescode.ai", createdAt: null };
  assert.equal(resolvePrCredit(candidate, "dev@salescode.ai", day("2026-06-01")), "dev@salescode.ai");
});

test("PR created before the Jira existed → no credit, even for the Dev Owner", () => {
  const candidate = { assigneeEmail: "assignee@salescode.ai", devOwnerEmail: "owner@salescode.ai", createdAt: day("2026-06-01") };
  assert.equal(resolvePrCredit(candidate, "owner@salescode.ai", day("2026-05-01")), null);
});

test("PR created exactly when the Jira was created → credited (inclusive floor)", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", devOwnerEmail: null, createdAt: day("2026-06-01T00:00:00Z") };
  assert.equal(resolvePrCredit(candidate, "dev@salescode.ai", day("2026-06-01T00:00:00Z")), "dev@salescode.ai");
});

test("PR created well after the Jira, in a later quarter, is still credited — no upper bound (the fix for the trailing-PR gap)", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", devOwnerEmail: null, createdAt: day("2026-01-01") };
  // Jira created Q4 FY25, completed Q1 FY26; this PR lands in Q2 FY26.
  assert.equal(resolvePrCredit(candidate, "dev@salescode.ai", day("2026-08-05")), "dev@salescode.ai");
});

test("author matches but PR predates the Jira by years → no credit", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", devOwnerEmail: null, createdAt: day("2026-01-01") };
  assert.equal(resolvePrCredit(candidate, "dev@salescode.ai", day("2020-01-01")), null);
});

// --- isJobStale: the "dead process vs. still running" threshold ------------

test("just started (0 minutes ago) is not stale", () => {
  const now = day("2026-08-07T12:00:00Z");
  assert.equal(isJobStale(day("2026-08-07T12:00:00Z"), now), false);
});

test("a real run's typical duration (~20 minutes) is not stale", () => {
  const now = day("2026-08-07T12:20:00Z");
  assert.equal(isJobStale(day("2026-08-07T12:00:00Z"), now), false);
});

test("just under the 2-hour threshold is not stale", () => {
  const now = day("2026-08-07T13:59:59Z");
  assert.equal(isJobStale(day("2026-08-07T12:00:00Z"), now), false);
});

test("just over the 2-hour threshold is stale", () => {
  const now = day("2026-08-07T14:00:01Z");
  assert.equal(isJobStale(day("2026-08-07T12:00:00Z"), now), true);
});

test("a job stuck since yesterday is stale — the orphaned-process case", () => {
  const now = day("2026-08-07T12:00:00Z");
  assert.equal(isJobStale(day("2026-08-06T18:03:58Z"), now), true);
});

// Unit tests for the pure matching logic extracted from runLocSyncJob:
// extractCandidateJiraKeys (the generous-separator regex) and
// isPrEligibleForJira (author + lenient-date-floor check). The rest of
// loc-sync.ts (runLocSyncJob itself) is DB/GitHub-API-driven and isn't
// unit-tested here — see the module header for what these two functions feed.
// Run: ./node_modules/.bin/tsx --test src/lib/github/loc-sync.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCandidateJiraKeys, isPrEligibleForJira, isJobStale } from "./loc-sync";

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

// --- isPrEligibleForJira: author + lenient date floor -----------------------

const day = (iso: string) => new Date(iso);

test("no candidate for the key → not eligible", () => {
  assert.equal(isPrEligibleForJira(undefined, "dev@salescode.ai", day("2026-06-01")), false);
});

test("no resolved author email → not eligible", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", createdAt: null };
  assert.equal(isPrEligibleForJira(candidate, undefined, day("2026-06-01")), false);
});

test("author does not match the Jira's assignee → not eligible", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", createdAt: null };
  assert.equal(isPrEligibleForJira(candidate, "someone.else@salescode.ai", day("2026-06-01")), false);
});

test("author matches, Jira has no known creation date → eligible regardless of PR date", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", createdAt: null };
  assert.equal(isPrEligibleForJira(candidate, "dev@salescode.ai", day("2020-01-01")), true);
});

test("PR created before the Jira existed → not eligible", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", createdAt: day("2026-06-01") };
  assert.equal(isPrEligibleForJira(candidate, "dev@salescode.ai", day("2026-05-01")), false);
});

test("PR created exactly when the Jira was created → eligible (inclusive floor)", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", createdAt: day("2026-06-01T00:00:00Z") };
  assert.equal(isPrEligibleForJira(candidate, "dev@salescode.ai", day("2026-06-01T00:00:00Z")), true);
});

test("PR created well after the Jira, in a later quarter, is still eligible — no upper bound (the fix for the trailing-PR gap)", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", createdAt: day("2026-01-01") };
  // Jira created Q4 FY25, completed Q1 FY26; this PR lands in Q2 FY26.
  assert.equal(isPrEligibleForJira(candidate, "dev@salescode.ai", day("2026-08-05")), true);
});

test("author matches but PR predates the Jira by years → not eligible", () => {
  const candidate = { assigneeEmail: "dev@salescode.ai", createdAt: day("2026-01-01") };
  assert.equal(isPrEligibleForJira(candidate, "dev@salescode.ai", day("2020-01-01")), false);
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

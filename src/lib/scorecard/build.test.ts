// Unit tests for isSelfAssigned (the gate that excludes self-created-and-
// assigned Jiras from every metric), resolveSelfAssigned (the same decision,
// but a superuser's jira_self_assigned_overrides entry wins outright when one
// exists), buildComplexityBuckets (the distribution-table bucketing shared by
// the marked and expected complexity distributions), and
// complexTasksContribution (the extraction behind all four Complex./Complex.
// NSA. leaderboard columns). The rest of build.ts is DB-driven
// (buildScorecards itself) and isn't unit-tested here; these are the pure
// functions it exports.
// Run: ./node_modules/.bin/tsx --test src/lib/scorecard/build.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSelfAssigned,
  resolveSelfAssigned,
  buildComplexityBuckets,
  complexTasksContribution,
} from "./build";
import { computeScorecard, type ScorecardInputs } from "./engine";
import { WEIGHTS, SCORE_SCALE } from "./config";

test("reporter same as credited person → self-assigned", () => {
  assert.equal(isSelfAssigned("dev@salescode.ai", "dev@salescode.ai"), true);
});

test("reporter different from credited person → not self-assigned", () => {
  assert.equal(isSelfAssigned("manager@salescode.ai", "dev@salescode.ai"), false);
});

test("comparison is case-insensitive", () => {
  assert.equal(isSelfAssigned("Dev@SalesCode.AI", "dev@salescode.ai"), true);
});

test("comparison tolerates surrounding whitespace on the reporter email", () => {
  assert.equal(isSelfAssigned("  dev@salescode.ai  ", "dev@salescode.ai"), true);
});

test("null reporter → not self-assigned", () => {
  assert.equal(isSelfAssigned(null, "dev@salescode.ai"), false);
});

test("undefined reporter → not self-assigned", () => {
  assert.equal(isSelfAssigned(undefined, "dev@salescode.ai"), false);
});

test("empty-string reporter → not self-assigned", () => {
  assert.equal(isSelfAssigned("", "dev@salescode.ai"), false);
});

// --- resolveSelfAssigned: superuser override wins outright -------------------

test("no override for this jiraKey → falls back to the computed comparison", () => {
  const overrides = new Map<string, boolean>();
  assert.equal(
    resolveSelfAssigned("CAV-2245", "dev@salescode.ai", "dev@salescode.ai", overrides),
    true, // computed: reporter === credited person
  );
  assert.equal(
    resolveSelfAssigned("CAV-2245", "manager@salescode.ai", "dev@salescode.ai", overrides),
    false,
  );
});

test("override forces NOT self-assigned even though the computed comparison says self-assigned", () => {
  const overrides = new Map([["CAV-2245", false]]);
  assert.equal(
    resolveSelfAssigned("CAV-2245", "dev@salescode.ai", "dev@salescode.ai", overrides),
    false,
  );
});

test("override forces self-assigned even though the computed comparison says not self-assigned", () => {
  const overrides = new Map([["CAV-2245", true]]);
  assert.equal(
    resolveSelfAssigned("CAV-2245", "manager@salescode.ai", "dev@salescode.ai", overrides),
    true,
  );
});

test("override lookup is case-insensitive on the Jira key", () => {
  const overrides = new Map([["CAV-2245", false]]);
  assert.equal(
    resolveSelfAssigned("cav-2245", "dev@salescode.ai", "dev@salescode.ai", overrides),
    false,
  );
});

test("an override on a different jiraKey doesn't leak into this one", () => {
  const overrides = new Map([["CAV-9999", false]]);
  assert.equal(
    resolveSelfAssigned("CAV-2245", "dev@salescode.ai", "dev@salescode.ai", overrides),
    true, // no override for THIS key → falls back to computed
  );
});

// --- buildComplexityBuckets --------------------------------------------------

test("one bucket per non-zero complexity level, weighted C1=1..C5=10", () => {
  const counts = new Map([["1", 3], ["2", 17], ["3", 36], ["4", 2], ["5", 1]]);
  assert.deepEqual(buildComplexityBuckets(counts), [
    { label: "C1", count: 3, weightEach: 1, totalWeight: 3 },
    { label: "C2", count: 17, weightEach: 3, totalWeight: 51 },
    { label: "C3", count: 36, weightEach: 5, totalWeight: 180 },
    { label: "C4", count: 2, weightEach: 7, totalWeight: 14 },
    { label: "C5", count: 1, weightEach: 10, totalWeight: 10 },
  ]);
});

test("a zero-count level is omitted entirely, not shown as a zero row", () => {
  const counts = new Map([["1", 5], ["3", 2]]);
  assert.deepEqual(
    buildComplexityBuckets(counts).map((b) => b.label),
    ["C1", "C3"],
  );
});

test("an \"unset\" count becomes its own \"Unset (→ C1)\" bucket, weighted like C1", () => {
  const counts = new Map([["unset", 4]]);
  assert.deepEqual(buildComplexityBuckets(counts), [
    { label: "Unset (→ C1)", count: 4, weightEach: 1, totalWeight: 4 },
  ]);
});

test("\"unset\" always sorts last, after every numbered level present", () => {
  const counts = new Map([["unset", 1], ["1", 2], ["5", 1]]);
  assert.deepEqual(
    buildComplexityBuckets(counts).map((b) => b.label),
    ["C1", "C5", "Unset (→ C1)"],
  );
});

test("empty counts → no buckets at all", () => {
  assert.deepEqual(buildComplexityBuckets(new Map()), []);
});

test("expectedComplexityCounts never has an \"unset\" key in practice, but the function doesn't special-case that away — it just never sees one", () => {
  const counts = new Map([["1", 1], ["2", 1], ["3", 1], ["4", 1], ["5", 1]]);
  const buckets = buildComplexityBuckets(counts);
  assert.equal(buckets.some((b) => b.label.startsWith("Unset")), false);
  assert.equal(buckets.length, 5);
});

// --- complexTasksContribution -------------------------------------------------
// The extraction behind markedComplexityScoreAll/expectedComplexityScoreAll/
// markedComplexityScore/expectedComplexityScore — each is this value pulled
// out of a different population's computeScorecard() result, not the result's
// own .finalScore (the full four-metric composite).

const BASE_INPUTS: ScorecardInputs = {
  features: 0,
  bugsResolvedWeighted: 0,
  weightedBugs: 0,
  mttrMinutesSamples: [],
  sprintNotDelayed: 0,
  sprintTotal: 0,
  complexWeightedTotal: 0,
  complexTotalTasks: 0,
  aiTaskCount: 0,
  totalComplex: 0,
  churn: null,
  effort: null,
};

test("equals weight x points x scale for Complex Tasks alone, not the full composite", () => {
  const result = computeScorecard({ ...BASE_INPUTS, complexWeightedTotal: 150, complexTotalTasks: 20 });
  const expected = WEIGHTS.complexTasks * (result.complexTasksPoints ?? 0) * SCORE_SCALE;
  assert.ok(Math.abs(complexTasksContribution(result) - expected) < 1e-9);
  // Sanity: this is meaningfully less than the full composite whenever the
  // other metrics contribute anything (here, Bug Quality/MTTR/Sprint all
  // default to full marks on no data, so finalScore > this alone).
  assert.ok(complexTasksContribution(result) < result.finalScore);
});

test("zero complexWeightedTotal → zero contribution, not the no-data-defaults-to-5 behavior other metrics get", () => {
  const result = computeScorecard(BASE_INPUTS);
  assert.equal(complexTasksContribution(result), 0);
});

test("matches the same-key entry already exposed on breakdown.metrics — no independent computation, just extraction", () => {
  const result = computeScorecard({ ...BASE_INPUTS, complexWeightedTotal: 42, complexTotalTasks: 5 });
  const fromBreakdown = result.breakdown.metrics.find((m) => m.key === "complexTasks")!.contribution;
  assert.equal(complexTasksContribution(result), fromBreakdown);
});

test("two different populations' results are extracted independently — one doesn't leak into the other", () => {
  const low = computeScorecard({ ...BASE_INPUTS, complexWeightedTotal: 10, complexTotalTasks: 3 });
  const high = computeScorecard({ ...BASE_INPUTS, complexWeightedTotal: 200, complexTotalTasks: 30 });
  assert.notEqual(complexTasksContribution(low), complexTasksContribution(high));
});

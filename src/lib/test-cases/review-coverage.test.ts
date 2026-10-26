// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/review-coverage.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSetStats, CAPS, REVIEW_COVERAGE_SHARE, type AnalyticsCase } from "./analytics";
import { coverageScore, highGaps, summariseFeedback, type FeedbackEvent } from "./feedback-stats";

const c = (code: string): AnalyticsCase => ({
  tab: "Main", tcCode: code, title: `title ${code}`, steps: "1. do", expected: "x happens", priority: "P1", severity: null,
  category: "functional", polarity: "positive", devResult: "pass", testerResult: "pass",
});
const cases = [c("A"), c("B"), c("C"), c("D")];
const ev = (over: Partial<FeedbackEvent>): FeedbackEvent => ({
  roundNo: 1, kind: "comment", source: "llm", authorEmail: "ai-review@flux.local", authorName: "AI review", resolved: false, waived: false, tab: "Main", severity: "medium", ...over,
});
const fbOf = (events: FeedbackEvent[], roundCount = 1) => summariseFeedback({ events, reviewersNow: [], roundCount, latestRoundNo: roundCount });
const stats = (events: FeedbackEvent[], over: Partial<Parameters<typeof computeSetStats>[0]> = {}) =>
  computeSetStats({ cases, roundStatus: "approved", reviewersTotal: 1, reviewersApproved: 1, hasDevSignoff: true, hasTesterSignoff: true, feedback: fbOf(events), roundCount: 1, llmReviewed: true, ...over });

test("a point counts as addressed, open or waived; earlier-round leftovers count as addressed (the resubmission replaced them)", () => {
  const fb = fbOf(
    [
      ev({ roundNo: 2, resolved: true, severity: "high" }), // fixed
      ev({ roundNo: 2, severity: "high" }), // open now
      ev({ roundNo: 2, resolved: true, waived: true, severity: "low" }), // waived by override
      ev({ roundNo: 1, severity: "medium" }), // old round, still unresolved there
    ],
    2,
  );
  assert.deepEqual(fb.coverage!.addressed, { high: 1, medium: 1, low: 0 });
  assert.deepEqual(fb.coverage!.open, { high: 1, medium: 0, low: 0 });
  assert.deepEqual(fb.coverage!.waived, { high: 0, medium: 0, low: 1 });
  assert.equal(highGaps(fb.coverage!), 1);
  // weights high 3, medium 2, low 1: addressed 5 of 9
  assert.equal(coverageScore(fb.coverage!), 56);
});

test("nothing raised: no score from the feedback alone", () => {
  assert.equal(coverageScore(fbOf([]).coverage!), null);
});

test("quality drops when AI findings are open or waived, and a waiver does not make the gap disappear", () => {
  const structural = stats([], { llmReviewed: false }).quality; // the sheet's structure alone
  const clean = stats([]);
  assert.equal(clean.qualityComponents.reviewCoverage, 100);
  assert.equal(clean.quality, Math.round(((100 - REVIEW_COVERAGE_SHARE) * structural + REVIEW_COVERAGE_SHARE * 100) / 100));

  const open = stats([ev({ severity: "high" }), ev({ severity: "high" }), ev({ severity: "medium" })]);
  const waived = stats([ev({ resolved: true, waived: true, severity: "high" }), ev({ resolved: true, waived: true, severity: "high" }), ev({ resolved: true, waived: true, severity: "medium" })]);
  assert.equal(open.qualityComponents.reviewCoverage, 0);
  assert.equal(open.quality, Math.round(((100 - REVIEW_COVERAGE_SHARE) * structural) / 100));
  assert.ok(open.quality < clean.quality);
  assert.equal(waived.quality, open.quality);

  const fixed = stats([ev({ resolved: true, severity: "high" }), ev({ resolved: true, severity: "high" }), ev({ resolved: true, severity: "medium" })]);
  assert.equal(fixed.quality, clean.quality);
});

test("a high-severity gap caps delivery confidence; fixing it lifts the cap", () => {
  const gap = stats([ev({ resolved: true, waived: true, severity: "high" })]);
  assert.ok(gap.confidence <= CAPS.highReviewGap);
  assert.ok(gap.confidenceCaps.some((w) => /high-severity review point is still open or waived/.test(w)));
  assert.notEqual(gap.readiness, "ready");

  const medium = stats([ev({ severity: "medium" })]);
  assert.ok(!medium.confidenceCaps.some((w) => /high-severity/.test(w)));

  const fixed = stats([ev({ resolved: true, severity: "high" })]);
  assert.ok(!fixed.confidenceCaps.some((w) => /high-severity/.test(w)));
  assert.equal(fixed.readiness, "ready");
});

test("never reviewed (no AI run, no feedback): coverage is unknown and does not change quality", () => {
  const st = stats([], { llmReviewed: false });
  assert.equal(st.qualityComponents.reviewCoverage, null);
  assert.equal(st.qualityComponents.reviewCoverageShare, 0);
  assert.equal(st.quality, st.qualityComponents.structural);
});

test("a reviewer's comment (no rating) weighs as medium", () => {
  const fb = fbOf([ev({ source: "reviewer", severity: null })]);
  assert.equal(fb.coverage!.open.medium, 1);
});

test("the AI review and the human reviewers each count for their part of the quality estimate", () => {
  const structural = stats([], { llmReviewed: false }).quality;
  // only the AI review raised points: it carries the whole share
  const aiOnly = stats([ev({ severity: "high" })]);
  assert.equal(aiOnly.qualityComponents.aiShare, REVIEW_COVERAGE_SHARE);
  assert.equal(aiOnly.qualityComponents.reviewerCoverage, null);
  // both raised points: AI 20, reviewers 10; AI fixed, reviewers' open
  const both = stats([ev({ resolved: true, severity: "high" }), ev({ source: "reviewer", severity: null })]);
  assert.deepEqual([both.qualityComponents.aiShare, both.qualityComponents.reviewerShare], [20, 10]);
  assert.deepEqual([both.qualityComponents.aiCoverage, both.qualityComponents.reviewerCoverage], [100, 0]);
  assert.equal(both.quality, Math.round((70 * structural + 20 * 100 + 10 * 0) / 100));
});

test("AI review stats: findings by severity, how they stand, and by kind", () => {
  const fb = fbOf([
    ev({ severity: "high", category: "missing_coverage" }),
    ev({ severity: "medium", category: "missing_coverage", resolved: true }),
    ev({ severity: "low", category: "duplicate", resolved: true, waived: true }),
    ev({ source: "reviewer", severity: null }), // not an AI finding
    ev({ kind: "changes_requested" }), // the AI's summary entry, not a finding
  ]);
  const ai = fb.ai!;
  assert.deepEqual([ai.findings, ai.fixed, ai.open, ai.waived], [3, 1, 1, 1]);
  assert.deepEqual(ai.bySeverity, { high: 1, medium: 1, low: 1 });
  assert.deepEqual(ai.categories, [
    { category: "missing_coverage", total: 2, notFixed: 1 },
    { category: "duplicate", total: 1, notFixed: 1 },
  ]);
});

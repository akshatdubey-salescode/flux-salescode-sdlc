// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/followups.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSetStats, type AnalyticsCase } from "./analytics";
import { summariseFeedback, type FeedbackEvent } from "./feedback-stats";
import { buildPreview } from "./preview";
import { parseTabs } from "./multi-tab";
import { toSummary } from "./summary";

const ev = (over: Partial<FeedbackEvent>): FeedbackEvent => ({
  roundNo: 1, kind: "comment", source: "llm", authorEmail: "ai-review@flux.local", authorName: "AI review", resolved: false, waived: false, tab: "Main", severity: "medium", ...over,
});
const cases: AnalyticsCase[] = [1, 2].map((i) => ({
  tab: "Main", tcCode: `TC_${i}`, title: `t${i}`, steps: "s", expected: "e", priority: "P1", severity: null, category: "functional", polarity: "positive", devResult: null, testerResult: null,
}));
const stats = (events: FeedbackEvent[]) =>
  computeSetStats({ cases, roundStatus: "in_review", reviewersTotal: 1, reviewersApproved: 0, hasDevSignoff: false, hasTesterSignoff: false, roundCount: 1, llmReviewed: true,
    feedback: summariseFeedback({ events, reviewersNow: [], roundCount: 1, latestRoundNo: 1 }) });

test("the hover summary tells how many AI findings are fixed, and how many are open or waived by severity", () => {
  const s = toSummary("set", 1, stats([
    ev({ severity: "high" }), ev({ severity: "high" }), ev({ severity: "low" }),
    ev({ severity: "medium", resolved: true }), ev({ severity: "high", resolved: true, waived: true }),
    ev({ source: "reviewer", severity: null }), // a person's comment is not an AI finding
  ]));
  assert.deepEqual(s.ai, { findings: 5, fixed: 1, open: { high: 2, medium: 0, low: 1 }, waived: { high: 1, medium: 0, low: 0 } });
});

test("no AI findings: the summary says zero findings; no AI numbers stored: null", () => {
  assert.equal(toSummary("set", 1, stats([])).ai?.findings, 0);
  const old = stats([]);
  delete (old.feedback as { aiCoverage?: unknown }).aiCoverage;
  assert.equal(toSummary("set", 1, old).ai, null);
});

const BASE = ["Test Case ID", "TC Classification", "TC Type", "Test Case Description", "Test Steps", "Expected Result"];
const row = (id: string, dev: string, tester: string) => [id, "Positive", "Functional", `Scenario ${id}`, "1. do", "ok", dev, tester];

test("the preview counts results typed in the sheet, so the page can say they are not counted until sign-off", () => {
  const parsed = parseTabs([{ title: "T", grid: [[...BASE, "Dev Status", "Tester Status"], row("A", "Passed", ""), row("B", "", "Failed"), row("C", "Not Executed", "Not Executed")] }], { uncapped: true });
  const p = buildPreview(parsed);
  assert.ok(p.ok);
  assert.deepEqual(p.sheetStatus, { dev: 1, tester: 1 });
});

test("sheet statuses pass through the stats unchanged and never become results", () => {
  const sheet = { dev: { pass: 2, fail: 0, blocked: 0, not_run: 0, total: 2 }, tester: { pass: 0, fail: 0, blocked: 0, not_run: 2, total: 2 } };
  const s = computeSetStats({ cases, roundStatus: "in_review", reviewersTotal: 1, reviewersApproved: 0, hasDevSignoff: false, hasTesterSignoff: false, roundCount: 1, sheetStatus: sheet,
    feedback: summariseFeedback({ events: [], reviewersNow: [], roundCount: 1, latestRoundNo: 1 }) });
  assert.deepEqual(s.sheetStatus, sheet);
  assert.equal(s.executedPct, 0);
  assert.equal(s.effective.pass, 0);
});

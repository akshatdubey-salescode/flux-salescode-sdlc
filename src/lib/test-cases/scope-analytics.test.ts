// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/scope-analytics.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSetStats, type AnalyticsCase } from "./analytics";
import { EMPTY_FEEDBACK, summariseFeedback, type FeedbackEvent } from "./feedback-stats";
import type { RoundScope } from "./scope";

const c = (tab: string, code: string, over: Partial<AnalyticsCase> = {}): AnalyticsCase => ({
  tab, tcCode: code, title: `title ${code}`, steps: "1. do", expected: "x happens", priority: "P1", severity: null,
  category: "functional", polarity: "positive", devResult: null, testerResult: null, ...over,
});
const base = { roundStatus: "in_review" as const, reviewersTotal: 1, reviewersApproved: 0, hasDevSignoff: true, hasTesterSignoff: false, feedback: EMPTY_FEEDBACK, roundCount: 1 };

test("results are broken out per tab, and the scope says how much of the tabs this item claims", () => {
  const cases = [c("Main", "A1", { devResult: "pass" }), c("Main", "A2", { devResult: "fail" }), c("Extra", "E1", { devResult: "pass" })];
  const scope: RoundScope = {
    defaulted: false,
    skipped: [],
    tabs: [
      { tab: "Main", rows: "12-13", ranges: [[12, 13]], gid: 1, totalInTab: 40, inScope: 2, firstId: "A1", lastId: "A2", firstRow: 12, lastRow: 13 },
      { tab: "Extra", rows: null, ranges: null, gid: 2, totalInTab: 1, inScope: 1, firstId: "E1", lastId: "E1", firstRow: 3, lastRow: 3 },
    ],
  };
  const st = computeSetStats({ ...base, cases, scope });
  assert.equal(st.tcCount, 3);
  assert.deepEqual(Object.keys(st.tabSplit ?? {}).sort(), ["Extra", "Main"]);
  assert.deepEqual([st.tabSplit!.Main.total, st.tabSplit!.Main.effective.pass, st.tabSplit!.Main.effective.fail], [2, 1, 1]);
  assert.deepEqual([st.tabSplit!.Extra.total, st.tabSplit!.Extra.effective.pass], [1, 1]);
  assert.deepEqual([st.scope!.inScope, st.scope!.totalInTabs, st.scope!.coveragePct], [3, 41, 7]);
  assert.equal(st.scope!.tabs.find((t) => t.tab === "Main")!.rows, "12-13");
});

test("an older round (no stored scope) is described as every row of the tabs its cases came from", () => {
  const st = computeSetStats({ ...base, cases: [c("Main", "A1"), c("Main", "A2")], scope: null });
  assert.deepEqual(st.scope, { defaulted: false, tabs: [{ tab: "Main", rows: null, inScope: 2, totalInTab: 2 }], inScope: 2, totalInTabs: 2, coveragePct: 100 });
});

test("feedback is counted per tab: comments, open on the latest round, resolved, waived and AI findings", () => {
  const ev = (over: Partial<FeedbackEvent>): FeedbackEvent => ({ roundNo: 2, kind: "comment", source: "reviewer", authorEmail: "a@x.com", authorName: "A", resolved: false, waived: false, tab: "Main", ...over });
  const fb = summariseFeedback({
    events: [
      ev({}), // open, Main
      ev({ resolved: true }), // resolved, Main
      ev({ resolved: true, waived: true, tab: "Extra" }), // waived, Extra
      ev({ source: "llm", tab: "Extra" }), // AI finding, open, Extra
      ev({ roundNo: 1 }), // earlier round, still unresolved there: counted, not open now
      ev({ tab: null }), // round-level: not part of any tab
      ev({ kind: "changes_requested", tab: null }),
    ],
    reviewersNow: [],
    roundCount: 2,
    latestRoundNo: 2,
  });
  const main = fb.byTab!.find((t) => t.tab === "Main")!;
  const extra = fb.byTab!.find((t) => t.tab === "Extra")!;
  assert.deepEqual([main.comments, main.open, main.resolved, main.waived, main.ai], [3, 1, 1, 0, 0]);
  assert.deepEqual([extra.comments, extra.open, extra.resolved, extra.waived, extra.ai], [2, 1, 0, 1, 1]);
  // Feedback that is not about one test case is shown as its own row so the rows add up to the comment total.
  const whole = fb.byTab!.find((t) => t.tab === "(whole round)")!;
  assert.deepEqual([whole.comments, whole.open], [1, 1]);
  assert.equal(fb.byTab!.length, 3);
});

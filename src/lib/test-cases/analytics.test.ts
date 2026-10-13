// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/analytics.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPS,
  CHANGES_REQUESTED_PENALTY,
  QUALITY_WEIGHTS,
  computeSetStats,
  deliveryReadiness,
  effectiveResult,
  executionScore,
  structuralQuality,
  uniquenessScore,
  type AnalyticsCase,
  type SetInput,
} from "./analytics";
import type { TcResult } from "./values";

const tc = (over: Partial<AnalyticsCase> = {}): AnalyticsCase => ({
  tcCode: "TC_001",
  title: "Login with valid credentials",
  steps: "1. open app 2. enter valid user and password 3. submit",
  expected: "user lands on the home page",
  priority: "P1",
  severity: "critical",
  category: "functional",
  polarity: "positive",
  devResult: null,
  testerResult: null,
  ...over,
});

const set = (cases: AnalyticsCase[], over: Partial<SetInput> = {}): SetInput => ({
  cases,
  roundStatus: "approved",
  reviewersTotal: 1,
  reviewersApproved: 1,
  hasDevSignoff: false,
  hasTesterSignoff: false,
  feedbackTotal: 0,
  feedbackOpen: 0,
  roundCount: 1,
  ...over,
});

/** Distinct enough that they are never counted as duplicates. */
const distinct = (n: number, over: (i: number) => Partial<AnalyticsCase> = () => ({})): AnalyticsCase[] =>
  Array.from({ length: n }, (_, i) =>
    tc({ tcCode: `TC_${i + 1}`, title: `scenario number${i} alpha${i * 7} beta${i * 13}`, steps: `step${i} gamma${i * 3} delta${i * 11} run${i}`, ...over(i) }),
  );

test("effective result: a fail wins, then blocked, then a pass; unsigned roles contribute nothing", () => {
  const cases: [TcResult | null, TcResult | null, TcResult][] = [
    [null, null, "not_run"],
    ["not_run", "not_run", "not_run"],
    ["pass", null, "pass"],
    [null, "pass", "pass"],
    ["pass", "pass", "pass"],
    ["pass", "fail", "fail"],
    ["fail", "pass", "fail"],
    ["blocked", "pass", "blocked"],
    ["blocked", "fail", "fail"],
    ["pass", "not_run", "pass"],
  ];
  for (const [d, t, want] of cases) assert.equal(effectiveResult(d, t), want, `${d}/${t}`);
});

test("execution score weights by priority, so a failed P1 costs more than a failed P3", () => {
  const base = [tc({ priority: "P1" }), tc({ priority: "P3" })];
  assert.equal(executionScore([]), 0);
  assert.equal(executionScore(base), 0, "nothing signed off");
  assert.equal(executionScore(base.map((c) => ({ ...c, devResult: "pass" as const }))), 100);
  // P1 (3) passes, P3 (1) fails: 3 / 4
  assert.equal(executionScore([{ ...base[0], devResult: "pass" }, { ...base[1], devResult: "fail" }]), 75);
  // P3 passes, P1 fails: 1 / 4
  assert.equal(executionScore([{ ...base[0], devResult: "fail" }, { ...base[1], devResult: "pass" }]), 25);
  assert.equal(executionScore([{ ...base[0], devResult: "blocked" }, { ...base[1], devResult: "pass" }]), 25, "blocked counts as zero");
});

test("quality weights add up to 100", () => {
  assert.equal(Object.values(QUALITY_WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test("a complete, varied, unique set scores high; an empty one scores zero", () => {
  const good = distinct(10, (i) => ({
    polarity: i % 3 === 0 ? "negative" : i % 5 === 0 ? "edge" : "positive",
    priority: i % 2 ? "P1" : "P2",
  }));
  const q = structuralQuality(good);
  assert.equal(q.completeness, 100);
  assert.equal(q.uniqueness, 100);
  assert.equal(q.idHygiene, 100);
  assert.ok(q.structural >= 90, `structural ${q.structural}`);
  assert.deepEqual(structuralQuality([]), { completeness: 0, diversity: 0, priorityCoverage: 0, uniqueness: 0, idHygiene: 0, structural: 0 });
});

test("completeness drops when steps, expected result or priority are missing", () => {
  const cases = distinct(4, (i) => (i === 0 ? { steps: "" } : i === 1 ? { expected: "" } : i === 2 ? { priority: null } : {}));
  assert.equal(structuralQuality(cases).completeness, 25);
});

test("diversity: a happy-path-only set is weak, negative + edge coverage lifts it, unknown polarity falls back to categories", () => {
  const happy = structuralQuality(distinct(10)).diversity;
  assert.equal(happy, 0);
  const withNeg = structuralQuality(distinct(10, (i) => ({ polarity: i < 2 ? "negative" : "positive" }))).diversity;
  assert.equal(withNeg, 70, "negative present (40) + 20% non-positive (30)");
  const withBoundary = structuralQuality(distinct(10, (i) => ({ category: i === 0 ? "boundary" : "functional" }))).diversity;
  assert.equal(withBoundary, 30, "boundary counts as edge coverage");
  const noPolarity = structuralQuality(distinct(6, (i) => ({ polarity: null, category: (["functional", "ui", "api"] as const)[i % 3] }))).diversity;
  assert.equal(noPolarity, 100, "three categories");
});

test("near-duplicate cases are penalised", () => {
  const dup = [
    tc({ tcCode: "A", title: "verify the cart total updates", steps: "add item then check the cart total" }),
    tc({ tcCode: "B", title: "verify the cart total updates", steps: "add item then check the cart total" }),
    tc({ tcCode: "C", title: "export report to excel", steps: "open reports choose export pick excel download" }),
  ];
  assert.equal(Math.round(uniquenessScore(dup)), 67, "one of three is a duplicate");
  assert.equal(uniquenessScore(distinct(5)), 100);
  assert.equal(uniquenessScore([]), 0);
});

test("priority coverage rewards having P1s and a spread", () => {
  assert.equal(structuralQuality(distinct(4, () => ({ priority: "P1" }))).priorityCoverage, 70, "P1 (50) + all set (20), single priority");
  assert.equal(structuralQuality(distinct(4, (i) => ({ priority: i % 2 ? "P1" : "P2" }))).priorityCoverage, 100);
  assert.equal(structuralQuality(distinct(4, () => ({ priority: "P3" }))).priorityCoverage, 20);
});

test("confidence caps and readiness, table-driven", () => {
  const base = { tcCount: 10, quality: 90, execution: 90, roundApproved: true, signoffs: 2, failedHighRisk: false, blockedP1: false, anyFail: false };
  const rows: [string, Partial<typeof base>, number, string][] = [
    ["everything good", {}, 90, "ready"],
    ["no sign-off caps hard", { signoffs: 0 }, CAPS.noSignoff, "not_recommended"],
    ["one sign-off caps at 85", { signoffs: 1, quality: 100, execution: 100 }, CAPS.oneSignoff, "ready"],
    ["not approved caps at 50", { roundApproved: false }, CAPS.notApproved, "not_recommended"],
    ["failed P1/critical caps at 40 and blocks", { failedHighRisk: true, anyFail: true }, CAPS.failedP1OrCritical, "blocked"],
    ["blocked P1 caps at 60", { blockedP1: true }, CAPS.blockedP1, "risk"],
    ["a non-critical fail stops 'ready'", { anyFail: true }, 90, "risk"],
    ["low scores are not recommended", { quality: 40, execution: 40 }, 40, "not_recommended"],
    ["mid scores are risky", { quality: 70, execution: 70 }, 70, "risk"],
  ];
  for (const [name, over, confidence, readiness] of rows) {
    const r = deliveryReadiness({ ...base, ...over });
    assert.equal(r.confidence, confidence, `${name}: confidence`);
    assert.equal(r.readiness, readiness, `${name}: readiness`);
  }
  assert.deepEqual(deliveryReadiness({ ...base, tcCount: 0 }), { confidence: 0, caps: [], readiness: "not_started" });
  assert.deepEqual(deliveryReadiness({ ...base, signoffs: 0 }).caps, ["No dev or tester sign-off yet"]);
});

test("a full set: before sign-off it is capped; after both sign off with all passing it is ready", () => {
  const cases = distinct(10, (i) => ({ polarity: i % 3 === 0 ? "negative" : i % 5 === 0 ? "edge" : "positive", priority: i % 2 ? "P1" : "P2", severity: "high" }));
  const before = computeSetStats(set(cases));
  assert.equal(before.readiness, "not_recommended");
  assert.ok(before.confidence <= CAPS.noSignoff);
  assert.equal(before.effective.not_run, 10);
  assert.equal(before.executedPct, 0);

  const signed = cases.map((c) => ({ ...c, devResult: "pass" as const, testerResult: "pass" as const }));
  const after = computeSetStats(set(signed, { hasDevSignoff: true, hasTesterSignoff: true }));
  assert.equal(after.readiness, "ready");
  assert.equal(after.executionScore, 100);
  assert.equal(after.passRate, 100);
  assert.equal(after.executedPct, 100);
  assert.ok(after.confidence >= 85);
  assert.equal(after.dev.pass, 10);
  assert.equal(after.dev.signedOff, true);
  assert.equal(after.tester.signedOff, true);
});

test("a failed P1 blocks delivery; a pending change request lowers quality", () => {
  const cases = distinct(4, (i) => ({ priority: i === 0 ? "P1" : "P2", severity: "high" })).map((c, i) => ({
    ...c,
    devResult: (i === 0 ? "fail" : "pass") as TcResult,
  }));
  const s = computeSetStats(set(cases, { hasDevSignoff: true }));
  assert.equal(s.readiness, "blocked");
  assert.ok(s.confidence <= CAPS.failedP1OrCritical);
  assert.ok(s.confidenceCaps.some((c) => /P1 or critical/.test(c)));
  assert.equal(s.effective.fail, 1);

  const ok = computeSetStats(set(distinct(4)));
  const changes = computeSetStats(set(distinct(4), { roundStatus: "changes_requested" }));
  assert.equal(ok.quality - changes.quality, CHANGES_REQUESTED_PENALTY);
  assert.equal(changes.qualityComponents.changesRequestedPenalty, CHANGES_REQUESTED_PENALTY);
  assert.equal(ok.qualityComponents.basis, "estimated");
  assert.equal(ok.llmReviewed, false);
});

test("splits count every case once per dimension, with per-role and effective results", () => {
  const cases = [
    tc({ tcCode: "A", category: "functional", polarity: "positive", priority: "P1", devResult: "pass", testerResult: "fail" }),
    tc({ tcCode: "B", category: "functional", polarity: "negative", priority: "P2", devResult: "pass", testerResult: null }),
    tc({ tcCode: "C", category: "ui", polarity: null, priority: null, devResult: null, testerResult: null }),
  ];
  const s = computeSetStats(set(cases, { hasDevSignoff: true, hasTesterSignoff: true }));
  assert.equal(s.categorySplit.functional?.total, 2);
  assert.deepEqual(s.categorySplit.functional?.effective, { pass: 1, fail: 1, blocked: 0, not_run: 0, total: 2 });
  assert.equal(s.categorySplit.functional?.dev.pass, 2);
  assert.equal(s.categorySplit.functional?.tester.fail, 1);
  assert.equal(s.polaritySplit.unspecified?.total, 1);
  assert.equal(s.prioritySplit.none?.total, 1);
  assert.equal(s.prioritySplit.P1?.effective.fail, 1);
  assert.equal(Object.values(s.categorySplit).reduce((a, r) => a + r.total, 0), 3);
});

test("an empty set is 'not started' with zeroed numbers", () => {
  const s = computeSetStats(set([]));
  assert.equal(s.readiness, "not_started");
  assert.equal(s.confidence, 0);
  assert.equal(s.quality, 0);
  assert.equal(s.executedPct, 0);
});

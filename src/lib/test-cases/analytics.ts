// All Test Case analytics in one pure module: per-case effective result, type
// splits, a structural quality estimate, an execution score, and the delivery
// confidence/readiness shown on Sprint and Delivery rows. Persisted once per
// set (tc_set_stats) so every surface reads the same numbers. Weights and
// thresholds are the constants below — change them here, nowhere else.

import type { FeedbackSummary } from "./feedback-stats";
import type { TcCategory, TcPolarity, TcPriority, TcResult, TcRoundStatus, TcSeverity } from "./values";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Structural quality: component weights (sum 100). */
export const QUALITY_WEIGHTS = { completeness: 30, diversity: 25, priorityCoverage: 15, uniqueness: 20, idHygiene: 10 } as const;
/** Two cases whose title+steps token sets overlap at least this much count as near-duplicates. */
export const DUPLICATE_SIMILARITY = 0.85;
/** Share of non-positive (negative/edge) cases that counts as "well covered". */
export const NON_POSITIVE_TARGET = 0.2;
/** Priority weights for the execution score: failing a P1 costs more than a P3. */
export const PRIORITY_WEIGHT: Record<TcPriority | "none", number> = { P1: 3, P2: 2, P3: 1, P4: 1, none: 1 };
/** confidence = QUALITY_SHARE * quality + EXECUTION_SHARE * execution, then caps. */
export const CONFIDENCE_MIX = { quality: 0.4, execution: 0.6 } as const;
/** Hard caps on confidence. */
export const CAPS = {
  noSignoff: 35,
  oneSignoff: 85,
  notApproved: 50,
  failedP1OrCritical: 40,
  blockedP1: 60,
} as const;
/** Quality penalty while a reviewer's change request is outstanding. */
export const CHANGES_REQUESTED_PENALTY = 10;
export const READY_AT = 85;
export const RISK_AT = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnalyticsCase = {
  tcCode: string;
  title: string;
  steps: string;
  expected: string;
  priority: TcPriority | null;
  severity: TcSeverity | null;
  category: TcCategory;
  polarity: TcPolarity | null;
  /** Latest dev / tester sign-off result for this case; null = that role has not signed off. */
  devResult: TcResult | null;
  testerResult: TcResult | null;
};

export type ResultCounts = { pass: number; fail: number; blocked: number; not_run: number; total: number };

export type TypeRow = { total: number; effective: ResultCounts; dev: ResultCounts; tester: ResultCounts };

export type Readiness = "not_started" | "blocked" | "not_recommended" | "risk" | "ready";

export const READINESS_LABELS: Record<Readiness, string> = {
  not_started: "No TCs",
  blocked: "Blocked",
  not_recommended: "Not recommended",
  risk: "Deliver with risk",
  ready: "Ready to deliver",
};

export type QualityComponents = {
  completeness: number;
  diversity: number;
  priorityCoverage: number;
  uniqueness: number;
  idHygiene: number;
  /** Quality before any reviewer penalty. */
  structural: number;
  changesRequestedPenalty: number;
  /** Always "estimated" until the LLM review exists. */
  basis: "estimated";
};

export type SetInput = {
  cases: AnalyticsCase[];
  roundStatus: TcRoundStatus;
  reviewersTotal: number;
  reviewersApproved: number;
  hasDevSignoff: boolean;
  hasTesterSignoff: boolean;
  /** Everything the review has produced, across all rounds. */
  feedback: FeedbackSummary;
  roundCount: number;
};

/** One point per round for the "rounds compared" chart. Past rounds can't change, so each is computed once and stored. */
export type RoundTrendPoint = {
  roundNo: number;
  tcCount: number;
  quality: number;
  passRate: number;
  confidence: number;
  status: string;
};

export type SetStats = {
  tcCount: number;
  categorySplit: Partial<Record<TcCategory, TypeRow>>;
  polaritySplit: Partial<Record<TcPolarity | "unspecified", TypeRow>>;
  prioritySplit: Partial<Record<TcPriority | "none", TypeRow>>;
  dev: ResultCounts & { signedOff: boolean };
  tester: ResultCounts & { signedOff: boolean };
  effective: ResultCounts;
  executedPct: number;
  passRate: number;
  reviewersTotal: number;
  reviewersApproved: number;
  roundStatus: TcRoundStatus;
  roundCount: number;
  /** Feedback raised (comments + change requests, all rounds) and still open (unresolved comments + standing change requests). */
  feedbackTotal: number;
  feedbackOpen: number;
  feedback: FeedbackSummary;
  quality: number;
  qualityComponents: QualityComponents;
  executionScore: number;
  confidence: number;
  confidenceCaps: string[];
  readiness: Readiness;
  llmReviewed: boolean;
  /** Filled in when the stats are stored (see recomputeSetStats); absent on rows from before it existed. */
  trend?: RoundTrendPoint[];
};

// ---------------------------------------------------------------------------
// Per-case result
// ---------------------------------------------------------------------------

/**
 * The result that counts for a case across both roles: any fail wins, then any
 * blocked, then a pass (at least one role passed and none objected); otherwise
 * not run. A role that has not signed off contributes nothing.
 */
export function effectiveResult(dev: TcResult | null, tester: TcResult | null): TcResult {
  const given = [dev, tester].filter((r): r is TcResult => r !== null && r !== "not_run");
  if (given.includes("fail")) return "fail";
  if (given.includes("blocked")) return "blocked";
  if (given.includes("pass")) return "pass";
  return "not_run";
}

function emptyCounts(): ResultCounts {
  return { pass: 0, fail: 0, blocked: 0, not_run: 0, total: 0 };
}

function addResult(c: ResultCounts, r: TcResult | null) {
  c[r ?? "not_run"]++;
  c.total++;
}

function emptyRow(): TypeRow {
  return { total: 0, effective: emptyCounts(), dev: emptyCounts(), tester: emptyCounts() };
}

function addToRow(row: TypeRow, c: AnalyticsCase) {
  row.total++;
  addResult(row.effective, effectiveResult(c.devResult, c.testerResult));
  addResult(row.dev, c.devResult);
  addResult(row.tester, c.testerResult);
}

// ---------------------------------------------------------------------------
// Quality (structural estimate)
// ---------------------------------------------------------------------------

const clamp = (n: number) => Math.max(0, Math.min(100, n));

function tokens(c: AnalyticsCase): Set<string> {
  return new Set(
    `${c.title} ${c.steps}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Share of cases that are NOT a near-duplicate of an earlier case, as 0-100. */
export function uniquenessScore(cases: AnalyticsCase[]): number {
  if (cases.length === 0) return 0;
  const sets = cases.map(tokens);
  let dupes = 0;
  for (let i = 1; i < sets.length; i++) {
    if (sets[i].size === 0) continue;
    for (let j = 0; j < i; j++) {
      if (jaccard(sets[i], sets[j]) >= DUPLICATE_SIMILARITY) {
        dupes++;
        break;
      }
    }
  }
  return clamp(100 * (1 - dupes / cases.length));
}

const WELL_FORMED_ID = /^[A-Za-z0-9][A-Za-z0-9_.\-/ ]{0,39}$/;

export function structuralQuality(cases: AnalyticsCase[]): Omit<QualityComponents, "changesRequestedPenalty" | "basis"> {
  const n = cases.length;
  if (n === 0) return { completeness: 0, diversity: 0, priorityCoverage: 0, uniqueness: 0, idHygiene: 0, structural: 0 };

  const completeness = (100 * cases.filter((c) => c.title.trim() && c.steps.trim() && c.expected.trim() && c.priority).length) / n;

  // Diversity: negative and edge/boundary coverage, and enough non-happy-path cases.
  const known = cases.filter((c) => c.polarity !== null);
  let diversity: number;
  if (known.length > 0) {
    const hasNegative = cases.some((c) => c.polarity === "negative");
    const hasEdge = cases.some((c) => c.polarity === "edge" || ["boundary", "validation", "data_validation"].includes(c.category));
    const nonPositive = cases.filter((c) => c.polarity === "negative" || c.polarity === "edge").length / n;
    diversity = (hasNegative ? 40 : 0) + (hasEdge ? 30 : 0) + Math.min(1, nonPositive / NON_POSITIVE_TARGET) * 30;
  } else {
    const distinct = new Set(cases.map((c) => c.category).filter((c) => c !== "unspecified")).size;
    diversity = distinct >= 3 ? 100 : distinct === 2 ? 66 : distinct === 1 ? 33 : 0;
  }

  const prios = new Set(cases.map((c) => c.priority).filter((p): p is TcPriority => p !== null));
  const priorityCoverage =
    (prios.has("P1") ? 50 : 0) + (prios.size >= 2 ? 30 : 0) + 20 * (cases.filter((c) => c.priority).length / n);

  const uniqueness = uniquenessScore(cases);
  const idHygiene = (100 * cases.filter((c) => WELL_FORMED_ID.test(c.tcCode.trim())).length) / n;

  const w = QUALITY_WEIGHTS;
  const structural =
    (w.completeness * clamp(completeness) +
      w.diversity * clamp(diversity) +
      w.priorityCoverage * clamp(priorityCoverage) +
      w.uniqueness * uniqueness +
      w.idHygiene * clamp(idHygiene)) /
    100;

  return {
    completeness: Math.round(clamp(completeness)),
    diversity: Math.round(clamp(diversity)),
    priorityCoverage: Math.round(clamp(priorityCoverage)),
    uniqueness: Math.round(uniqueness),
    idHygiene: Math.round(clamp(idHygiene)),
    structural: Math.round(clamp(structural)),
  };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** Priority-weighted pass share, 0-100. Fail, blocked and not-run all count as zero. */
export function executionScore(cases: AnalyticsCase[]): number {
  let total = 0;
  let passed = 0;
  for (const c of cases) {
    const w = PRIORITY_WEIGHT[c.priority ?? "none"];
    total += w;
    if (effectiveResult(c.devResult, c.testerResult) === "pass") passed += w;
  }
  return total === 0 ? 0 : Math.round((100 * passed) / total);
}

// ---------------------------------------------------------------------------
// Confidence and readiness
// ---------------------------------------------------------------------------

export function deliveryReadiness(args: {
  tcCount: number;
  quality: number;
  execution: number;
  roundApproved: boolean;
  /** Why the round is not approved, for the cap's explanation. */
  notApprovedWhy?: string;
  signoffs: number;
  failedHighRisk: boolean;
  blockedP1: boolean;
  anyFail: boolean;
}): { confidence: number; caps: string[]; readiness: Readiness } {
  if (args.tcCount === 0) return { confidence: 0, caps: [], readiness: "not_started" };

  let confidence = Math.round(CONFIDENCE_MIX.quality * args.quality + CONFIDENCE_MIX.execution * args.execution);
  const caps: string[] = [];
  const cap = (limit: number, why: string) => {
    if (confidence > limit) {
      confidence = limit;
      caps.push(why);
    }
  };
  if (args.signoffs === 0) cap(CAPS.noSignoff, "No dev or tester sign-off yet");
  else if (args.signoffs === 1) cap(CAPS.oneSignoff, "Only one of dev / tester has signed off");
  if (!args.roundApproved) cap(CAPS.notApproved, args.notApprovedWhy ?? "Test cases not approved by a reviewer");
  if (args.failedHighRisk) cap(CAPS.failedP1OrCritical, "A P1 or critical test case failed");
  if (args.blockedP1) cap(CAPS.blockedP1, "A P1 test case is blocked");

  let readiness: Readiness;
  if (args.failedHighRisk) readiness = "blocked";
  else if (confidence >= READY_AT && args.signoffs > 0 && !args.anyFail) readiness = "ready";
  else if (confidence >= RISK_AT) readiness = "risk";
  else readiness = "not_recommended";
  return { confidence, caps, readiness };
}

// ---------------------------------------------------------------------------
// Everything for one set
// ---------------------------------------------------------------------------

export function computeSetStats(input: SetInput): SetStats {
  const { cases } = input;
  const categorySplit: SetStats["categorySplit"] = {};
  const polaritySplit: SetStats["polaritySplit"] = {};
  const prioritySplit: SetStats["prioritySplit"] = {};
  const dev = emptyCounts();
  const tester = emptyCounts();
  const effective = emptyCounts();

  for (const c of cases) {
    addToRow((categorySplit[c.category] ??= emptyRow()), c);
    addToRow((polaritySplit[c.polarity ?? "unspecified"] ??= emptyRow()), c);
    addToRow((prioritySplit[c.priority ?? "none"] ??= emptyRow()), c);
    addResult(dev, c.devResult);
    addResult(tester, c.testerResult);
    addResult(effective, effectiveResult(c.devResult, c.testerResult));
  }

  const n = cases.length;
  const structural = structuralQuality(cases);
  const penalty = input.roundStatus === "changes_requested" ? CHANGES_REQUESTED_PENALTY : 0;
  const quality = n === 0 ? 0 : Math.max(0, structural.structural - penalty);
  const execution = executionScore(cases);

  const effectiveResults = cases.map((c) => ({ c, r: effectiveResult(c.devResult, c.testerResult) }));
  const failedHighRisk = effectiveResults.some(({ c, r }) => r === "fail" && (c.priority === "P1" || c.severity === "critical"));
  const blockedP1 = effectiveResults.some(({ c, r }) => r === "blocked" && c.priority === "P1");

  const fb = input.feedback;
  const notApprovedWhy =
    input.roundStatus === "changes_requested"
      ? "Reviewer changes are outstanding: resubmit the test cases"
      : fb.awaitingReReview > 0
        ? "A reviewer who asked for changes has not re-reviewed the resubmission"
        : undefined;
  const verdict = deliveryReadiness({
    tcCount: n,
    quality,
    execution,
    roundApproved: input.roundStatus === "approved",
    notApprovedWhy,
    signoffs: Number(input.hasDevSignoff) + Number(input.hasTesterSignoff),
    failedHighRisk,
    blockedP1,
    anyFail: effective.fail > 0,
  });

  const executed = effective.pass + effective.fail + effective.blocked;
  return {
    tcCount: n,
    categorySplit,
    polaritySplit,
    prioritySplit,
    dev: { ...dev, signedOff: input.hasDevSignoff },
    tester: { ...tester, signedOff: input.hasTesterSignoff },
    effective,
    executedPct: n === 0 ? 0 : Math.round((100 * executed) / n),
    passRate: n === 0 ? 0 : Math.round((100 * effective.pass) / n),
    reviewersTotal: input.reviewersTotal,
    reviewersApproved: input.reviewersApproved,
    roundStatus: input.roundStatus,
    roundCount: input.roundCount,
    feedbackTotal: fb.raised,
    feedbackOpen: fb.openComments + fb.blockingReviewers,
    feedback: fb,
    quality,
    qualityComponents: { ...structural, changesRequestedPenalty: penalty, basis: "estimated" },
    executionScore: execution,
    confidence: verdict.confidence,
    confidenceCaps: verdict.caps,
    readiness: verdict.readiness,
    llmReviewed: false,
  };
}


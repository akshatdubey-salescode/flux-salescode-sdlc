// What the review has been like, across ALL rounds of an item: how much
// feedback was raised, how it ended (addressed, waived), who said what, and how
// many times the sheet had to be resubmitted. Pure, so the analytics card, the
// chip and the summary workbook all read the same numbers.

import type { TcCommentKind, TcFeedbackSource, TcReviewerState } from "./values";

/** One row of the review thread, from any round. */
export type FeedbackEvent = {
  roundNo: number;
  kind: TcCommentKind;
  source: TcFeedbackSource;
  authorEmail: string;
  authorName: string | null;
  /** Comments only: resolved by being addressed or by an override. */
  resolved: boolean;
  waived: boolean;
  /** The tab of the test case a comment is about (null for round-level feedback). */
  tab?: string | null;
  /** How serious the point is: the AI review's own rating; a reviewer's comment (no rating) counts as medium. */
  severity?: SeverityLevel | null;
  /** The AI review's category for the finding (see ai-review/baseline). */
  category?: string | null;
};

export type SeverityLevel = "high" | "medium" | "low";
/** How much a point counts towards review coverage. */
export const COVERAGE_WEIGHT: Record<SeverityLevel, number> = { high: 3, medium: 2, low: 1 };
export type CoverageBucket = Record<SeverityLevel, number>;
/**
 * Every review point (reviewer comments and AI findings) by how it stands: `addressed` (resolved, or on an earlier round
 * that was resubmitted), `open` (unresolved on the latest round) or `waived` (an override accepted the gap without
 * fixing it). Open and waived points are both gaps in the review's coverage.
 */
export type ReviewCoverage = { addressed: CoverageBucket; open: CoverageBucket; waived: CoverageBucket };

const bucket = (): CoverageBucket => ({ high: 0, medium: 0, low: 0 });
const weightOf = (b: CoverageBucket) => b.high * COVERAGE_WEIGHT.high + b.medium * COVERAGE_WEIGHT.medium + b.low * COVERAGE_WEIGHT.low;

/** 0-100: the weighted share of review points that are addressed; null when nothing was raised. */
export function coverageScore(c: ReviewCoverage): number | null {
  const addressed = weightOf(c.addressed);
  const total = addressed + weightOf(c.open) + weightOf(c.waived);
  return total === 0 ? null : Math.round((100 * addressed) / total);
}

/** What the AI review raised, across all rounds: how many points, how serious, how they ended and what kind they are. */
export type AiReviewStats = {
  findings: number;
  bySeverity: CoverageBucket;
  fixed: number;
  open: number;
  waived: number;
  /** Most frequent first; `notFixed` = still open or waived. */
  categories: { category: string; total: number; notFixed: number }[];
};

/** High-severity points that are still open or were waived. */
export const highGaps = (c: ReviewCoverage): number => c.open.high + c.waived.high;

export type ReviewerNow = { email: string; name: string | null; state: TcReviewerState };

export type ReviewerFeedbackRow = {
  email: string;
  name: string | null;
  /** Their state on the latest round (null when they are no longer a reviewer). */
  state: TcReviewerState | null;
  approvals: number;
  changeRequests: number;
  comments: number;
  overrides: number;
};

export type RoundFeedbackRow = {
  roundNo: number;
  changeRequests: number;
  comments: number;
  resolved: number;
  waived: number;
  approvals: number;
  overrides: number;
};

/** The by-tab row for feedback that is about the whole round, not one test case. */
export const WHOLE_ROUND = "(whole round)";

/** Feedback on the test cases of one tab (comments, all rounds; open = unresolved on the latest round). */
export type TabFeedbackRow = { tab: string; comments: number; open: number; resolved: number; waived: number; ai: number };

export type FeedbackSummary = {
  /** Comments plus change-request decisions, all rounds. */
  raised: number;
  /** Unresolved comments on the latest round (these block sign-off). */
  openComments: number;
  /** Reviewers whose change request stands (these block approval). */
  blockingReviewers: number;
  /** Reviewers who asked for changes and have not yet looked at the resubmission. */
  awaitingReReview: number;
  /** Comments resolved because they were addressed / because an override waived them. */
  resolved: number;
  waived: number;
  changeRequests: number;
  approvals: number;
  overrides: number;
  resubmissions: number;
  byReviewer: ReviewerFeedbackRow[];
  perRound: RoundFeedbackRow[];
  /** Comments by tab, plus a "(whole round)" row for feedback not about one test case (absent on stats stored before tabs were broken out). */
  byTab?: TabFeedbackRow[];
  /** Feedback raised by the LLM review (zero until that phase exists); same lifecycle as reviewer feedback. */
  llm: { raised: number; open: number };
  /** Review coverage of all points, of the AI review's alone, and of the human reviewers' alone (absent on older stats). */
  coverage?: ReviewCoverage;
  aiCoverage?: ReviewCoverage;
  reviewerCoverage?: ReviewCoverage;
  ai?: AiReviewStats;
};

export function summariseFeedback(input: {
  events: FeedbackEvent[];
  reviewersNow: ReviewerNow[];
  roundCount: number;
  latestRoundNo: number;
}): FeedbackSummary {
  const { events, reviewersNow } = input;
  const reviewers = new Map<string, ReviewerFeedbackRow>();
  const rounds = new Map<number, RoundFeedbackRow>();

  const reviewerRow = (email: string, name: string | null) => {
    const key = email.trim().toLowerCase();
    let row = reviewers.get(key);
    if (!row) {
      row = { email: key, name, state: null, approvals: 0, changeRequests: 0, comments: 0, overrides: 0 };
      reviewers.set(key, row);
    }
    if (!row.name && name) row.name = name;
    return row;
  };
  const roundRow = (roundNo: number) => {
    let row = rounds.get(roundNo);
    if (!row) {
      row = { roundNo, changeRequests: 0, comments: 0, resolved: 0, waived: 0, approvals: 0, overrides: 0 };
      rounds.set(roundNo, row);
    }
    return row;
  };

  for (let n = 1; n <= input.roundCount; n++) roundRow(n);
  for (const r of reviewersNow) reviewerRow(r.email, r.name).state = r.state;

  let resolved = 0;
  let waived = 0;
  let changeRequests = 0;
  let approvals = 0;
  let overrides = 0;
  let openComments = 0;
  const tabs = new Map<string, TabFeedbackRow>();
  let llmRaised = 0;
  let llmOpen = 0;
  const newCoverage = (): ReviewCoverage => ({ addressed: bucket(), open: bucket(), waived: bucket() });
  const coverage = newCoverage();
  const aiCoverage = newCoverage();
  const reviewerCoverage = newCoverage();
  const aiStats: AiReviewStats = { findings: 0, bySeverity: bucket(), fixed: 0, open: 0, waived: 0, categories: [] };
  const aiCategories = new Map<string, { category: string; total: number; notFixed: number }>();

  for (const e of events) {
    const person = e.source === "reviewer" ? reviewerRow(e.authorEmail, e.authorName) : null;
    const round = roundRow(e.roundNo);
    const isOpen = e.kind === "comment" && !e.resolved;

    if (e.kind === "comment") {
      const level = e.severity ?? "medium";
      const state = e.resolved && e.waived ? "waived" : e.resolved || e.roundNo !== input.latestRoundNo ? "addressed" : "open";
      const own = e.source === "llm" ? aiCoverage : reviewerCoverage;
      coverage[state][level]++;
      own[state][level]++;
      if (e.source === "llm") {
        aiStats.findings++;
        aiStats.bySeverity[level]++;
        if (state === "addressed") aiStats.fixed++;
        else if (state === "open") aiStats.open++;
        else aiStats.waived++;
        const key = e.category || "other";
        const cat = aiCategories.get(key) ?? { category: key, total: 0, notFixed: 0 };
        cat.total++;
        if (state !== "addressed") cat.notFixed++;
        aiCategories.set(key, cat);
      }
      const tabName = e.tab || WHOLE_ROUND;
      const t = tabs.get(tabName) ?? { tab: tabName, comments: 0, open: 0, resolved: 0, waived: 0, ai: 0 };
      t.comments++;
      if (e.source === "llm") t.ai++;
      if (e.resolved && e.waived) t.waived++;
      else if (e.resolved) t.resolved++;
      if (isOpen && e.roundNo === input.latestRoundNo) t.open++;
      tabs.set(tabName, t);
    }

    if (e.source === "llm" && e.kind === "comment") {
      // Findings only: the AI's summary entry ("requested changes") is not a finding.
      llmRaised++;
      if (isOpen && e.roundNo === input.latestRoundNo) llmOpen++;
    }

    switch (e.kind) {
      case "comment":
        round.comments++;
        if (person) person.comments++;
        if (e.resolved && e.waived) {
          round.waived++;
          waived++;
        } else if (e.resolved) {
          round.resolved++;
          resolved++;
        }
        if (isOpen && e.roundNo === input.latestRoundNo) openComments++;
        break;
      case "changes_requested":
        round.changeRequests++;
        changeRequests++;
        if (person) person.changeRequests++;
        break;
      case "approved":
        round.approvals++;
        approvals++;
        if (person) person.approvals++;
        break;
      case "override":
        round.overrides++;
        overrides++;
        if (person) person.overrides++;
        break;
    }
  }

  const commentCount = events.filter((e) => e.kind === "comment").length;
  return {
    raised: commentCount + changeRequests,
    openComments,
    blockingReviewers: reviewersNow.filter((r) => r.state === "changes_requested").length,
    awaitingReReview: reviewersNow.filter((r) => r.state === "re_review").length,
    resolved,
    waived,
    changeRequests,
    approvals,
    overrides,
    resubmissions: Math.max(0, input.roundCount - 1),
    byReviewer: [...reviewers.values()].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
    perRound: [...rounds.values()].sort((a, b) => a.roundNo - b.roundNo),
    byTab: [...tabs.values()].sort((a, b) => b.comments - a.comments || a.tab.localeCompare(b.tab)),
    llm: { raised: llmRaised, open: llmOpen },
    coverage,
    aiCoverage,
    reviewerCoverage,
    ai: { ...aiStats, categories: [...aiCategories.values()].sort((a, b) => b.total - a.total || a.category.localeCompare(b.category)) },
  };
}

export const EMPTY_FEEDBACK: FeedbackSummary = summariseFeedback({ events: [], reviewersNow: [], roundCount: 1, latestRoundNo: 1 });

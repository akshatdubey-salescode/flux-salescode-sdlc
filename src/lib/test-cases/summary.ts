// The compact per-issue TC status shown as a chip on Sprint and Delivery rows,
// read from the stored tc_set_stats (never recomputed per request).

import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { tcSetStats } from "@/lib/db/schema";
import { TC_CATEGORY_LABELS, type TcCategory, type TcRoundStatus } from "./values";
import type { Readiness, SetStats } from "./analytics";

/** What the AI review raised and where it stands: how many are fixed, and how many are still open or were waived, by severity. */
export type TcAiSummary = {
  findings: number;
  fixed: number;
  open: { high: number; medium: number; low: number };
  /** Accepted by an override without being fixed: still gaps. */
  waived: { high: number; medium: number; low: number };
};

export type TcTypeRow = { key: string; label: string; total: number; pass: number; fail: number; blocked: number; notRun: number };

export type TcSummary = {
  setId: string;
  tcCount: number;
  confidence: number;
  readiness: Readiness;
  quality: number;
  executionScore: number;
  pass: number;
  fail: number;
  blocked: number;
  notRun: number;
  executedPct: number;
  roundNo: number;
  /** "changes_requested" is shown as "Resubmit TCs". */
  roundStatus: TcRoundStatus;
  /** Reviewers who asked for changes and have not yet re-reviewed the resubmission. */
  awaitingReReview: number;
  reviewersApproved: number;
  reviewersTotal: number;
  devSigned: boolean;
  testerSigned: boolean;
  feedbackOpen: number;
  feedbackTotal: number;
  llmReviewed: boolean;
  /** The AI review's findings and their state; null when its numbers are not in the stored stats yet (older rows). */
  ai: TcAiSummary | null;
  /** Type split (category) with effective results, largest first, capped for the hover card. */
  byType: TcTypeRow[];
};

const MAX_TYPE_ROWS = 6;

function aiSummary(s: SetStats): TcAiSummary | null {
  const c = s.feedback?.aiCoverage;
  if (!c) return null;
  const sum = (b: { high: number; medium: number; low: number }) => b.high + b.medium + b.low;
  return { findings: sum(c.addressed) + sum(c.open) + sum(c.waived), fixed: sum(c.addressed), open: { ...c.open }, waived: { ...c.waived } };
}

export function toSummary(setId: string, roundNo: number, s: SetStats): TcSummary {
  const byType = (Object.entries(s.categorySplit) as [TcCategory, NonNullable<SetStats["categorySplit"][TcCategory]>][])
    .filter(([, r]) => r.total > 0)
    .map(([k, r]) => ({
      key: k,
      label: TC_CATEGORY_LABELS[k] ?? k,
      total: r.total,
      pass: r.effective.pass,
      fail: r.effective.fail,
      blocked: r.effective.blocked,
      notRun: r.effective.not_run,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_TYPE_ROWS);
  return {
    setId,
    tcCount: s.tcCount,
    confidence: s.confidence,
    readiness: s.readiness,
    quality: s.quality,
    executionScore: s.executionScore,
    pass: s.effective.pass,
    fail: s.effective.fail,
    blocked: s.effective.blocked,
    notRun: s.effective.not_run,
    executedPct: s.executedPct,
    roundNo,
    roundStatus: s.roundStatus,
    awaitingReReview: s.feedback?.awaitingReReview ?? 0,
    reviewersApproved: s.reviewersApproved,
    reviewersTotal: s.reviewersTotal,
    devSigned: s.dev.signedOff,
    testerSigned: s.tester.signedOff,
    feedbackOpen: s.feedbackOpen,
    feedbackTotal: s.feedbackTotal,
    llmReviewed: s.llmReviewed,
    ai: aiSummary(s),
    byType,
  };
}

/** Summaries for the issues that have test cases; issues without any are simply absent. */
export async function fetchTcSummaries(issueIds: string[]): Promise<Record<string, TcSummary>> {
  if (issueIds.length === 0) return {};
  const rows = await db.select().from(tcSetStats).where(inArray(tcSetStats.issueId, issueIds));
  const out: Record<string, TcSummary> = {};
  for (const r of rows) out[r.issueId] = toSummary(r.setId, r.roundNo, r.stats as SetStats);
  return out;
}

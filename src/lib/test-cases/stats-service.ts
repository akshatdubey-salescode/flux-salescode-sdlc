// Keeps tc_set_stats current. Everything that feeds the numbers (a commit, a
// reviewer decision, a comment, a sign-off) calls recomputeSetStats, so the row
// chips, hover cards, details page and TC Board all read one stored result
// instead of each re-deriving it.

import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tcCases, tcResults, tcReviewComments, tcReviewers, tcRounds, tcSetStats, tcSets, tcSignoffs } from "@/lib/db/schema";
import { computeSetStats, type AnalyticsCase, type SetStats } from "./analytics";
import type { TcResult } from "./values";

type RoundRow = typeof tcRounds.$inferSelect;

/** Stats for one round, from its cases, reviewers, feedback and that round's sign-offs. */
/**
 * The latest dev and tester sign-off for a round (a re-submission replaces the
 * earlier one) with each case's recorded result. A role that has not signed
 * off is absent, so callers can tell "not signed off" from "signed off, not run".
 */
export async function loadLatestSignoffResults(roundId: string) {
  const signoffs = await db.select().from(tcSignoffs).where(eq(tcSignoffs.roundId, roundId)).orderBy(desc(tcSignoffs.committedAt));
  const latestDev = signoffs.find((s) => s.role === "dev");
  const latestTester = signoffs.find((s) => s.role === "tester");
  const ids = [latestDev?.id, latestTester?.id].filter((x): x is string => !!x);
  const results = ids.length ? await db.select().from(tcResults).where(inArray(tcResults.signoffId, ids)) : [];
  const byCase = (signoffId: string | undefined) => {
    const m = new Map<string, TcResult>();
    if (signoffId) for (const r of results) if (r.signoffId === signoffId) m.set(r.caseId, r.result);
    return m;
  };
  return { hasDev: !!latestDev, hasTester: !!latestTester, dev: byCase(latestDev?.id), tester: byCase(latestTester?.id) };
}

/** Stats for one round, from its cases, reviewers, feedback and that round's sign-offs. */
async function statsForRound(round: RoundRow, roundCount: number): Promise<SetStats> {
  const [cases, reviewers, signoff, [feedback]] = await Promise.all([
    db.select().from(tcCases).where(eq(tcCases.roundId, round.id)).orderBy(asc(tcCases.rowNo)),
    db.select({ state: tcReviewers.state }).from(tcReviewers).where(eq(tcReviewers.roundId, round.id)),
    // Sign-offs of THIS round only: a new round starts unsigned.
    loadLatestSignoffResults(round.id),
    db
      .select({
        total: count(),
        open: sql<number>`count(*) filter (where ${tcReviewComments.resolved} = false)`,
      })
      .from(tcReviewComments)
      .where(and(eq(tcReviewComments.roundId, round.id), eq(tcReviewComments.kind, "comment"))),
  ]);

  const analyticsCases: AnalyticsCase[] = cases.map((c) => ({
    tcCode: c.tcCode,
    title: c.title,
    steps: c.steps,
    expected: c.expected,
    priority: c.priority,
    severity: c.severity,
    category: c.category,
    polarity: c.polarity,
    // A role that signed off but left a case out counts it as not run; a role that has not signed off is null.
    devResult: signoff.hasDev ? (signoff.dev.get(c.id) ?? "not_run") : null,
    testerResult: signoff.hasTester ? (signoff.tester.get(c.id) ?? "not_run") : null,
  }));

  return computeSetStats({
    cases: analyticsCases,
    roundStatus: round.status,
    reviewersTotal: reviewers.length,
    reviewersApproved: reviewers.filter((r) => r.state === "approved").length,
    hasDevSignoff: signoff.hasDev,
    hasTesterSignoff: signoff.hasTester,
    feedbackTotal: Number(feedback?.total ?? 0),
    feedbackOpen: Number(feedback?.open ?? 0),
    roundCount,
  });
}

export async function recomputeSetStats(setId: string): Promise<SetStats | null> {
  const [set] = await db.select().from(tcSets).where(eq(tcSets.id, setId)).limit(1);
  if (!set) return null;

  const rounds = await db.select().from(tcRounds).where(eq(tcRounds.setId, setId)).orderBy(desc(tcRounds.roundNo));
  const round = rounds[0];
  if (!round) {
    await db.delete(tcSetStats).where(eq(tcSetStats.setId, setId));
    return null;
  }

  const stats = await statsForRound(round, rounds.length);
  const row = {
    setId,
    issueId: set.issueId,
    projectId: set.projectId,
    roundId: round.id,
    roundNo: round.roundNo,
    roundStatus: round.status,
    tcCount: stats.tcCount,
    quality: stats.quality,
    executionScore: stats.executionScore,
    confidence: stats.confidence,
    readiness: stats.readiness,
    devSigned: stats.dev.signedOff,
    testerSigned: stats.tester.signedOff,
    passCount: stats.effective.pass,
    failCount: stats.effective.fail,
    blockedCount: stats.effective.blocked,
    notRunCount: stats.effective.not_run,
    reviewersTotal: stats.reviewersTotal,
    reviewersApproved: stats.reviewersApproved,
    feedbackTotal: stats.feedbackTotal,
    feedbackOpen: stats.feedbackOpen,
    roundCount: stats.roundCount,
    stats,
    computedAt: new Date(),
  };
  await db.insert(tcSetStats).values(row).onConflictDoUpdate({ target: tcSetStats.setId, set: row });
  return stats;
}

export type RoundTrendPoint = {
  roundNo: number;
  tcCount: number;
  quality: number;
  passRate: number;
  confidence: number;
  status: string;
};

/** One point per round, oldest first, so rounds can be compared on the details page. */
export async function fetchRoundTrend(setId: string): Promise<RoundTrendPoint[]> {
  const rounds = await db.select().from(tcRounds).where(eq(tcRounds.setId, setId)).orderBy(asc(tcRounds.roundNo));
  return Promise.all(
    rounds.map(async (r) => {
      const st = await statsForRound(r, rounds.length);
      return { roundNo: r.roundNo, tcCount: st.tcCount, quality: st.quality, passRate: st.passRate, confidence: st.confidence, status: r.status };
    }),
  );
}

/** Stored stats for a set, or null if it has none. */
export async function fetchStoredStats(setId: string): Promise<{ stats: SetStats; computedAt: Date; roundNo: number } | null> {
  const [row] = await db.select().from(tcSetStats).where(eq(tcSetStats.setId, setId)).limit(1);
  if (!row) return null;
  return { stats: row.stats as SetStats, computedAt: row.computedAt, roundNo: row.roundNo };
}

/** Recompute by round id (what the review routes have to hand). */
export async function recomputeForRound(roundId: string): Promise<void> {
  const [r] = await db.select({ setId: tcRounds.setId }).from(tcRounds).where(eq(tcRounds.id, roundId)).limit(1);
  if (r) await recomputeSafely(r.setId);
}

/**
 * For callers whose own write has already succeeded: a stats failure must not
 * turn that into an error, and the next event recomputes from scratch anyway.
 */
export async function recomputeSafely(setId: string): Promise<void> {
  try {
    await recomputeSetStats(setId);
  } catch (err) {
    console.error("[test-cases] could not recompute stats for set", setId, err);
  }
}

// Keeps tc_set_stats current. Everything that feeds the numbers (a commit, a
// reviewer decision, a comment, a sign-off) calls recomputeSetStats, so the row
// chips, hover cards, details page and TC Board all read one stored result
// instead of each re-deriving it.

import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { tcCases, tcResults, tcReviewComments, tcReviewers, tcRounds, tcSetStats, tcSets, tcSignoffs } from "@/lib/db/schema";
import { lockItem, type Executor } from "./concurrency";
import { computeSetStats, type AnalyticsCase, type RoundTrendPoint, type SetStats } from "./analytics";
import { summariseFeedback, type FeedbackEvent, type ReviewerNow } from "./feedback-stats";
import type { TcResult } from "./values";

type RoundRow = typeof tcRounds.$inferSelect;

/**
 * The latest dev and tester sign-off for a round (a re-submission replaces the
 * earlier one) with each case's recorded result. A role that has not signed
 * off is absent, so callers can tell "not signed off" from "signed off, not run".
 */
export async function loadLatestSignoffResults(roundId: string, ex: Executor = db) {
  const signoffs = await ex.select().from(tcSignoffs).where(eq(tcSignoffs.roundId, roundId)).orderBy(desc(tcSignoffs.committedAt));
  const latestDev = signoffs.find((s) => s.role === "dev");
  const latestTester = signoffs.find((s) => s.role === "tester");
  const ids = [latestDev?.id, latestTester?.id].filter((x): x is string => !!x);
  const results = ids.length ? await ex.select().from(tcResults).where(inArray(tcResults.signoffId, ids)) : [];
  const byCase = (signoffId: string | undefined) => {
    const m = new Map<string, TcResult>();
    if (signoffId) for (const r of results) if (r.signoffId === signoffId) m.set(r.caseId, r.result);
    return m;
  };
  return { hasDev: !!latestDev, hasTester: !!latestTester, dev: byCase(latestDev?.id), tester: byCase(latestTester?.id) };
}

/** The whole review thread of a set and each round's reviewers, loaded once and sliced per round. */
type FeedbackInputs = { events: FeedbackEvent[]; reviewersByRound: Map<number, ReviewerNow[]> };

async function loadFeedbackInputs(setId: string, ex: Executor = db): Promise<FeedbackInputs> {
  const [commentRows, reviewerRows] = await Promise.all([
    ex
      .select({ c: tcReviewComments, roundNo: tcRounds.roundNo })
      .from(tcReviewComments)
      .innerJoin(tcRounds, eq(tcRounds.id, tcReviewComments.roundId))
      .where(eq(tcRounds.setId, setId)),
    ex
      .select({ r: tcReviewers, roundNo: tcRounds.roundNo })
      .from(tcReviewers)
      .innerJoin(tcRounds, eq(tcRounds.id, tcReviewers.roundId))
      .where(eq(tcRounds.setId, setId)),
  ]);
  const events: FeedbackEvent[] = commentRows.map(({ c, roundNo }) => ({
    roundNo,
    kind: c.kind,
    source: (c.source === "llm" || c.source === "system" ? c.source : "reviewer"),
    authorEmail: c.authorEmail,
    authorName: c.authorName,
    resolved: c.resolved,
    waived: c.waived,
  }));
  const reviewersByRound = new Map<number, ReviewerNow[]>();
  for (const { r, roundNo } of reviewerRows) {
    const list = reviewersByRound.get(roundNo) ?? [];
    list.push({ email: r.email, name: r.name, state: r.state });
    reviewersByRound.set(roundNo, list);
  }
  return { events, reviewersByRound };
}

/** Stats for one round, from its cases, reviewers, the review thread up to that round, and that round's sign-offs. */
async function statsForRound(round: RoundRow, fb: FeedbackInputs, ex: Executor = db): Promise<SetStats> {
  const [cases, signoff] = await Promise.all([
    ex.select().from(tcCases).where(eq(tcCases.roundId, round.id)).orderBy(asc(tcCases.rowNo)),
    // Sign-offs of THIS round only: a new round starts unsigned.
    loadLatestSignoffResults(round.id, ex),
  ]);
  const reviewers = fb.reviewersByRound.get(round.roundNo) ?? [];

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
    feedback: summariseFeedback({
      events: fb.events.filter((e) => e.roundNo <= round.roundNo),
      reviewersNow: reviewers,
      roundCount: round.roundNo,
      latestRoundNo: round.roundNo,
    }),
    roundCount: round.roundNo,
  });
}

export async function recomputeSetStats(setId: string): Promise<SetStats | null> {
  const [head] = await db.select({ issueId: tcSets.issueId }).from(tcSets).where(eq(tcSets.id, setId)).limit(1);
  if (!head) return null;

  // Under the item lock and entirely on the transaction's own connection: the inputs are read after every
  // earlier change has committed, so the last recompute to run is always the freshest and an older one
  // can never overwrite a newer result.
  return db.transaction(async (tx) => {
    await lockItem(tx, head.issueId);

    const [set] = await tx.select().from(tcSets).where(eq(tcSets.id, setId)).limit(1);
    if (!set) return null;

    const rounds = await tx.select().from(tcRounds).where(eq(tcRounds.setId, setId)).orderBy(desc(tcRounds.roundNo));
    const round = rounds[0];
    if (!round) {
      await tx.delete(tcSetStats).where(eq(tcSetStats.setId, setId));
      return null;
    }

    const fb = await loadFeedbackInputs(setId, tx);
    const latestStats = await statsForRound(round, fb, tx);

    // The trend: rounds older than the one just superseded can no longer change (decisions, comments and
    // sign-offs only apply to the newest round), so their stored points are reused. The round just superseded
    // is always recomputed: its last change may have landed after the point was stored.
    const [prev] = await tx.select({ stats: tcSetStats.stats }).from(tcSetStats).where(eq(tcSetStats.setId, setId)).limit(1);
    const known = new Map(((prev?.stats as Partial<SetStats> | undefined)?.trend ?? []).map((p) => [p.roundNo, p]));
    const point = (r: RoundRow, st: SetStats): RoundTrendPoint => ({
      roundNo: r.roundNo,
      tcCount: st.tcCount,
      quality: st.quality,
      passRate: st.passRate,
      confidence: st.confidence,
      status: r.status,
    });
    const trend: RoundTrendPoint[] = [];
    for (const r of [...rounds].reverse()) {
      if (r.id === round.id) trend.push(point(r, latestStats));
      else {
        const settled = r.id !== rounds[1]?.id ? known.get(r.roundNo) : undefined;
        trend.push(settled ?? point(r, await statsForRound(r, fb, tx)));
      }
    }
    const stats: SetStats = { ...latestStats, trend };
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
      feedbackWaived: stats.feedback.waived,
      changeRequestsTotal: stats.feedback.changeRequests,
      overridesTotal: stats.feedback.overrides,
      roundCount: rounds.length,
      stats,
      computedAt: new Date(),
    };
    await tx.insert(tcSetStats).values(row).onConflictDoUpdate({ target: tcSetStats.setId, set: row });
    return stats;
  });
}

/** Stored stats for a set, or null if it has none. */
export async function fetchStoredStats(setId: string): Promise<{ stats: SetStats; computedAt: Date; roundNo: number } | null> {
  const [row] = await db.select().from(tcSetStats).where(eq(tcSetStats.setId, setId)).limit(1);
  if (!row) return null;
  // Rows stored before the feedback summary existed lack it: bring them up to date rather than render a gap.
  if (!(row.stats as Partial<SetStats>).feedback || !(row.stats as Partial<SetStats>).trend) {
    const fresh = await recomputeSetStats(setId);
    const [again] = await db.select().from(tcSetStats).where(eq(tcSetStats.setId, setId)).limit(1);
    if (fresh && again) return { stats: fresh, computedAt: again.computedAt, roundNo: again.roundNo };
  }
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

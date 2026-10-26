// Keeps tc_set_stats current. Everything that feeds the numbers (a commit, a
// reviewer decision, a comment, a sign-off) calls recomputeSetStats, so the row
// chips, hover cards, details page and TC Board all read one stored result
// instead of each re-deriving it.

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { tcAiReviews, tcCases, tcResults, tcReviewComments, tcReviewers, tcRounds, tcSetStats, tcSets, tcSignoffs } from "@/lib/db/schema";
import { lockItem, type Executor } from "./concurrency";
import { computeSetStats, type AnalyticsCase, type RoundTrendPoint, type SetStats } from "./analytics";
import { summariseFeedback, type FeedbackEvent, type ReviewerNow } from "./feedback-stats";
import { describeScope } from "./scope";
import { isAiReviewer, type TcResult } from "./values";

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
type FeedbackInputs = { events: FeedbackEvent[]; reviewersByRound: Map<number, ReviewerNow[]>; aiReviewedRounds: Set<number> };

async function loadFeedbackInputs(setId: string, ex: Executor = db): Promise<FeedbackInputs> {
  // One after another: `ex` may be a transaction's single connection, which can't run queries side by side.
  const commentRows = await ex
    .select({ c: tcReviewComments, roundNo: tcRounds.roundNo, tab: tcCases.sheetTab })
    .from(tcReviewComments)
    .innerJoin(tcRounds, eq(tcRounds.id, tcReviewComments.roundId))
    .leftJoin(tcCases, eq(tcCases.id, tcReviewComments.caseId))
    .where(eq(tcRounds.setId, setId));
  const reviewerRows = await ex
    .select({ r: tcReviewers, roundNo: tcRounds.roundNo })
    .from(tcReviewers)
    .innerJoin(tcRounds, eq(tcRounds.id, tcReviewers.roundId))
    .where(eq(tcRounds.setId, setId));
  const aiRuns = await ex
    .selectDistinct({ roundNo: tcRounds.roundNo })
    .from(tcAiReviews)
    .innerJoin(tcRounds, eq(tcRounds.id, tcAiReviews.roundId))
    .where(and(eq(tcRounds.setId, setId), eq(tcAiReviews.status, "succeeded")));
  const events: FeedbackEvent[] = commentRows.map(({ c, roundNo, tab }) => ({
    roundNo,
    kind: c.kind,
    source: (c.source === "llm" || c.source === "system" ? c.source : "reviewer"),
    authorEmail: c.authorEmail,
    authorName: c.authorName,
    resolved: c.resolved,
    waived: c.waived,
    tab: tab ? tab : null,
    category: typeof c.meta?.category === "string" ? c.meta.category : null,
    severity: c.meta?.severity === "high" || c.meta?.severity === "medium" || c.meta?.severity === "low" ? c.meta.severity : null,
  }));
  const reviewersByRound = new Map<number, ReviewerNow[]>();
  for (const { r, roundNo } of reviewerRows) {
    const list = reviewersByRound.get(roundNo) ?? [];
    list.push({ email: r.email, name: r.name, state: r.state });
    reviewersByRound.set(roundNo, list);
  }
  return { events, reviewersByRound, aiReviewedRounds: new Set(aiRuns.map((r) => r.roundNo)) };
}

/** Stats for one round, from its cases, reviewers, the review thread up to that round, and that round's sign-offs. */
async function statsForRound(round: RoundRow, fb: FeedbackInputs, ex: Executor = db): Promise<SetStats> {
  const cases = await ex.select().from(tcCases).where(eq(tcCases.roundId, round.id)).orderBy(asc(tcCases.rowNo));
  // Sign-offs of THIS round only: a new round starts unsigned.
  const signoff = await loadLatestSignoffResults(round.id, ex);
  const reviewers = fb.reviewersByRound.get(round.roundNo) ?? [];

  const analyticsCases: AnalyticsCase[] = cases.map((c) => ({
    tab: c.sheetTab,
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
    // People only: the AI reviewer never approves, so it can't be part of "approved x of y".
    reviewersTotal: reviewers.filter((r) => !isAiReviewer(r.email)).length,
    reviewersApproved: reviewers.filter((r) => !isAiReviewer(r.email) && r.state === "approved").length,
    llmReviewed: fb.aiReviewedRounds.has(round.roundNo),
    scope: round.scope ?? null,
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
      scope: describeScope(r.scope ?? null, r.sheetTabs),
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
  // Same for rows from before the per-tab breakdown and the scope existed (no backfill job needed: they heal on first read).
  const old = row.stats as Partial<SetStats>;
  if (!old.feedback || !old.trend || !old.tabSplit || !old.scope || !old.feedback.byTab || !old.feedback.coverage || !old.feedback.ai || old.qualityComponents?.aiCoverage === undefined) {
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

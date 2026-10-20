// Loads everything the review history is built from, for all rounds of a set.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tcCases, tcReviewComments, tcReviewers, tcRounds, tcSignoffs } from "@/lib/db/schema";
import { buildHistory, type HistoryComment, type HistoryEvent, type HistoryRound, type HistorySignoff } from "./history";
import type { TcFeedbackSource } from "./values";

const sourceOf = (s: string): TcFeedbackSource => (s === "llm" || s === "system" ? s : "reviewer");

export async function fetchHistory(setId: string): Promise<HistoryEvent[]> {
  const [rounds, reviewers, commentRows, signoffRows] = await Promise.all([
    db.select().from(tcRounds).where(eq(tcRounds.setId, setId)),
    db
      .select({ r: tcReviewers, roundNo: tcRounds.roundNo })
      .from(tcReviewers)
      .innerJoin(tcRounds, eq(tcRounds.id, tcReviewers.roundId))
      .where(eq(tcRounds.setId, setId)),
    db
      .select({ c: tcReviewComments, roundNo: tcRounds.roundNo, caseCode: tcCases.tcCode, caseTab: tcCases.sheetTab })
      .from(tcReviewComments)
      .innerJoin(tcRounds, eq(tcRounds.id, tcReviewComments.roundId))
      .leftJoin(tcCases, eq(tcCases.id, tcReviewComments.caseId))
      .where(eq(tcRounds.setId, setId)),
    db
      .select({ s: tcSignoffs, roundNo: tcRounds.roundNo })
      .from(tcSignoffs)
      .innerJoin(tcRounds, eq(tcRounds.id, tcSignoffs.roundId))
      .where(eq(tcSignoffs.setId, setId)),
  ]);

  const display = (email: string, name: string | null) => name ?? email;

  const historyRounds: HistoryRound[] = rounds.map((r) => {
    const rs = reviewers.filter((x) => x.roundNo === r.roundNo).map((x) => x.r);
    return {
      roundNo: r.roundNo,
      at: r.committedAt,
      by: display(r.committedBy, r.committedByName),
      tcCount: r.tcCount,
      tabs: r.sheetTabs.length > 0 ? r.sheetTabs : r.sheetTab ? [r.sheetTab] : [],
      notes: r.notes,
      // An approval whose own round is earlier than this one was carried over.
      carriedApprovals: rs.filter((x) => x.state === "approved" && (x.decidedRoundNo ?? r.roundNo) < r.roundNo).map((x) => display(x.email, x.name)),
      awaitingReReview: rs.filter((x) => x.state === "re_review").map((x) => display(x.email, x.name)),
    };
  });

  const comments: HistoryComment[] = commentRows.map(({ c, roundNo, caseCode, caseTab }) => ({
    id: c.id,
    roundNo,
    kind: c.kind,
    source: sourceOf(c.source),
    author: display(c.authorEmail, c.authorName),
    body: c.body,
    at: c.createdAt,
    caseCode: caseCode ?? null,
    tab: caseTab ? caseTab : null,
    resolved: c.resolved,
    waived: c.waived,
    resolvedBy: c.resolvedBy,
    resolvedAt: c.resolvedAt,
    meta: c.meta,
  }));

  const signoffs: HistorySignoff[] = signoffRows.map(({ s, roundNo }) => ({
    id: s.id,
    roundNo,
    role: s.role,
    by: display(s.committedBy, s.committedByName),
    at: s.committedAt,
    pass: s.passCount,
    fail: s.failCount,
    blocked: s.blockedCount,
    notRun: s.notRunCount,
  }));

  return buildHistory({ rounds: historyRounds, comments, signoffs });
}

// Loads everything the review history is built from.
//
// Items that use the same Google Sheet in the same project share one history: each item's page shows what
// happened on that sheet across all of those items, every entry tagged with its item. Nothing is copied
// (this is a query-time union of existing rows) so it can't drift, and each item keeps its own approvals,
// sign-offs and numbers. The same link in a DIFFERENT project is a different group on purpose: those
// projects have their own copies, reviewers and histories. Excel items have no stable identity, so they
// are always alone.

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues, tcCases, tcFiles, tcReviewComments, tcReviewers, tcRounds, tcSets, tcSignoffs } from "@/lib/db/schema";
import { buildHistory, type HistoryComment, type HistoryEvent, type HistoryRound, type HistorySignoff } from "./history";
import type { TcFeedbackSource, TcRoundStatus } from "./values";

const sourceOf = (s: string): TcFeedbackSource => (s === "llm" || s === "system" ? s : "reviewer");

/** One item that shares the viewed item's Google Sheet (including the viewed item itself). */
export type SheetItem = { issueId: string; itemKey: string; latestRoundNo: number; latestStatus: TcRoundStatus; own: boolean };

export type HistoryResult = { events: HistoryEvent[]; items: SheetItem[] };

/** The sets whose history belongs with this one: same project and same Google spreadsheet, else just itself. */
async function sheetGroup(setId: string): Promise<{ setIds: string[]; ownIssueId: string }> {
  const [own] = await db.select({ issueId: tcSets.issueId, projectId: tcSets.projectId }).from(tcSets).where(eq(tcSets.id, setId)).limit(1);
  if (!own) return { setIds: [setId], ownIssueId: "" };

  // An item is locked to one source by its first round, so that round says which sheet it belongs to.
  const [first] = await db
    .select({ source: tcRounds.source, spreadsheetId: tcRounds.spreadsheetId })
    .from(tcRounds)
    .where(eq(tcRounds.setId, setId))
    .orderBy(asc(tcRounds.roundNo))
    .limit(1);
  if (!first || first.source !== "google_sheet" || !first.spreadsheetId) return { setIds: [setId], ownIssueId: own.issueId };

  const rows = await db
    .selectDistinct({ id: tcSets.id })
    .from(tcSets)
    .innerJoin(tcRounds, eq(tcRounds.setId, tcSets.id))
    .where(and(eq(tcSets.projectId, own.projectId), eq(tcRounds.spreadsheetId, first.spreadsheetId)));
  const ids = new Set(rows.map((r) => r.id));
  ids.add(setId);
  return { setIds: [...ids], ownIssueId: own.issueId };
}

export async function fetchHistory(setId: string): Promise<HistoryResult> {
  const { setIds, ownIssueId } = await sheetGroup(setId);

  const [rounds, reviewers, commentRows, signoffRows, snapshotFiles] = await Promise.all([
    db
      .select({ r: tcRounds, issueId: tcSets.issueId, itemKey: jiraIssues.jiraKey })
      .from(tcRounds)
      .innerJoin(tcSets, eq(tcSets.id, tcRounds.setId))
      .innerJoin(jiraIssues, eq(jiraIssues.id, tcSets.issueId))
      .where(inArray(tcRounds.setId, setIds)),
    db
      .select({ r: tcReviewers, roundNo: tcRounds.roundNo, setId: tcRounds.setId })
      .from(tcReviewers)
      .innerJoin(tcRounds, eq(tcRounds.id, tcReviewers.roundId))
      .where(inArray(tcRounds.setId, setIds)),
    db
      .select({
        c: tcReviewComments,
        roundNo: tcRounds.roundNo,
        issueId: tcSets.issueId,
        itemKey: jiraIssues.jiraKey,
        caseCode: tcCases.tcCode,
        caseTab: tcCases.sheetTab,
        caseRow: tcCases.rowNo,
      })
      .from(tcReviewComments)
      .innerJoin(tcRounds, eq(tcRounds.id, tcReviewComments.roundId))
      .innerJoin(tcSets, eq(tcSets.id, tcRounds.setId))
      .innerJoin(jiraIssues, eq(jiraIssues.id, tcSets.issueId))
      .leftJoin(tcCases, eq(tcCases.id, tcReviewComments.caseId))
      .where(inArray(tcRounds.setId, setIds)),
    db
      .select({ s: tcSignoffs, roundNo: tcRounds.roundNo, issueId: tcSets.issueId, itemKey: jiraIssues.jiraKey })
      .from(tcSignoffs)
      .innerJoin(tcRounds, eq(tcRounds.id, tcSignoffs.roundId))
      .innerJoin(tcSets, eq(tcSets.id, tcSignoffs.setId))
      .innerJoin(jiraIssues, eq(jiraIssues.id, tcSets.issueId))
      .where(inArray(tcSignoffs.setId, setIds)),
    db
      .select({ setId: tcFiles.setId, roundNo: tcFiles.roundNo, hash: tcFiles.contentHash })
      .from(tcFiles)
      .where(and(inArray(tcFiles.setId, setIds), eq(tcFiles.kind, "testcases"))),
  ]);

  const display = (email: string, name: string | null) => name ?? email;
  // People are stored by email in some places and name in others: remember every name we have seen.
  const knownNames = new Map<string, string>();
  for (const x of reviewers) if (x.r.name) knownNames.set(x.r.email.toLowerCase(), x.r.name);
  for (const { c } of commentRows) if (c.authorName) knownNames.set(c.authorEmail.toLowerCase(), c.authorName);
  for (const { r } of rounds) if (r.committedByName) knownNames.set(r.committedBy.toLowerCase(), r.committedByName);

  const hashOf = (setId_: string, roundNo: number) => snapshotFiles.find((f) => f.setId === setId_ && f.roundNo === roundNo)?.hash ?? null;

  const historyRounds: HistoryRound[] = rounds.map(({ r, issueId, itemKey }) => {
    const rs = reviewers.filter((x) => x.setId === r.setId && x.roundNo === r.roundNo).map((x) => x.r);
    const prevHash = hashOf(r.setId, r.roundNo - 1);
    const thisHash = hashOf(r.setId, r.roundNo);
    return {
      issueId,
      itemKey,
      roundNo: r.roundNo,
      at: r.committedAt,
      by: display(r.committedBy, r.committedByName),
      tcCount: r.tcCount,
      tabs: r.sheetTabs.length > 0 ? r.sheetTabs : r.sheetTab ? [r.sheetTab] : [],
      scope: r.scope ?? null,
      notes: r.notes,
      // An approval whose own round is earlier than this one was carried over.
      carriedApprovals: rs.filter((x) => x.state === "approved" && (x.decidedRoundNo ?? r.roundNo) < r.roundNo).map((x) => display(x.email, x.name)),
      // Who had asked for changes in the round before (stable, unlike their state today, which moves on after they re-review or are overridden).
      awaitingReReview: reviewers
        .filter((x) => x.setId === r.setId && x.roundNo === r.roundNo - 1 && (x.r.state === "changes_requested" || x.r.state === "re_review"))
        .filter((x) => rs.some((y) => y.email === x.r.email))
        .map((x) => display(x.r.email, x.r.name)),
      unchangedSince: prevHash && thisHash && prevHash === thisHash ? r.roundNo - 1 : null,
    };
  });

  const comments: HistoryComment[] = commentRows.map(({ c, roundNo, issueId, itemKey, caseCode, caseTab, caseRow }) => ({
    issueId,
    itemKey,
    id: c.id,
    roundNo,
    kind: c.kind,
    source: sourceOf(c.source),
    author: display(c.authorEmail, c.authorName),
    body: c.body,
    at: c.createdAt,
    caseCode: caseCode ?? null,
    tab: caseTab ? caseTab : null,
    row: caseRow ?? null,
    resolved: c.resolved,
    waived: c.waived,
    resolvedBy: c.resolvedBy ? (knownNames.get(c.resolvedBy.toLowerCase()) ?? c.resolvedBy) : null,
    resolvedAt: c.resolvedAt,
    meta: c.meta,
  }));

  const signoffs: HistorySignoff[] = signoffRows.map(({ s, roundNo, issueId, itemKey }) => ({
    issueId,
    itemKey,
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

  // One entry per item: its newest round and that round's status, for the "items on this sheet" strip.
  const latest = new Map<string, SheetItem>();
  for (const { r, issueId, itemKey } of rounds) {
    const prev = latest.get(issueId);
    if (!prev || r.roundNo > prev.latestRoundNo) {
      latest.set(issueId, { issueId, itemKey, latestRoundNo: r.roundNo, latestStatus: r.status, own: issueId === ownIssueId });
    }
  }
  const items = [...latest.values()].sort((a, b) => Number(b.own) - Number(a.own) || a.itemKey.localeCompare(b.itemKey));

  return { events: buildHistory({ rounds: historyRounds, comments, signoffs, ownIssueId }), items };
}

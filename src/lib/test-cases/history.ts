// The review history of an item, newest first, visible to everyone who can open
// the page: every submission, decision, comment, override and sign-off across
// all rounds. Built from records that already exist (nothing is stored twice),
// so it cannot drift from what actually happened. Each entry carries a
// `source`, so LLM findings will appear here exactly like reviewer feedback.

import { describeScope, type RoundScope } from "./scope";
import type { TcCommentKind, TcFeedbackSource } from "./values";

export type HistoryKind = "submitted" | "approved" | "changes_requested" | "comment" | "resolved" | "override" | "signoff";

export type HistoryEvent = {
  id: string;
  /** The item (Jira issue) this happened on. Several items can share one Google Sheet's history. */
  issueId: string;
  itemKey: string;
  /** True for the item whose page is being viewed. */
  own: boolean;
  at: string;
  kind: HistoryKind;
  roundNo: number;
  actor: string;
  source: TcFeedbackSource;
  title: string;
  detail: string | null;
  /** Per-case comments: the case and its tab. */
  caseCode: string | null;
  tab: string | null;
  /** The case's row in the source sheet (per-case events). */
  row: number | null;
};

type ItemRef = { issueId: string; itemKey: string };

export type HistoryRound = ItemRef & {
  roundNo: number;
  at: Date;
  by: string;
  tcCount: number;
  tabs: string[];
  notes: string | null;
  /** Reviewers whose earlier approval still stands in this round. */
  carriedApprovals: string[];
  /** Reviewers who asked for changes before and must look again. */
  awaitingReReview: string[];
  /** The earlier round whose test-case content is identical (a resubmission that changed nothing). */
  unchangedSince: number | null;
  /** Which tabs and rows this round reviewed (null: every row of its tabs). */
  scope: RoundScope | null;
};

export type HistoryComment = ItemRef & {
  id: string;
  roundNo: number;
  kind: TcCommentKind;
  source: TcFeedbackSource;
  author: string;
  body: string;
  at: Date;
  caseCode: string | null;
  tab: string | null;
  row: number | null;
  resolved: boolean;
  waived: boolean;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  meta: Record<string, unknown> | null;
};

export type HistorySignoff = ItemRef & { id: string; roundNo: number; role: "dev" | "tester"; by: string; at: Date; pass: number; fail: number; blocked: number; notRun: number };

const EXCERPT = 140;
const excerpt = (s: string) => (s.length > EXCERPT ? `${s.slice(0, EXCERPT).trimEnd()}…` : s);
const ROLE = { dev: "Developer", tester: "Tester" } as const;

const KIND_ORDER: Record<HistoryKind, number> = { submitted: 0, comment: 1, changes_requested: 2, approved: 3, override: 4, resolved: 5, signoff: 6 };

function commentTitle(c: HistoryComment): string {
  // The actor ("AI review") is shown in front of the title, so these read as sentences: "AI review flagged a test case".
  if (c.source === "llm") {
    if (c.meta?.aiSummary === "true") return c.kind === "changes_requested" ? "raised findings" : "found no issues";
    return c.caseCode ? "flagged a test case" : "flagged the round";
  }
  if (c.kind === "approved") return "Approved";
  if (c.kind === "changes_requested") return "Requested changes";
  return c.caseCode ? "Commented on a test case" : "Commented on the round";
}

export function buildHistory(input: {
  rounds: HistoryRound[];
  comments: HistoryComment[];
  signoffs: HistorySignoff[];
  /** The item being viewed; its events are flagged `own`. */
  ownIssueId: string;
}): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  const tag = (r: ItemRef) => ({ issueId: r.issueId, itemKey: r.itemKey, own: r.issueId === input.ownIssueId });

  for (const r of input.rounds) {
    const parts = [`${r.tcCount} test case${r.tcCount === 1 ? "" : "s"}`];
    // The scope says which tabs AND rows; rounds from before rows could be chosen only know their tabs.
    parts.push(r.scope ? `scope: ${describeScope(r.scope)}` : `${r.tabs.length} tab${r.tabs.length === 1 ? "" : "s"}: ${r.tabs.join(", ")}`);
    if (r.carriedApprovals.length > 0) parts.push(`approvals carried over: ${r.carriedApprovals.join(", ")}`);
    if (r.awaitingReReview.length > 0) parts.push(`waiting to re-review: ${r.awaitingReReview.join(", ")}`);
    if (r.unchangedSince !== null) parts.push(`no changes to the test cases since Round ${r.unchangedSince}`);
    if (r.notes) parts.push(`notes: ${excerpt(r.notes)}`);
    events.push({
      id: `round-${r.issueId}-${r.roundNo}`,
      ...tag(r),
      at: r.at.toISOString(),
      kind: "submitted",
      roundNo: r.roundNo,
      actor: r.by,
      source: "reviewer",
      title: r.roundNo === 1 ? "Submitted test cases" : `Resubmitted test cases (Round ${r.roundNo})`,
      detail: parts.join(" · "),
      caseCode: null,
      tab: null,
      row: null,
    });
  }

  for (const c of input.comments) {
    const base = { ...tag(c), roundNo: c.roundNo, actor: c.author, source: c.source, caseCode: c.caseCode, tab: c.tab, row: c.row };
    if (c.kind === "override") {
      const waived = Number(c.meta?.waivedComments ?? 0);
      const overridden = Array.isArray(c.meta?.overriddenReviewers) ? (c.meta!.overriddenReviewers as { email: string; name: string | null }[]) : [];
      const waivedParts: string[] = [];
      if (overridden.length > 0) waivedParts.push(`feedback of ${overridden.map((o) => o.name ?? o.email).join(", ")}`);
      if (waived > 0) waivedParts.push(`${waived} open comment${waived === 1 ? "" : "s"}`);
      events.push({
        id: c.id,
        at: c.at.toISOString(),
        kind: "override",
        ...base,
        title: "Overrode feedback and approved",
        detail: `${waivedParts.length > 0 ? `Waived ${waivedParts.join(" and ")}. ` : ""}Reason: ${c.body}`,
      });
      continue;
    }
    events.push({
      id: c.id,
      at: c.at.toISOString(),
      kind: c.kind,
      ...base,
      title: commentTitle(c),
      detail: c.body ? c.body : null,
    });
    // Someone addressed a comment: its own entry (waived ones are covered by the override entry).
    if (c.kind === "comment" && c.resolved && !c.waived && c.resolvedAt) {
      events.push({
        id: `${c.id}-resolved`,
        ...tag(c),
        at: c.resolvedAt.toISOString(),
        kind: "resolved",
        roundNo: c.roundNo,
        actor: c.resolvedBy ?? "Someone",
        source: "reviewer",
        title: "Marked a comment resolved",
        detail: excerpt(c.body),
        caseCode: c.caseCode,
        tab: c.tab,
        row: c.row,
      });
    }
  }

  for (const s of input.signoffs) {
    events.push({
      id: s.id,
      ...tag(s),
      at: s.at.toISOString(),
      kind: "signoff",
      roundNo: s.roundNo,
      actor: s.by,
      source: "reviewer",
      title: `${ROLE[s.role]} signed off`,
      detail: `${s.pass} passed · ${s.fail} failed · ${s.blocked} blocked · ${s.notRun} not run`,
      caseCode: null,
      tab: null,
      row: null,
    });
  }

  return events.sort(
    (a, b) => b.at.localeCompare(a.at) || b.roundNo - a.roundNo || KIND_ORDER[b.kind] - KIND_ORDER[a.kind],
  );
}

// The review history of an item, newest first, visible to everyone who can open
// the page: every submission, decision, comment, override and sign-off across
// all rounds. Built from records that already exist (nothing is stored twice),
// so it cannot drift from what actually happened. Each entry carries a
// `source`, so LLM findings will appear here exactly like reviewer feedback.

import type { TcCommentKind, TcFeedbackSource } from "./values";

export type HistoryKind = "submitted" | "approved" | "changes_requested" | "comment" | "resolved" | "override" | "signoff";

export type HistoryEvent = {
  id: string;
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
};

export type HistoryRound = {
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
};

export type HistoryComment = {
  id: string;
  roundNo: number;
  kind: TcCommentKind;
  source: TcFeedbackSource;
  author: string;
  body: string;
  at: Date;
  caseCode: string | null;
  tab: string | null;
  resolved: boolean;
  waived: boolean;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  meta: Record<string, unknown> | null;
};

export type HistorySignoff = { id: string; roundNo: number; role: "dev" | "tester"; by: string; at: Date; pass: number; fail: number; blocked: number; notRun: number };

const EXCERPT = 140;
const excerpt = (s: string) => (s.length > EXCERPT ? `${s.slice(0, EXCERPT).trimEnd()}…` : s);
const ROLE = { dev: "Developer", tester: "Tester" } as const;

const KIND_ORDER: Record<HistoryKind, number> = { submitted: 0, comment: 1, changes_requested: 2, approved: 3, override: 4, resolved: 5, signoff: 6 };

export function buildHistory(input: { rounds: HistoryRound[]; comments: HistoryComment[]; signoffs: HistorySignoff[] }): HistoryEvent[] {
  const events: HistoryEvent[] = [];

  for (const r of input.rounds) {
    const parts = [`${r.tcCount} test case${r.tcCount === 1 ? "" : "s"}`, `${r.tabs.length} tab${r.tabs.length === 1 ? "" : "s"}: ${r.tabs.join(", ")}`];
    if (r.carriedApprovals.length > 0) parts.push(`approvals carried over: ${r.carriedApprovals.join(", ")}`);
    if (r.awaitingReReview.length > 0) parts.push(`waiting to re-review: ${r.awaitingReReview.join(", ")}`);
    if (r.notes) parts.push(`notes: ${excerpt(r.notes)}`);
    events.push({
      id: `round-${r.roundNo}`,
      at: r.at.toISOString(),
      kind: "submitted",
      roundNo: r.roundNo,
      actor: r.by,
      source: "reviewer",
      title: r.roundNo === 1 ? "Submitted test cases" : `Resubmitted test cases (Round ${r.roundNo})`,
      detail: parts.join(" · "),
      caseCode: null,
      tab: null,
    });
  }

  for (const c of input.comments) {
    const base = { roundNo: c.roundNo, actor: c.author, source: c.source, caseCode: c.caseCode, tab: c.tab };
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
      title: c.kind === "approved" ? "Approved" : c.kind === "changes_requested" ? "Requested changes" : c.caseCode ? "Commented on a test case" : "Commented on the round",
      detail: c.body ? c.body : null,
    });
    // Someone addressed a comment: its own entry (waived ones are covered by the override entry).
    if (c.kind === "comment" && c.resolved && !c.waived && c.resolvedAt) {
      events.push({
        id: `${c.id}-resolved`,
        at: c.resolvedAt.toISOString(),
        kind: "resolved",
        roundNo: c.roundNo,
        actor: c.resolvedBy ?? "Someone",
        source: "reviewer",
        title: "Marked a comment resolved",
        detail: excerpt(c.body),
        caseCode: c.caseCode,
        tab: c.tab,
      });
    }
  }

  for (const s of input.signoffs) {
    events.push({
      id: s.id,
      at: s.at.toISOString(),
      kind: "signoff",
      roundNo: s.roundNo,
      actor: s.by,
      source: "reviewer",
      title: `${ROLE[s.role]} signed off`,
      detail: `${s.pass} passed · ${s.fail} failed · ${s.blocked} blocked · ${s.notRun} not run`,
      caseCode: null,
      tab: null,
    });
  }

  return events.sort(
    (a, b) => b.at.localeCompare(a.at) || b.roundNo - a.roundNo || KIND_ORDER[b.kind] - KIND_ORDER[a.kind],
  );
}

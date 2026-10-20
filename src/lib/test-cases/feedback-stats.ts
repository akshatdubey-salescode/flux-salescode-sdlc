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
};

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
  /** Feedback raised by the LLM review (zero until that phase exists); same lifecycle as reviewer feedback. */
  llm: { raised: number; open: number };
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
  let llmRaised = 0;
  let llmOpen = 0;

  for (const e of events) {
    const person = e.source === "reviewer" ? reviewerRow(e.authorEmail, e.authorName) : null;
    const round = roundRow(e.roundNo);
    const isOpen = e.kind === "comment" && !e.resolved;

    if (e.source === "llm") {
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
    llm: { raised: llmRaised, open: llmOpen },
  };
}

export const EMPTY_FEEDBACK: FeedbackSummary = summariseFeedback({ events: [], reviewersNow: [], roundCount: 1, latestRoundNo: 1 });

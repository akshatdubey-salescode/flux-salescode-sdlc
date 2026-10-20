// Reviewer rules in one pure module (no DB, no auth imports) so they can be
// unit tested: how a round's status follows its reviewers' decisions, and who
// may decide, comment and resolve.

import type { TcReviewerState, TcRoundStatus } from "./values";

/**
 * How a round's status follows its reviewers.
 *
 * - Any outstanding change request wins: the submitter has to fix the sheet and
 *   resubmit (shown as "Resubmit TCs").
 * - A reviewer who requested changes and is now waiting to look at the
 *   resubmission (`re_review`) keeps the round in review until they decide.
 * - Otherwise ONE approval approves the round — the review is "check and
 *   approve by one of the assignees", not a unanimous vote. Reviewers whose
 *   feedback was overridden, or who have not reviewed, don't hold it back.
 */
export function roundStatusFrom(states: TcReviewerState[]): TcRoundStatus {
  if (states.includes("changes_requested")) return "changes_requested";
  if (states.includes("re_review")) return "in_review";
  if (states.includes("approved")) return "approved";
  return "in_review";
}

export type Actor = { email: string; isAdmin: boolean };
type Person = { email: string };

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function isReviewer(actorEmail: string, reviewers: Person[]): boolean {
  return reviewers.some((r) => eq(r.email, actorEmail));
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Only a listed reviewer (or an admin) may approve / request changes, and only on the latest round. */
export function canDecide(actor: Actor, reviewers: Person[], isLatestRound: boolean): Verdict {
  if (!isLatestRound) return { ok: false, reason: "This round has been superseded by a newer one." };
  if (isReviewer(actor.email, reviewers) || actor.isAdmin) return { ok: true };
  return { ok: false, reason: "Only the assigned reviewers can approve or request changes." };
}

export type ReviewerRow = { email: string; name?: string | null; state: TcReviewerState };

/**
 * Approving is blocked while another reviewer's change request is standing: the
 * sheet has to be resubmitted first (or the feedback overridden). A reviewer can
 * always change their own mind and approve their own change request.
 */
export function canApprove(actor: Actor, reviewers: ReviewerRow[]): Verdict {
  const blocker = reviewers.find((r) => r.state === "changes_requested" && !eq(r.email, actor.email));
  if (!blocker) return { ok: true };
  return {
    ok: false,
    reason: `${blocker.name ?? blocker.email} has requested changes. Approval opens once the test cases are resubmitted and they re-review, or the feedback is overridden.`,
  };
}

export const MIN_OVERRIDE_REASON = 10;

/** Waiving open feedback needs a reason that says why, in a few words at least. */
export function validateOverrideReason(reason: unknown): { ok: true; reason: string } | { ok: false; reason: string } {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < MIN_OVERRIDE_REASON) {
    return { ok: false, reason: `Say why the feedback can be ignored (at least ${MIN_OVERRIDE_REASON} characters).` };
  }
  if (text.length > MAX_COMMENT_LENGTH) return { ok: false, reason: `Reasons are limited to ${MAX_COMMENT_LENGTH} characters.` };
  return { ok: true, reason: text };
}

/** Any assigned reviewer (or an admin) may override, on the latest round, when there is open feedback to override. */
export function canOverride(args: {
  actor: Actor;
  reviewers: ReviewerRow[];
  isLatestRound: boolean;
  openFeedback: boolean;
}): Verdict {
  const decide = canDecide(args.actor, args.reviewers, args.isLatestRound);
  if (!decide.ok) return decide;
  if (!args.openFeedback) return { ok: false, reason: "There is no open feedback to override. Approve normally." };
  return { ok: true };
}

/**
 * What an override does to the reviewers: the overriding reviewer approves, and
 * everyone else whose feedback was standing (change request or waiting to
 * re-review) is marked overridden. The actor is added if an admin overrides
 * without being a listed reviewer.
 */
export function planOverride(reviewers: ReviewerRow[], actorEmail: string): { states: Map<string, TcReviewerState>; overridden: string[] } {
  const states = new Map<string, TcReviewerState>();
  const overridden: string[] = [];
  for (const r of reviewers) {
    const email = r.email.trim().toLowerCase();
    if (eq(email, actorEmail)) {
      states.set(email, "approved");
    } else if (r.state === "changes_requested" || r.state === "re_review") {
      states.set(email, "overridden");
      overridden.push(email);
    } else {
      states.set(email, r.state);
    }
  }
  states.set(actorEmail.trim().toLowerCase(), "approved");
  return { states, overridden };
}

export type CarriedReviewer = {
  email: string;
  name: string | null;
  state: TcReviewerState;
  decidedAt: Date | null;
  decidedRoundNo: number | null;
};

/**
 * Reviewer states for a resubmitted round. Only reviewers who had requested
 * changes must look again (`re_review`); anyone who approved stays approved,
 * anyone who hadn't reviewed stays pending, overridden stays overridden. New
 * reviewers start pending, removed ones drop out (their decisions remain in the
 * history). The decision's own date and round are carried with it.
 */
export function applyCarryOver(
  previous: { email: string; name: string | null; state: TcReviewerState; decidedAt: Date | null; decidedRoundNo: number | null }[],
  next: { email: string; name: string | null }[],
): CarriedReviewer[] {
  const prev = new Map(previous.map((p) => [p.email.trim().toLowerCase(), p]));
  return next.map((n) => {
    const email = n.email.trim().toLowerCase();
    const p = prev.get(email);
    if (!p) return { email, name: n.name, state: "pending", decidedAt: null, decidedRoundNo: null };
    const state: TcReviewerState = p.state === "changes_requested" ? "re_review" : p.state;
    // A request for changes is not carried as a decision: the reviewer is back to deciding.
    const keepDecision = state === "approved" || state === "overridden";
    return {
      email,
      name: n.name ?? p.name,
      state,
      decidedAt: keepDecision ? p.decidedAt : null,
      decidedRoundNo: keepDecision ? p.decidedRoundNo : null,
    };
  });
}

/**
 * A reviewer who asked for changes (or still has to re-review) can't be dropped
 * from the list by the person who resubmits: otherwise the submitter could make
 * the objection disappear and get an approved round. Only an admin may remove
 * them. Returns the people who must stay.
 */
export function requiredReviewersMissing(
  previous: { email: string; name: string | null; state: TcReviewerState }[],
  next: { email: string }[],
  isAdmin: boolean,
): string[] {
  if (isAdmin) return [];
  const keep = new Set(next.map((n) => n.email.trim().toLowerCase()));
  return previous
    .filter((p) => (p.state === "changes_requested" || p.state === "re_review") && !keep.has(p.email.trim().toLowerCase()))
    .map((p) => p.name ?? p.email);
}

/** Reviewers, the person who committed the round, and admins can discuss it. */
export function canComment(actor: Actor, reviewers: Person[], committerEmail: string): Verdict {
  if (isReviewer(actor.email, reviewers) || eq(actor.email, committerEmail) || actor.isAdmin) return { ok: true };
  return { ok: false, reason: "Only the reviewers and the submitter can comment on this round." };
}

/** The author, the submitter (who fixes the issue), the reviewers and admins can mark a comment resolved. */
export function canResolve(
  actor: Actor,
  commentAuthorEmail: string,
  reviewers: Person[],
  committerEmail: string,
): Verdict {
  if (eq(actor.email, commentAuthorEmail) || canComment(actor, reviewers, committerEmail).ok) return { ok: true };
  return { ok: false, reason: "You can't resolve this comment." };
}

/** A change request has to say what to change. */
export function validateDecision(decision: string, comment: string): Verdict {
  if (decision !== "approved" && decision !== "changes_requested") {
    return { ok: false, reason: "decision must be approved or changes_requested" };
  }
  if (decision === "changes_requested" && comment.trim().length === 0) {
    return { ok: false, reason: "Say what needs to change when requesting changes." };
  }
  return { ok: true };
}

export const MAX_COMMENT_LENGTH = 4000;

export function validateCommentBody(body: unknown): { ok: true; body: string } | { ok: false; reason: string } {
  if (typeof body !== "string" || body.trim().length === 0) return { ok: false, reason: "Write a comment first." };
  if (body.length > MAX_COMMENT_LENGTH) return { ok: false, reason: `Comments are limited to ${MAX_COMMENT_LENGTH} characters.` };
  return { ok: true, body: body.trim() };
}

// ---------------------------------------------------------------------------
// Sign-off
// ---------------------------------------------------------------------------

export type SignoffRole = "dev" | "tester";

/**
 * Sign-off opens only after a reviewer approves the LATEST round and its
 * feedback is resolved or waived. The developer
 * is the issue's assignee / Dev Owner; the tester is a QA assignee. When the
 * issue has no QA assignee recorded, any non-developer may sign as tester so
 * the process still works for projects that don't fill that field. Admins can
 * always sign.
 */
export function canSignOff(args: {
  role: SignoffRole;
  actor: Actor;
  people: { dev: string[]; qa: string[] };
  roundApproved: boolean;
  isLatestRound: boolean;
  /** Unresolved feedback comments on the round; sign-off waits until they are resolved or waived. */
  openFeedback: number;
}): Verdict {
  if (!args.isLatestRound) return { ok: false, reason: "This round has been superseded by a newer one." };
  if (!args.roundApproved) return { ok: false, reason: "Sign-off opens once a reviewer approves the test cases." };
  if (args.openFeedback > 0) {
    return {
      ok: false,
      reason: `Resolve or waive the ${args.openFeedback} open feedback item${args.openFeedback === 1 ? "" : "s"} before signing off.`,
    };
  }
  if (args.actor.isAdmin) return { ok: true };
  const email = args.actor.email.trim().toLowerCase();
  const isDev = args.people.dev.includes(email);
  if (args.role === "dev") {
    return isDev ? { ok: true } : { ok: false, reason: "Only the issue's developer (assignee / Dev Owner) can submit the dev sign-off." };
  }
  if (args.people.qa.length > 0) {
    return args.people.qa.includes(email) ? { ok: true } : { ok: false, reason: "Only the issue's QA assignee can submit the tester sign-off." };
  }
  return isDev ? { ok: false, reason: "The developer can't also sign off as the tester." } : { ok: true };
}

// ---------------------------------------------------------------------------
// Deleting an item's test cases (wrong sheet or link uploaded)
// ---------------------------------------------------------------------------

export const MIN_DELETE_REASON = 10;

/**
 * Only an admin may delete, and only knowingly: they type the Jira key and say
 * why. Everything goes - rounds, cases, reviews, sign-offs, files, history.
 */
export function validateDeleteRequest(args: {
  isAdmin: boolean;
  issueKey: string;
  confirm: unknown;
  reason: unknown;
}): { ok: true; reason: string } | { ok: false; status: number; reason: string } {
  if (!args.isAdmin) return { ok: false, status: 403, reason: "Only an admin can delete an item's test cases." };
  const typed = typeof args.confirm === "string" ? args.confirm.trim().toUpperCase() : "";
  if (typed !== args.issueKey.trim().toUpperCase()) {
    return { ok: false, status: 400, reason: `Type the Jira key (${args.issueKey}) to confirm.` };
  }
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (reason.length < MIN_DELETE_REASON) {
    return { ok: false, status: 400, reason: `Say why they are being deleted (at least ${MIN_DELETE_REASON} characters).` };
  }
  if (reason.length > MAX_COMMENT_LENGTH) return { ok: false, status: 400, reason: `Reasons are limited to ${MAX_COMMENT_LENGTH} characters.` };
  return { ok: true, reason };
}

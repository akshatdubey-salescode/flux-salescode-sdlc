// Reviewer rules in one pure module (no DB, no auth imports) so they can be
// unit tested: how a round's status follows its reviewers' decisions, and who
// may decide, comment and resolve.

import type { TcReviewerState, TcRoundStatus } from "./values";

/**
 * A round is approved as soon as ONE reviewer approves — the review is "check
 * and approve by one of the assignees", not a unanimous vote. With no approval,
 * an outstanding change request wins; otherwise it is still in review.
 */
export function roundStatusFrom(states: TcReviewerState[]): TcRoundStatus {
  if (states.includes("approved")) return "approved";
  if (states.includes("changes_requested")) return "changes_requested";
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

import type { MovementEnvironment, MovementReadiness, MovementResult, MovementSlot, MovementStatus } from "../values";
import type { ActorInfo } from "./state";

/** The user doing something: from requireAuth (+ the session name), or null for a system action. */
export interface MovementActor extends ActorInfo {
  /** users.id (the email). */
  id: string;
  name: string | null;
}

/** An error the routes turn into a JSON response; `extra` is merged into the body (small, no secrets). */
export class MovementError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503,
    message: string,
    readonly code: string = "error",
    readonly extra?: Record<string, unknown>
  ) {
    super(message);
  }
}

export interface Signer {
  email: string;
  name?: string | null;
}
export type SignersInput = Record<MovementSlot, Signer>;

export interface BranchPick {
  /** Normalised repo name (no owner, lower case). */
  repo: string;
  branch: string;
}

export interface WarningRef {
  code: string;
  message: string;
  /** For `recheck_failed`: the ISO time the Jira first could not be re-checked (the message shows it in plain words). */
  at?: string;
}

export interface RecordRef {
  repo: string;
  pr: number;
  commentId: string;
  version: number | null;
  updated: string | null;
  status: string | null;
  /**
   * `union`: the pointer is one PR covered by a review comment that lists several PRs; all of them
   * share the `commentId`. Absent for a per-PR record (so pointers stored before this existed are unchanged).
   */
  scope?: "union";
}

export interface ItemNote {
  code: string;
  message: string;
  severity: "blocker" | "warning";
}

export interface ItemSummary {
  issueId: string;
  key: string;
  summary: string;
  /** Effective tick: the stored tick, unless the Jira is blocked (a blocked Jira is never in the checklist). */
  included: boolean;
  readiness: MovementReadiness;
  override: { reason: string; by: string | null; at: string } | null;
  result: MovementResult;
  resultComment: string | null;
  /** Blockers and warnings together. */
  warnings: WarningRef[];
  /** Pointers to the records (never their text); the view lists at most 5 per Jira (see recordCount). */
  records: RecordRef[];
}

/** What the view returns per Jira: the summary plus the additions (existing consumers of ItemSummary are unaffected). */
export interface ItemSummaryView extends Omit<ItemSummary, "warnings"> {
  /** The stored tick, whatever the readiness. */
  ticked: boolean;
  /** A person ticked or unticked it (a refresh then never changes the tick). */
  tickSet: boolean;
  blockers: ItemNote[];
  softWarnings: ItemNote[];
  /** Notes left out of blockers / softWarnings (the view lists 12 per Jira; the item detail has them all). */
  warningsMore: number;
  /** Distinct review COMMENTS (one comment that covers 3 PRs counts once; `records` lists one pointer per PR). Same as `reviews`. */
  recordCount: number;
  /** Distinct review comments the verdict rests on. */
  reviews: number;
  /** Distinct PRs the review comments cover (from the record pointers, at most 50 listed). */
  prs: { covered: number };
  repos: string[];
  reposMore: number;
  /** Existing test-case sign-offs (informational, never blocking). */
  signoffs: { dev: { by: string; at: string } | null; tester: { by: string; at: string } | null };
  /** A review comment of this Jira was corrected in Flux (the checklist uses the edited text). */
  edited: boolean;
  /** Who made the (first listed) edit. */
  editedBy: string | null;
  editedCount: number;
}

export type { MovementEnvironment, MovementStatus };

/*
 * ---------------------------------------------------------------------------------------------
 * UI contract: per-Jira checklist, comment edits, summary (all under /api/deliveries/{id}/movements/{mid}/)
 * ---------------------------------------------------------------------------------------------
 * Errors: `{ error, code, ...extra }` with 400 / 403 / 404 / 409 (`inputs_stale`, `refresh_failed`) / 429 (`rate_limited`).
 * Reads are open to any signed-in user; changes need a delivery manager or admin.
 *
 * GET items/{issueId}/checklist
 *   -> { checklist: Checklist }                 the 14 sections of ONE Jira (all its records, comment edits applied),
 *                                               whatever its tick / override state. 404 not in the movement.
 *
 * GET items/{issueId}/comment
 *   -> { comments: CommentView[], jiraAvailable: boolean, more: number }
 *      CommentView = { commentId, scope: "pr"|"union", covers: ["repo#pr"], version, status, updated,
 *                      original: string|null (live from Jira, read-only, markdown-ish), originalTruncated,
 *                      edited: string|null, editedBy, editedAt, stale: boolean, current: boolean, omitted? }
 *
 * POST items/{issueId}/comment/preview   body { commentId, text }       (manager; saves nothing)
 *   -> { preview: { status, covers: number, rows: { done?: n, not_done?: n, ... }, unknowns: number, warnings: string[] } }
 *   400 `bad_record` "The text must keep the DEPLOYMENT-RECORD first line" (or: wrong ticket / the PRs changed)
 *
 * PUT items/{issueId}/comment            body { commentId, text }       (manager; movement draft / ready / signed_off)
 *   -> { edited: true, status, hash, checklistChanged }     20..40000 characters; clears the sign-offs when the checklist changes
 * DELETE items/{issueId}/comment?commentId=
 *   -> { edited: false, status, hash, checklistChanged }
 *
 * View items gain `edited: boolean`, `editedBy: string|null`, `editedCount: number`; item detail prs / comments gain `edited`.
 * A Jira comment that changed after its edit keeps the edit and the item gets the warning
 * "The Jira comment changed after the Flux edit: review it" (code `comment_edit_stale`).
 * Events: `comment_edited` / `comment_reset` { key, commentId, ... }.
 *
 * GET summary
 *   -> { summary: MergedSummary { source: "ai"|"rules", headline, glance, sections, notes },
 *        rollup: Rollup,                        the deterministic roll-up of the CURRENT checklist: render it at once
 *                                               while the AI summary loads, or when there is none
 *        status: "fresh"|"stale"|"none"|"rules_only", hash, source: "ai"|"rules", generatedAt,
 *        generatedBy, model, note: string|null, ai: { available: boolean, reason: string|null } }
 *      `summary` is the stored AI summary only when `status` is "fresh"; otherwise the deterministic summary of the
 *      current checklist (a changed checklist makes a stored one "stale", never shown as current).
 * POST summary   body { force?: boolean }                                (manager)
 *   -> the same shape; the AI failing / being off or on hold returns source "rules" with a plain `note` (never an error).
 *   429 `rate_limited`: one generation per 20 s and 30 per day per movement.
 */
export type { CommentView } from "./comments";
export type { SummaryView, SummaryStatus } from "./summary";

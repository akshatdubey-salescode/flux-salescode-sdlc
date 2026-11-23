/**
 * Flux-side edits of the review comments of one Jira (the AI-written DEPLOYMENT-RECORD comments). Jira stays
 * READ-ONLY: an edit is an overlay kept in Flux (see edits.ts). Reading the comments does ONE live, read-only Jira call
 * (never cached) so the person sees the text as it is on Jira now; saving does no Jira call.
 *
 *   listComments   GET    the comments of a Jira: original (live, read-only), edited, stale
 *   previewComment POST   parse a text WITHOUT saving: what the checklist would get from it
 *   saveComment    PUT    save the overlay (manager, movement draft / ready / signed_off); changes the checklist hash
 *   resetComment   DELETE drop the overlay (back to the Jira text)
 */
import { and, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deliveryMovementCommentEdits, jiraIssues } from "@/lib/db/schema";
import { coversOf, isUnion } from "../covers";
import type { JiraSource } from "../jira-source";
import { blocksToMarkdown, bodyToBlocks, prKey, type ParsedRecord } from "../record";
import type { Checklist } from "../checklist";
import { MAX_COMMENT_EDIT_CHARS, MAX_COMMENT_EDITS_PER_MOVEMENT, MIN_COMMENT_EDIT_CHARS } from "../values";
import {
  addEvent,
  applyChecklist,
  currentChecklist,
  loadEdits,
  loadItemRows,
  loadMovement,
  loadSlots,
  loadStoredRecords,
  sendNotifications,
  type Executor,
  type MovementHead,
  type Notification,
} from "./core";
import { checkEdit, editsHash, previewOf } from "./edits";
import { sourcesByProject, type SourceInput } from "./source";
import { authorize } from "./state";
import { MovementError, type MovementActor } from "./types";

export const COMMENT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
/** The listing shows at most this many comments of one Jira and about this many characters of text in all. */
const MAX_COMMENTS_LISTED = 20;
const TEXT_BUDGET_CHARS = 300_000;
const MAX_COMMENTS_READ = 200;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function inTx<T>(fn: (tx: Tx, notes: Notification[]) => Promise<T>): Promise<T> {
  const notes: Notification[] = [];
  const out = await db.transaction((tx) => fn(tx, notes));
  if (notes.length > 0) await sendNotifications(notes);
  return out;
}

function guardEdit(head: MovementHead, actor: MovementActor): void {
  const d = authorize("edit", { status: head.status, actor });
  if (!d.ok) throw new MovementError(d.code === "forbidden" ? 403 : 409, d.message, d.code, d.extra);
}

function cleanId(v: unknown): string {
  if (typeof v !== "string" || !COMMENT_ID_RE.test(v)) throw new MovementError(400, "commentId is not valid", "bad_request");
  return v;
}

function cleanText(v: unknown): string {
  if (typeof v !== "string") throw new MovementError(400, "text must be a string", "bad_request");
  if (v.length < MIN_COMMENT_EDIT_CHARS || v.length > MAX_COMMENT_EDIT_CHARS) {
    throw new MovementError(400, `The text must be ${MIN_COMMENT_EDIT_CHARS} to ${MAX_COMMENT_EDIT_CHARS} characters`, "bad_request");
  }
  return v;
}

const updatedOf = (r: ParsedRecord): string | null => r.comment.updated ?? r.comment.created ?? null;

/** The Jira-parsed records of ONE Jira (the stored inputs), 404 / 409 as elsewhere. */
async function jiraRecords(ex: Executor, head: MovementHead, issueId: string, itemKey?: string) {
  const stored = await loadStoredRecords(ex, head.id, { cacheKey: head.inputsHash });
  if (stored.state !== "ok") throw new MovementError(409, "The stored Jira records are missing or unreadable; refresh first", "inputs_stale");
  void itemKey;
  return stored.records.get(issueId) ?? [];
}

// ---------------------------------------------------------------------------------------------
// live read (read-only)
// ---------------------------------------------------------------------------------------------

interface LiveComment {
  updated: string | null;
  text: string;
  truncated: boolean;
}

/** Find the wanted comment ids on the given Jira keys: newest first, at most 200 comments per key, nothing is written or cached. */
async function readLive(src: JiraSource, keys: readonly string[], wanted: ReadonlySet<string>): Promise<Map<string, LiveComment>> {
  const found = new Map<string, LiveComment>();
  for (const key of keys) {
    let startAt = 0;
    let seen = 0;
    while (found.size < wanted.size && seen < MAX_COMMENTS_READ) {
      const page = await src.fetchIssueComments(key, { startAt, maxResults: 50 });
      for (const c of page.comments) {
        seen++;
        if (!wanted.has(String(c.id)) || found.has(String(c.id))) continue;
        const md = blocksToMarkdown(bodyToBlocks(c.body).blocks);
        found.set(String(c.id), { updated: c.updated ?? c.created ?? null, text: md.slice(0, MAX_COMMENT_EDIT_CHARS), truncated: md.length > MAX_COMMENT_EDIT_CHARS });
      }
      startAt += page.comments.length;
      if (page.comments.length === 0 || startAt >= page.total) break;
    }
    if (found.size >= wanted.size) break;
  }
  return found;
}

export interface CommentView {
  commentId: string;
  scope: "pr" | "union";
  /** `repo#pr` of every PR the comment covers. */
  covers: string[];
  version: number | null;
  status: ParsedRecord["status"];
  /** The Jira comment's `updated` (live when it could be read, else as of the last refresh). */
  updated: string | null;
  /** The comment as Jira has it now, as markdown-ish text (read-only); null when Jira could not be read or the text was left out for size. */
  original: string | null;
  originalTruncated: boolean;
  /** The Flux-side text, or null when the comment is not edited. */
  edited: string | null;
  editedBy: string | null;
  editedAt: string | null;
  /** The Jira comment changed after the edit was made: review the edit against the new text. */
  stale: boolean;
  /** False for an edit whose comment is no longer among the Jira's records (a newer comment took its place): kept, not applied. */
  current: boolean;
  /** The text was left out of this answer to keep it small. */
  omitted?: boolean;
}

export async function listComments(deliveryId: string, movementId: string, issueId: string, deps: { source?: SourceInput } = {}) {
  const head = await loadMovement(db, deliveryId, movementId);
  const rows = await loadItemRows(db, movementId);
  const row = rows.find((r) => r.issueId === issueId);
  if (!row) throw new MovementError(404, "Jira is not part of this movement", "not_found");
  const records = await jiraRecords(db, head, issueId);
  const edits = head.commentEditsHash ? (await loadEdits(db, movementId)).filter((e) => e.issueId === issueId) : [];
  const editOf = new Map(edits.map((e) => [e.commentId, e]));

  // ONE live, read-only look at the comments (never cached): the Jira the item sits on, and the ticket a record names.
  const listed = records.slice(0, MAX_COMMENTS_LISTED);
  const wanted = new Set(listed.map((r) => r.comment.id));
  let live = new Map<string, LiveComment>();
  let jiraAvailable = true;
  try {
    const [p] = await db.select({ projectId: jiraIssues.projectId }).from(jiraIssues).where(eq(jiraIssues.id, issueId)).limit(1);
    const src = (await sourcesByProject([p?.projectId ?? ""], deps.source)).get(p?.projectId ?? "")!;
    const keys = [...new Set([row.key, ...listed.map((r) => r.marker.key).filter((k): k is string => !!k)])];
    live = await readLive(src, keys, wanted);
  } catch {
    jiraAvailable = false; // generic: the detail is not shown
  }

  let budget = TEXT_BUDGET_CHARS;
  const take = (text: string | null): { text: string | null; omitted: boolean } => {
    if (text === null) return { text: null, omitted: false };
    if (text.length > budget) return { text: null, omitted: true };
    budget -= text.length;
    return { text, omitted: false };
  };
  const comments: CommentView[] = listed.map((r) => {
    const l = live.get(r.comment.id);
    const e = editOf.get(r.comment.id);
    const orig = take(l?.text ?? null);
    const ed = take(e?.text ?? null);
    const updated = l?.updated ?? updatedOf(r);
    return {
      commentId: r.comment.id,
      scope: isUnion(r) ? "union" : "pr",
      covers: coversOf(r).map((c) => prKey(c.repo, c.pr)),
      version: r.marker.version,
      status: r.status,
      updated,
      original: orig.text,
      originalTruncated: l?.truncated ?? false,
      edited: ed.text,
      editedBy: e ? (e.editedByName ?? e.editedBy) : null,
      editedAt: e ? e.editedAt.toISOString() : null,
      stale: !!e && e.baseUpdated !== null && updated !== null && updated !== e.baseUpdated,
      current: true,
      ...(orig.omitted || ed.omitted ? { omitted: true } : {}),
    };
  });
  // Edits whose comment is no longer a record of this Jira: kept, shown, not applied.
  for (const e of edits) {
    if (listed.some((r) => r.comment.id === e.commentId)) continue;
    const t = take(e.text);
    comments.push({
      commentId: e.commentId,
      scope: "pr",
      covers: [],
      version: null,
      status: null,
      updated: null,
      original: null,
      originalTruncated: false,
      edited: t.text,
      editedBy: e.editedByName ?? e.editedBy,
      editedAt: e.editedAt.toISOString(),
      stale: true,
      current: false,
      ...(t.omitted ? { omitted: true } : {}),
    });
  }
  return { comments, jiraAvailable, more: Math.max(0, records.length - listed.length) };
}

// ---------------------------------------------------------------------------------------------
// preview / save / reset
// ---------------------------------------------------------------------------------------------

export async function previewComment(deliveryId: string, movementId: string, issueId: string, body: { commentId?: unknown; text?: unknown }, actor: MovementActor) {
  const commentId = cleanId(body.commentId);
  const head = await loadMovement(db, deliveryId, movementId);
  guardEdit(head, actor);
  const text = cleanText(body.text);
  const rows = await loadItemRows(db, movementId);
  const row = rows.find((r) => r.issueId === issueId);
  if (!row) throw new MovementError(404, "Jira is not part of this movement", "not_found");
  const orig = (await jiraRecords(db, head, issueId)).find((r) => r.comment.id === commentId);
  if (!orig) throw new MovementError(404, "That comment is not one of this Jira's review comments", "not_found");
  const checked = checkEdit(text, orig, row.key);
  if (!checked.ok) throw new MovementError(400, checked.message, "bad_record");
  return { preview: previewOf(checked.record) };
}

async function afterChange(tx: Tx, notes: Notification[], head: MovementHead, actor: MovementActor, nextHash: string | null, rows: Awaited<ReturnType<typeof loadItemRows>>, before: Checklist) {
  const { slots } = await loadSlots(tx, head.id);
  const cl = await currentChecklist(tx, { ...head, commentEditsHash: nextHash }, rows);
  const ap = await applyChecklist(tx, {
    head,
    cl,
    actor,
    slots,
    // The checklist as it was, built BEFORE the edit rows changed (a cache miss afterwards would already see the new edits).
    previous: async () => before,
    set: { commentEditsHash: nextHash },
    realChange: true,
  });
  notes.push(...ap.notifications);
  return ap;
}

export async function saveComment(deliveryId: string, movementId: string, issueId: string, body: { commentId?: unknown; text?: unknown }, actor: MovementActor) {
  const commentId = cleanId(body.commentId);
  const text = cleanText(body.text);
  return inTx(async (tx, notes) => {
    const head = await loadMovement(tx, deliveryId, movementId, true);
    guardEdit(head, actor);
    const rows = await loadItemRows(tx, movementId, true);
    const row = rows.find((r) => r.issueId === issueId);
    if (!row) throw new MovementError(404, "Jira is not part of this movement", "not_found");
    const orig = (await jiraRecords(tx, head, issueId)).find((r) => r.comment.id === commentId);
    if (!orig) throw new MovementError(404, "That comment is not one of this Jira's review comments", "not_found");
    const checked = checkEdit(text, orig, row.key);
    if (!checked.ok) throw new MovementError(400, checked.message, "bad_record");

    const [{ n }] = await tx.select({ n: count() }).from(deliveryMovementCommentEdits).where(eq(deliveryMovementCommentEdits.movementId, movementId));
    const [existing] = await tx
      .select({ commentId: deliveryMovementCommentEdits.commentId })
      .from(deliveryMovementCommentEdits)
      .where(and(eq(deliveryMovementCommentEdits.movementId, movementId), eq(deliveryMovementCommentEdits.commentId, commentId)));
    if (!existing && Number(n) >= MAX_COMMENT_EDITS_PER_MOVEMENT) {
      throw new MovementError(409, `A movement can hold at most ${MAX_COMMENT_EDITS_PER_MOVEMENT} edited comments`, "too_many_edits");
    }
    const before = await currentChecklist(tx, head, rows);
    const values = { issueId, editedText: text, editedBy: actor.id, editedByName: actor.name, editedAt: new Date(), baseUpdated: updatedOf(orig) };
    await tx
      .insert(deliveryMovementCommentEdits)
      .values({ movementId, commentId, ...values })
      .onConflictDoUpdate({ target: [deliveryMovementCommentEdits.movementId, deliveryMovementCommentEdits.commentId], set: values });
    const hash = editsHash(await loadEdits(tx, movementId));
    await addEvent(tx, movementId, "comment_edited", actor, { key: row.key, commentId, covers: coversOf(orig).map((c) => prKey(c.repo, c.pr)).slice(0, 10), chars: text.length });
    const ap = await afterChange(tx, notes, head, actor, hash, rows, before);
    return { edited: true as const, status: ap.status, hash: ap.hash, checklistChanged: ap.hashChanged };
  });
}

export async function resetComment(deliveryId: string, movementId: string, issueId: string, commentIdInput: unknown, actor: MovementActor) {
  const commentId = cleanId(commentIdInput);
  return inTx(async (tx, notes) => {
    const head = await loadMovement(tx, deliveryId, movementId, true);
    guardEdit(head, actor);
    const rows = await loadItemRows(tx, movementId, true);
    const row = rows.find((r) => r.issueId === issueId);
    if (!row) throw new MovementError(404, "Jira is not part of this movement", "not_found");
    const before = await currentChecklist(tx, head, rows);
    const gone = await tx
      .delete(deliveryMovementCommentEdits)
      .where(and(eq(deliveryMovementCommentEdits.movementId, movementId), eq(deliveryMovementCommentEdits.issueId, issueId), eq(deliveryMovementCommentEdits.commentId, commentId)))
      .returning({ commentId: deliveryMovementCommentEdits.commentId });
    if (gone.length === 0) throw new MovementError(404, "That comment has no Flux edit", "not_found");
    const hash = editsHash(await loadEdits(tx, movementId));
    await addEvent(tx, movementId, "comment_reset", actor, { key: row.key, commentId });
    const ap = await afterChange(tx, notes, head, actor, hash, rows, before);
    return { edited: false as const, status: ap.status, hash: ap.hash, checklistChanged: ap.hashChanged };
  });
}

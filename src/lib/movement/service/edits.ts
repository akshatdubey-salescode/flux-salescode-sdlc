/**
 * Flux-side edits of review comments: the pure part. A person can correct an AI-written deployment-record comment
 * in Flux (Jira stays read-only). The edit is stored as the comment's TEXT; whenever records are used to build a
 * checklist the Jira-parsed record of that comment is REPLACED by the parse of the edited text (`applyEdits`), so the
 * refresh, the view, the checklist, the per-Jira checklist, the summary and the export all see the same thing.
 * The stored inputs keep the Jira-parsed records; the overlay is applied after they are decoded.
 */
import { createHash } from "node:crypto";
import { coversOf } from "../covers";
import { normalizeRepo, parseDeploymentRecord, type ParsedRecord } from "../record";
import { plainParseNotes } from "../time-format";

export interface CommentEdit {
  issueId: string;
  commentId: string;
  text: string;
  baseUpdated: string | null;
  editedBy: string;
  editedByName: string | null;
  editedAt: Date;
}

/** Hash of a set of edits (`commentId` + a hash of the text): null for none. Order does not matter. */
export function editsHash(edits: ReadonlyArray<{ commentId: string; text?: string; textHash?: string }>): string | null {
  if (edits.length === 0) return null;
  const parts = edits
    .map((e) => `${e.commentId}:${e.textHash ?? createHash("sha1").update(e.text ?? "").digest("hex")}`)
    .sort();
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

const aliasEqual = (a: string, b: string): boolean => {
  const x = normalizeRepo(a);
  const y = normalizeRepo(b);
  return x === y || x.endsWith(`-${y}`) || y.endsWith(`-${x}`);
};

/** The two records cover the same PRs (repo names compared leniently: `flutter` = `channelkart-flutter`). */
export function sameCovers(a: ParsedRecord, b: ParsedRecord): boolean {
  const x = coversOf(a);
  const y = coversOf(b);
  if (x.length !== y.length) return false;
  return x.every((c) => y.some((d) => d.pr === c.pr && aliasEqual(c.repo, d.repo)));
}

/** Use the original's spelling of every repo name (the readiness step reconciled aliases; the edit may not have). */
function reconcile(parsed: ParsedRecord, orig: ParsedRecord): ParsedRecord {
  const names = [...new Set([...(orig.marker.repo ? [orig.marker.repo] : []), ...coversOf(orig).map((c) => c.repo)])];
  const fix = (repo: string): string => names.find((n) => aliasEqual(n, repo)) ?? repo;
  const out: ParsedRecord = { ...parsed, marker: { ...parsed.marker, repo: parsed.marker.repo ? fix(parsed.marker.repo) : parsed.marker.repo } };
  if (parsed.facts.covers) out.facts = { ...parsed.facts, covers: parsed.facts.covers.map((c) => ({ ...c, repo: fix(c.repo) })) };
  return out;
}

export type EditCheck = { ok: true; record: ParsedRecord } | { ok: false; message: string };

export const MARKER_MESSAGE = "The text must keep the DEPLOYMENT-RECORD first line";

/**
 * Parse an edited text as the record it replaces. The comment keeps its identity (id, created, updated of the Jira
 * comment). Refused when the first line is gone, or when the edit changes WHICH PRs the comment is about (readiness is
 * computed from the Jira text, so the PR set must stay) or which ticket it is for.
 */
export function checkEdit(text: string, orig: ParsedRecord, itemKey: string): EditCheck {
  const parsed = parseDeploymentRecord({ id: orig.comment.id, body: text, created: orig.comment.created, updated: orig.comment.updated });
  if (!parsed) return { ok: false, message: MARKER_MESSAGE };
  const key = parsed.marker.key?.toUpperCase() ?? null;
  const allowed = new Set([itemKey.toUpperCase(), orig.marker.key?.toUpperCase()].filter((k): k is string => !!k));
  if (!key || !allowed.has(key)) return { ok: false, message: `The first line must name ${itemKey} (or the ticket the comment was written for)` };
  if (!sameCovers(parsed, orig)) return { ok: false, message: "The edit changes which PRs the comment is about; keep the repo and PR numbers of the first line" };
  return { ok: true, record: reconcile(parsed, orig) };
}

/**
 * The records with the edits applied: for every edit the record with that comment id (in that Jira's list) is replaced
 * by the parse of the edited text. An edit whose comment is no longer among the records (a newer comment took its
 * place) is ignored here (it is reported as `current: false`); an edit that no longer parses leaves the Jira record.
 * Returns a NEW map; the input (which may be a cached object) is never changed.
 */
export function applyEdits(records: ReadonlyMap<string, ParsedRecord[]>, edits: readonly CommentEdit[]): Map<string, ParsedRecord[]> {
  if (edits.length === 0) return records as Map<string, ParsedRecord[]>;
  const out = new Map(records);
  for (const e of edits) {
    const list = out.get(e.issueId);
    const i = list ? list.findIndex((r) => r.comment.id === e.commentId) : -1;
    if (!list || i < 0) continue;
    // Validated when it was saved (checkEdit); here only the parse matters.
    const parsed = parseApplied(e.text, list[i]);
    if (!parsed) continue;
    const next = list.slice();
    next[i] = parsed;
    out.set(e.issueId, next);
  }
  return out;
}

function parseApplied(text: string, orig: ParsedRecord): ParsedRecord | null {
  const parsed = parseDeploymentRecord({ id: orig.comment.id, body: text, created: orig.comment.created, updated: orig.comment.updated });
  return parsed ? reconcile(parsed, orig) : null;
}

/** Counts a person can sanity-check before saving (no secrets, small). */
export interface EditPreview {
  status: ParsedRecord["status"];
  /** PRs the record covers. */
  covers: number;
  /** The numbered release rows of a free-form record, by the state they say (done / not done / unknown ...). */
  rows: Record<string, number>;
  unknowns: number;
  /** Plain sentences about how the text was read (never a code). */
  warnings: string[];
}

export function previewOf(r: ParsedRecord): EditPreview {
  const rows: Record<string, number> = {};
  for (const row of r.facts.releaseRows ?? []) rows[row.state] = (rows[row.state] ?? 0) + 1;
  const notes = plainParseNotes([...new Set(r.warnings.map((w) => w.code))]);
  return { status: r.status, covers: coversOf(r).length, rows, unknowns: r.unknowns.length, warnings: notes ? notes.split("; ").map((s) => s.charAt(0).toUpperCase() + s.slice(1)) : [] };
}

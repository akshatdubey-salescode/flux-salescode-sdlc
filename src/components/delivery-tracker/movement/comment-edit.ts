/**
 * Pure rules of the review-comment editor: what text is edited, whether it may be saved, the badges and the preview chips. No React, no fetch.
 * The limits mirror the server's (values.ts: 20..40000 characters); the server stays the judge.
 */
import type { CommentPreview, CommentView } from "./api-types";
import type { Tone } from "./view-model";
import { formatIst } from "./view-model";

export const MIN_EDIT_CHARS = 20;
export const MAX_EDIT_CHARS = 40_000;
export const PREVIEW_DEBOUNCE_MS = 600;

/** Said before the save: a changed review comment changes the checklist, which clears every sign-off. */
export const SAVE_WARNING = "Saving resets the sign-offs because the checklist changes.";
export const RESET_WARNING = "The Flux edit is dropped and the Jira version is used again. This can reset the sign-offs because the checklist changes.";

/** The text the editor starts with: the Flux edit when there is one, else the Jira text, else empty (Jira could not be read). */
export function effectiveText(c: Pick<CommentView, "edited" | "original">): string {
  return c.edited ?? c.original ?? "";
}

export function isDirty(text: string, c: Pick<CommentView, "edited" | "original">): boolean {
  return text !== effectiveText(c);
}

/** A problem the editor can see without asking the server (too short / too long); null = ask for a preview. */
export function lengthProblem(text: string): string | null {
  const n = text.trim().length;
  if (n < MIN_EDIT_CHARS) return `The text is too short (at least ${MIN_EDIT_CHARS} characters).`;
  if (text.length > MAX_EDIT_CHARS) return `The text is too long (at most ${MAX_EDIT_CHARS} characters).`;
  return null;
}

export type PreviewState = { phase: "pending" } | { phase: "ok"; preview: CommentPreview } | { phase: "error"; message: string };

/** Save is allowed only for a changed text whose preview is OK (not pending, not an error). */
export function canSave(text: string, c: Pick<CommentView, "edited" | "original" | "current">, preview: PreviewState): { ok: boolean; reason: string | null } {
  if (!isDirty(text, c)) return { ok: false, reason: "Nothing changed yet" };
  const len = lengthProblem(text);
  if (len) return { ok: false, reason: len };
  if (preview.phase === "pending") return { ok: false, reason: "Checking the text…" };
  if (preview.phase === "error") return { ok: false, reason: preview.message };
  return { ok: true, reason: null };
}

export interface Badge {
  text: string;
  tone: Tone;
  testId: string;
}

/** The badges of one comment: edited (by whom, when), stale (the Jira comment moved on), no longer applied, original not available. */
export function commentBadges(c: CommentView, jiraAvailable: boolean): Badge[] {
  const out: Badge[] = [];
  if (c.edited !== null) out.push({ text: `Edited in Flux${c.editedBy ? ` by ${c.editedBy}` : ""}${c.editedAt ? ` on ${formatIst(c.editedAt)}` : ""}`, tone: "info", testId: "movement-comment-badge-edited" });
  if (c.stale) out.push({ text: "Jira comment changed after your edit: review", tone: "warn", testId: "movement-comment-badge-stale" });
  if (c.edited !== null && !c.current) out.push({ text: "This edit is not applied: a newer comment took its place", tone: "warn", testId: "movement-comment-badge-notcurrent" });
  if (!jiraAvailable || c.original === null) out.push({ text: "Original not available", tone: "muted", testId: "movement-comment-badge-nooriginal" });
  return out;
}

/** The tab label of a comment when a Jira has several. */
export function commentTabLabel(c: Pick<CommentView, "version" | "covers" | "scope" | "edited">, i: number): string {
  const v = c.version !== null ? `v${c.version}` : `comment ${i + 1}`;
  return `${v} · ${c.covers.length} PR${c.covers.length === 1 ? "" : "s"}${c.edited !== null ? " · edited" : ""}`;
}

const ROW_LABEL: Record<string, string> = { done: "done", not_done: "not done", not_required: "not required", yes: "yes", no: "no", unknown: "unknown", other: "other" };
const ROW_TONE: Record<string, Tone> = { done: "ok", not_done: "danger", not_required: "muted", yes: "info", no: "info", unknown: "warn", other: "muted" };

export interface PreviewChip {
  label: string;
  tone: Tone;
}

/** The preview as chips: status, PRs covered, release-page rows by state, open questions. (The warnings are plain sentences, shown as they are.) */
export function previewChips(p: CommentPreview): PreviewChip[] {
  const out: PreviewChip[] = [];
  if (p.status) out.push({ label: p.status, tone: p.status === "READY" ? "ok" : "warn" });
  out.push({ label: `covers ${p.covers} PR${p.covers === 1 ? "" : "s"}`, tone: "muted" });
  for (const k of ["done", "not_done", "unknown", "yes", "no", "not_required", "other"]) {
    const n = p.rows[k];
    if (n) out.push({ label: `${n} ${ROW_LABEL[k]}`, tone: ROW_TONE[k] });
  }
  if (p.unknowns > 0) out.push({ label: `${p.unknowns} open question${p.unknowns === 1 ? "" : "s"}`, tone: "warn" });
  return out;
}

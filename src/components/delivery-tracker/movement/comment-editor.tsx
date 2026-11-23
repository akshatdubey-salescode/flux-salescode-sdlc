"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiArrowRightSLine, RiPencilLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { api } from "./api";
import type { CommentPreview, CommentsResponse, CommentView, ItemView } from "./api-types";
import { canSave, commentBadges, commentTabLabel, effectiveText, isDirty, lengthProblem, PREVIEW_DEBOUNCE_MS, previewChips, RESET_WARNING, SAVE_WARNING, type PreviewState } from "./comment-edit";
import { Linkified } from "./linkified";
import { Chip, GuardedButton, useFocusReturn } from "./ui-bits";
import { describeApiError, type ActionState, type ApiErrorBody } from "./view-model";

/**
 * "Edit comment" for one Jira: a managers' button (only while the movement can still change) that opens the review comment(s) of the Jira for correction
 * in Flux. Jira stays read-only: the edit is an overlay the checklist uses. Left: the text (monospace, spellcheck off); right: the original (collapsible,
 * read-only) and a live preview (the server parses the text and says what the checklist would get, or why it cannot).
 */
export function CommentEditButton({ base, item, edit, onSaved }: { base: string; item: ItemView; edit: ActionState; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const focus = useFocusReturn();
  return (
    <>
      <GuardedButton variant="outline" size="sm" className="h-6 gap-1 text-[11px]" disabled={!edit.allowed} reason={edit.reason} onClick={() => { focus.remember([`movement-comment-edit-${item.key}`]); setOpen(true); }} data-testid={`movement-comment-edit-${item.key}`}>
        <RiPencilLine className="size-3.5" /> Edit comment
      </GuardedButton>
      {open && <CommentEditor base={base} item={item} onClose={() => setOpen(false)} onSaved={onSaved} onCloseAutoFocus={focus.onCloseAutoFocus} />}
    </>
  );
}

type Load = { phase: "loading" } | { phase: "ok"; data: CommentsResponse } | { phase: "error"; message: string };

function CommentEditor({ base, item, onClose, onSaved, onCloseAutoFocus }: { base: string; item: ItemView; onClose: () => void; onSaved: () => void; onCloseAutoFocus: (e: Event) => void }) {
  const url = `${base}/items/${encodeURIComponent(item.issueId)}/comment`;
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    api<CommentsResponse>(url, { signal: ctl.signal, timeoutMs: 30_000, fallbackError: "Could not load the comment" }).then((r) => {
      if (ctl.signal.aborted || r.aborted) return;
      setLoad(!r.ok || !r.data ? { phase: "error", message: r.error ?? "Could not load the comment" } : { phase: "ok", data: r.data });
    });
    return () => ctl.abort();
  }, [url, attempt]);

  return (
    <Dialog open onOpenChange={(o) => !o && load.phase !== "ok" && onClose()}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-none flex-col gap-2 sm:max-w-6xl" data-testid="movement-comment-editor" onCloseAutoFocus={onCloseAutoFocus} showCloseButton={load.phase !== "ok"} onEscapeKeyDown={(e) => load.phase === "ok" && e.preventDefault()} onInteractOutside={(e) => load.phase === "ok" && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Edit the review comment of {item.key}</DialogTitle>
          <DialogDescription>Corrections are kept in Flux; the Jira comment is not changed. The checklist uses the edited text.</DialogDescription>
        </DialogHeader>
        {load.phase === "loading" && <p className="text-xs text-muted-foreground">Loading the comment…</p>}
        {load.phase === "error" && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
            {load.message}
            <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => { setLoad({ phase: "loading" }); setAttempt((n) => n + 1); }}>
              Retry
            </Button>
          </div>
        )}
        {load.phase === "ok" && <EditorBody url={url} data={load.data} onClose={onClose} onSaved={onSaved} />}
        {load.phase !== "ok" && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The live preview: checking, why the text cannot be used, or what the checklist would get (chips + the parser's warnings). */
export function PreviewBox({ state }: { state: PreviewState }) {
  return (
    <div className="space-y-1 rounded-md border border-border p-2" data-testid="movement-comment-preview" aria-live="polite">
      <p className="text-xs font-semibold">Preview</p>
      {state.phase === "pending" && <p className="text-[11px] text-muted-foreground">Checking the text…</p>}
      {state.phase === "error" && (
        <p role="alert" className="text-[11px] text-red-700 dark:text-red-400" data-testid="movement-comment-preview-error">
          {state.message}
        </p>
      )}
      {state.phase === "ok" && (
        <>
          <div className="flex flex-wrap gap-1">
            {previewChips(state.preview).map((p) => (
              <Chip key={p.label} tone={p.tone}>
                {p.label}
              </Chip>
            ))}
          </div>
          {state.preview.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-amber-700 dark:text-amber-400">
              {state.preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function EditorBody({ url, data, onClose, onSaved }: { url: string; data: CommentsResponse; onClose: () => void; onSaved: () => void }) {
  const [at, setAt] = useState(0);
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(data.comments.map((c) => [c.commentId, effectiveText(c)])));
  const c: CommentView | undefined = data.comments[at];
  if (!c) return <p className="text-xs text-muted-foreground">This Jira has no review comment to edit.</p>;
  const text = texts[c.commentId] ?? "";
  const dirtyAny = data.comments.some((x) => isDirty(texts[x.commentId] ?? "", x));
  return (
    <CommentPane key={c.commentId} url={url} c={c} jiraAvailable={data.jiraAvailable} more={data.more} tabs={data.comments} at={at} onTab={setAt} text={text} onText={(t) => setTexts((s) => ({ ...s, [c.commentId]: t }))} dirtyAny={dirtyAny} onClose={onClose} onSaved={onSaved} />
  );
}

export function CommentPane({
  url,
  c,
  jiraAvailable,
  more,
  tabs,
  at,
  onTab,
  text,
  onText,
  dirtyAny,
  onClose,
  onSaved,
}: {
  url: string;
  c: CommentView;
  jiraAvailable: boolean;
  more: number;
  tabs: CommentView[];
  at: number;
  onTab: (i: number) => void;
  text: string;
  onText: (t: string) => void;
  dirtyAny: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [preview, setPreview] = useState<{ forText: string; state: PreviewState } | null>(null);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"save" | "reset" | "discard" | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const seq = useRef(0);

  // Live preview: 600 ms after the last keystroke; an older answer never replaces a newer one.
  useEffect(() => {
    if (lengthProblem(text)) return;
    const ctl = new AbortController();
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const r = await api<{ preview: CommentPreview }>(`${url}/preview`, { method: "POST", body: { commentId: c.commentId, text }, signal: ctl.signal, timeoutMs: 20_000, fallbackError: "Could not check the text" });
      if (ctl.signal.aborted || r.aborted || mine !== seq.current) return;
      setPreview({ forText: text, state: r.ok && r.data ? { phase: "ok", preview: r.data.preview } : { phase: "error", message: describeApiError(r.status, r.body as ApiErrorBody | null, "Could not check the text") } });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [url, c.commentId, text]);

  const local = lengthProblem(text);
  const state: PreviewState = local ? { phase: "error", message: local } : preview && preview.forText === text ? preview.state : { phase: "pending" };
  const save = canSave(text, c, state);
  const badges = commentBadges(c, jiraAvailable);

  const send = useCallback(
    async (kind: "save" | "reset") => {
      setBusy(kind);
      setError(null);
      const r =
        kind === "save"
          ? await api<{ checklistChanged: boolean }>(url, { method: "PUT", body: { commentId: c.commentId, text }, timeoutMs: 30_000, fallbackError: "Could not save the comment" })
          : await api<{ checklistChanged: boolean }>(`${url}?commentId=${encodeURIComponent(c.commentId)}`, { method: "DELETE", timeoutMs: 30_000, fallbackError: "Could not reset the comment" });
      setBusy(null);
      setConfirm(null);
      if (!r.ok) {
        setError(r.error ?? "Something went wrong");
        return;
      }
      toast.success(kind === "save" ? "Comment saved in Flux" : "Back to the Jira version");
      onSaved();
      onClose();
    },
    [url, c.commentId, text, onSaved, onClose]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Review comments of this Jira" className="flex flex-wrap gap-1">
          {tabs.map((t, i) => (
            <button key={t.commentId} type="button" role="tab" aria-selected={i === at} onClick={() => onTab(i)} className={cn("rounded-md border px-2 py-0.5 text-[11px]", i === at ? "border-primary bg-primary/10 font-semibold" : "border-border text-muted-foreground")} data-testid={`movement-comment-tab-${i}`}>
              {commentTabLabel(t, i)}
            </button>
          ))}
        </div>
      )}
      {more > 0 && <p className="text-[11px] text-muted-foreground">{more} more comment{more === 1 ? "" : "s"} of this Jira are not listed.</p>}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="movement-comment-badges">
        {badges.map((b) => (
          <Chip key={b.testId} tone={b.tone} testId={b.testId}>
            {b.text}
          </Chip>
        ))}
        {c.covers.length > 0 && <span className="text-[11px] text-muted-foreground">covers {c.covers.join(", ")}</span>}
      </div>
      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-1">
          <label htmlFor="movement-comment-text" className="text-xs font-medium">
            Text ({text.length.toLocaleString("en-IN")} characters)
          </label>
          <textarea
            id="movement-comment-text"
            data-testid="movement-comment-text"
            value={text}
            onChange={(e) => onText(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            rows={22}
            className="min-h-64 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-[11px] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
        <div className="space-y-2">
          <PreviewBox state={state} />
          <div className="rounded-md border border-border">
            <button type="button" aria-expanded={showOriginal} onClick={() => setShowOriginal((v) => !v)} className="flex w-full items-center gap-1 px-2 py-1 text-left text-xs font-semibold focus-visible:outline-2 focus-visible:outline-ring" data-testid="movement-comment-original-toggle">
              <RiArrowRightSLine className={cn("size-3.5 transition-transform", showOriginal && "rotate-90")} /> Original (Jira, read-only)
            </button>
            {showOriginal && (
              <div className="max-h-72 overflow-auto border-t border-border p-2" data-testid="movement-comment-original">
                {c.original === null ? (
                  <p className="text-[11px] text-muted-foreground">Original not available{jiraAvailable ? " (left out for size)" : " (Jira could not be read)"}. You can still edit the text shown.</p>
                ) : (
                  <pre className="whitespace-pre-wrap font-mono text-[11px] [overflow-wrap:anywhere]">
                    <Linkified text={c.original} />
                  </pre>
                )}
                {c.originalTruncated && <p className="text-[11px] text-muted-foreground">The original is cut for size.</p>}
              </div>
            )}
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive" data-testid="movement-comment-error">
          {error}
        </p>
      )}
      <DialogFooter className="items-center">
        {c.edited !== null && (
          <Button variant="ghost" size="sm" className="mr-auto h-7 text-[11px] text-destructive" disabled={busy !== null} onClick={() => setConfirm("reset")} data-testid="movement-comment-reset">
            Reset to Jira version
          </Button>
        )}
        {!save.ok && save.reason && <span className="text-[11px] text-muted-foreground" data-testid="movement-comment-save-reason">{save.reason}</span>}
        <Button variant="outline" onClick={() => (dirtyAny ? setConfirm("discard") : onClose())} disabled={busy !== null} data-testid="movement-comment-close">
          Close
        </Button>
        <Button onClick={() => setConfirm("save")} disabled={!save.ok || busy !== null} data-testid="movement-comment-save">
          {busy === "save" ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent data-testid="movement-comment-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "save" ? "Save this comment?" : confirm === "reset" ? "Reset to the Jira version?" : "Discard your changes?"}</AlertDialogTitle>
            <AlertDialogDescription>{confirm === "save" ? SAVE_WARNING : confirm === "reset" ? RESET_WARNING : "You have unsaved changes in this editor."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Keep editing</AlertDialogCancel>
            <Button variant={confirm === "save" ? "default" : "destructive"} disabled={busy !== null} data-testid="movement-comment-confirm-yes" onClick={() => (confirm === "discard" ? onClose() : confirm && void send(confirm))}>
              {confirm === "save" ? "Save" : confirm === "reset" ? "Reset" : "Discard"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiCheckLine, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { canComment, canResolve, MAX_COMMENT_LENGTH } from "@/lib/test-cases/state";
import type { CommentView } from "@/lib/test-cases/review-service";

export type Viewer = { email: string; isAdmin: boolean };

const KIND_STYLE: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  changes_requested: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
};
const KIND_LABEL: Record<string, string> = { approved: "Approved", changes_requested: "Requested changes" };

/**
 * Feedback on a round (caseId null) or on one test case. Reads come from the
 * server page; writes call the API and then refresh the page's data.
 */
export function CommentThread({
  roundId,
  caseId,
  comments,
  viewer,
  reviewers,
  committerEmail,
  readOnly,
}: {
  roundId: string;
  caseId: string | null;
  comments: CommentView[];
  viewer: Viewer;
  reviewers: { email: string }[];
  committerEmail: string;
  /** Older rounds: feedback stays visible but can't be added to. */
  readOnly: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = comments.filter((c) => (c.caseId ?? null) === caseId);
  const mayComment = !readOnly && canComment(viewer, reviewers, committerEmail).ok;

  async function post() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/test-cases/rounds/${roundId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, body: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not add the comment.");
        return;
      }
      setText("");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleResolved(c: CommentView) {
    setError(null);
    const res = await fetch(`/api/test-cases/comments/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: !c.resolved }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Could not update the comment.");
    else router.refresh();
  }

  return (
    <div className="space-y-2">
      {mine.length === 0 && !mayComment && <p className="text-[11px] text-muted-foreground">No feedback yet.</p>}
      <ul className="space-y-1.5">
        {mine.map((c) => (
          <li
            key={c.id}
            className={cn(
              "rounded-lg border px-3 py-2 text-xs",
              c.resolved ? "border-zinc-200 bg-zinc-50/60 opacity-70 dark:border-zinc-800 dark:bg-zinc-900/40" : "border-zinc-200 dark:border-zinc-700",
            )}
          >
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">{c.authorName ?? c.authorEmail}</span>
              <span>{c.createdLabel}</span>
              {c.kind !== "comment" && (
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", KIND_STYLE[c.kind])}>{KIND_LABEL[c.kind]}</span>
              )}
              {c.resolved && (
                <span className="inline-flex items-center gap-0.5 text-emerald-600">
                  <RiCheckLine className="size-3" />
                  Resolved
                </span>
              )}
              {c.kind === "comment" && !readOnly && canResolve(viewer, c.authorEmail, reviewers, committerEmail).ok && (
                <button type="button" onClick={() => toggleResolved(c)} className="ml-auto text-primary hover:underline">
                  {c.resolved ? "Reopen" : "Resolve"}
                </button>
              )}
            </div>
            {c.body && <p className="mt-1 whitespace-pre-wrap text-foreground">{c.body}</p>}
          </li>
        ))}
      </ul>

      {mayComment && (
        <div className="space-y-1.5">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_COMMENT_LENGTH}
            placeholder={caseId ? "Comment on this test case…" : "Comment on this round…"}
            className="min-h-14 text-xs"
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={post} disabled={!text.trim() || busy}>
              {busy && <RiLoader4Line className="size-3.5 animate-spin" />}
              Add comment
            </Button>
            {error && <span className="text-[11px] text-destructive">{error}</span>}
          </div>
        </div>
      )}
      {!mayComment && error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

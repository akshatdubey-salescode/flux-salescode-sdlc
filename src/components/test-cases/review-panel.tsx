"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiDownload2Line, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { canDecide } from "@/lib/test-cases/state";
import { TC_REVIEWER_STATE_LABELS, type TcReviewerState } from "@/lib/test-cases/values";
import type { CommentView, FeedbackFileView } from "@/lib/test-cases/review-service";
import { CommentThread, type Viewer } from "./comment-thread";
import { invalidateTcSummaries } from "./tc-summary-cache";

const STATE_STYLE: Record<string, string> = {
  pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  changes_requested: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
};

type ReviewerRow = { email: string; name: string | null; state: string; decidedAt: string | null };

export function ReviewPanel({
  roundId,
  isLatest,
  reviewers,
  comments,
  feedbackFiles,
  viewer,
  committerEmail,
}: {
  roundId: string;
  isLatest: boolean;
  reviewers: ReviewerRow[];
  comments: CommentView[];
  feedbackFiles: FeedbackFileView[];
  viewer: Viewer;
  committerEmail: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "approved" | "changes_requested">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const may = canDecide(viewer, reviewers, isLatest);
  const mine = reviewers.find((r) => r.email.toLowerCase() === viewer.email.toLowerCase());

  async function submit() {
    if (!mode || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/test-cases/rounds/${roundId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: mode, comment: note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save your decision.");
        return;
      }
      setMode(null);
      setNote("");
      invalidateTcSummaries();
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Review</h2>
        <a
          href={`/api/test-cases/rounds/${roundId}/feedback`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          <RiDownload2Line className="size-3.5" />
          Download feedback
        </a>
      </div>

      <ul className="flex flex-wrap gap-2">
        {reviewers.map((rv) => (
          <li key={rv.email} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700">
            <span className="font-medium text-foreground">{rv.name ?? rv.email}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", STATE_STYLE[rv.state])}>
              {TC_REVIEWER_STATE_LABELS[rv.state as TcReviewerState] ?? rv.state}
            </span>
          </li>
        ))}
      </ul>

      {may.ok && (
        <div className="space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/40">
          <p className="text-xs text-muted-foreground">
            {mine?.state && mine.state !== "pending"
              ? `You ${mine.state === "approved" ? "approved" : "requested changes to"} this round. You can change your decision.`
              : "You're a reviewer on this round. Check the test cases below, add feedback, then decide."}
          </p>
          {mode === null ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => setMode("approved")}>
                Approve
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setMode("changes_requested")}>
                Request changes
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={4000}
                placeholder={mode === "approved" ? "Optional note…" : "What needs to change? (required)"}
                className="min-h-16 text-xs"
              />
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={submit} disabled={busy || (mode === "changes_requested" && !note.trim())}>
                  {busy && <RiLoader4Line className="size-3.5 animate-spin" />}
                  {mode === "approved" ? "Confirm approval" : "Send change request"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setMode(null); setError(null); }} disabled={busy}>
                  Cancel
                </Button>
                {error && <span className="text-[11px] text-destructive">{error}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Feedback on this round</p>
        <CommentThread
          roundId={roundId}
          caseId={null}
          comments={comments}
          viewer={viewer}
          reviewers={reviewers}
          committerEmail={committerEmail}
          readOnly={!isLatest}
        />
      </div>

      {feedbackFiles.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Saved feedback files</p>
          <ul className="space-y-0.5 text-[11px]">
            {feedbackFiles.map((f) => (
              <li key={f.id}>
                <a href={`/api/test-cases/files/${f.id}`} className="text-primary hover:underline" title={f.fileName}>
                  {f.label}
                </a>
                <span className="text-muted-foreground"> · {f.uploadedByName ?? "reviewer"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiAlertLine, RiDownload2Line, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { canApprove, canDecide, canOverride } from "@/lib/test-cases/state";
import { TC_REVIEWER_STATE_LABELS, type TcReviewerState } from "@/lib/test-cases/values";
import type { CommentView, FeedbackFileView } from "@/lib/test-cases/review-service";
import { CommentThread, type Viewer } from "./comment-thread";
import { invalidateTcSummaries } from "./tc-summary-cache";

const STATE_STYLE: Record<string, string> = {
  pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  changes_requested: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  re_review: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  overridden: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
};

type ReviewerRow = { email: string; name: string | null; state: TcReviewerState; decidedAt: string | null; decidedRoundNo: number | null };

export function ReviewPanel({
  roundId,
  roundNo,
  isLatest,
  reviewers,
  comments,
  feedbackFiles,
  viewer,
  committerEmail,
}: {
  roundId: string;
  roundNo: number;
  isLatest: boolean;
  reviewers: ReviewerRow[];
  comments: CommentView[];
  feedbackFiles: FeedbackFileView[];
  viewer: Viewer;
  committerEmail: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "approved" | "changes_requested" | "override">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const may = canDecide(viewer, reviewers, isLatest);
  const mine = reviewers.find((r) => r.email.toLowerCase() === viewer.email.toLowerCase());
  // Approving is blocked while someone else's change request stands; override is the way past it.
  const approveCheck = canApprove(viewer, reviewers);
  const blockers = reviewers.filter((r) => r.state === "changes_requested");
  const waiting = reviewers.filter((r) => r.state === "re_review");
  const openComments = comments.filter((c) => c.kind === "comment" && !c.resolved);
  const overrideCheck = canOverride({
    actor: viewer,
    reviewers,
    isLatestRound: isLatest,
    openFeedback: blockers.length > 0 || waiting.length > 0 || openComments.length > 0,
  });

  async function submit() {
    if (!mode || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "override"
          ? await fetch(`/api/test-cases/rounds/${roundId}/override`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason: note }),
            })
          : await fetch(`/api/test-cases/rounds/${roundId}/decision`, {
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
              {TC_REVIEWER_STATE_LABELS[rv.state] ?? rv.state}
            </span>
            {rv.decidedRoundNo !== null && rv.decidedRoundNo < roundNo && (rv.state === "approved" || rv.state === "overridden") && (
              <span className="text-[10px] text-muted-foreground" title="Decided on an earlier round and carried over to this one">
                Round {rv.decidedRoundNo}
              </span>
            )}
          </li>
        ))}
      </ul>

      {blockers.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <RiAlertLine className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-semibold">Resubmit TCs</p>
            <p>
              {blockers.map((b) => b.name ?? b.email).join(", ")} asked for changes. The submitter fixes the sheet and resubmits; until then nobody else can
              approve and sign-off stays closed. A reviewer can override the feedback to move ahead.
            </p>
          </div>
        </div>
      )}
      {blockers.length === 0 && waiting.length > 0 && (
        <p className="rounded-lg bg-sky-50 p-3 text-xs text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
          Resubmitted. Waiting for {waiting.map((b) => b.name ?? b.email).join(", ")} to re-review; approvals given earlier still stand.
        </p>
      )}

      {may.ok && (
        <div className="space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/40">
          <p className="text-xs text-muted-foreground">
            {mine?.state && mine.state !== "pending"
              ? mine.state === "re_review"
                ? "You asked for changes earlier and the sheet was resubmitted. Check it and decide again."
                : mine.state === "overridden"
                  ? "Your feedback was overridden by another reviewer. You can still decide again."
                  : `You ${mine.state === "approved" ? "approved" : "requested changes to"} this round. You can change your decision.`
              : "You're a reviewer on this round. Check the test cases below, add feedback, then decide."}
          </p>
          {mode === null ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => setMode("approved")} disabled={!approveCheck.ok}>
                  Approve
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setMode("changes_requested")}>
                  Request changes
                </Button>
                {overrideCheck.ok && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setMode("override")} className="border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300">
                    Override feedback and approve
                  </Button>
                )}
              </div>
              {!approveCheck.ok && <p className="text-[11px] text-amber-700 dark:text-amber-400">{approveCheck.reason}</p>}
            </div>
          ) : (
            <div className="space-y-2">
              {mode === "override" && (
                <div className="rounded-md border border-violet-200 bg-violet-50 p-2 text-[11px] text-violet-900 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200">
                  <p className="font-semibold">This will, in one step:</p>
                  <ul className="mt-0.5 list-disc pl-4">
                    {[...blockers, ...waiting].map((b) => (
                      <li key={b.email}>waive the feedback of {b.name ?? b.email}</li>
                    ))}
                    {openComments.length > 0 && <li>waive {openComments.length} open comment{openComments.length === 1 ? "" : "s"}</li>}
                    <li>approve this round as you</li>
                  </ul>
                  <p className="mt-0.5">It is recorded in the review history, with your reason, for everyone to see.</p>
                </div>
              )}
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={4000}
                placeholder={
                  mode === "approved" ? "Optional note…" : mode === "override" ? "Why can this feedback be ignored? (required)" : "What needs to change? (required)"
                }
                className="min-h-16 text-xs"
                aria-label={mode === "override" ? "Reason for overriding the feedback" : mode === "changes_requested" ? "What needs to change" : "Optional note"}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={submit}
                  disabled={busy || ((mode === "changes_requested" || mode === "override") && !note.trim())}
                >
                  {busy && <RiLoader4Line className="size-3.5 animate-spin" />}
                  {mode === "approved" ? "Confirm approval" : mode === "override" ? "Override and approve" : "Send change request"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setMode(null); setError(null); }} disabled={busy}>
                  Cancel
                </Button>
                {error && (
                  <span className="text-[11px] text-destructive">
                    {error}
                    {/superseded/i.test(error) && (
                      <button type="button" onClick={() => router.refresh()} className="ml-1.5 font-semibold underline underline-offset-2">
                        Reload
                      </button>
                    )}
                  </span>
                )}
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

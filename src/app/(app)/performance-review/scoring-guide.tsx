"use client";

// In-app explainer of every score field + the cross-cutting rules. Opens in a
// modal (triggered from a small button) so it doesn't clutter the page above
// the leaderboard. All copy comes from metric-descriptions.ts (which derives
// its numbers from config), so this stays correct as the engine changes.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  METRIC_INFO,
  DATE_CAPTURE_NOTE,
  ATTRIBUTION_NOTE,
  SCOPE_NOTE,
  BOARD_NOTE,
  COMPLEXITY_LOC_NOTE,
} from "@/lib/scorecard/metric-descriptions";
import { WEIGHTS, type MetricKey } from "@/lib/scorecard/config";

// Scored metrics first (highest weight → lowest), then the not-scored ones.
const ORDER: { key: MetricKey; label: string }[] = [
  { key: "bugQuality", label: "Bug Quality" },
  { key: "complexTasks", label: "Complex Tasks" },
  { key: "sprintCommitment", label: "Sprint Commitment" },
  { key: "mttr", label: "MTTR" },
  { key: "codeChurn", label: "Code Churn" },
  { key: "aiTasks", label: "AI Tasks" },
  { key: "effort", label: "Effort" },
];

const NOTES = [
  DATE_CAPTURE_NOTE,
  ATTRIBUTION_NOTE,
  SCOPE_NOTE,
  BOARD_NOTE,
  COMPLEXITY_LOC_NOTE,
];

export function ScoringGuide() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          How scores are calculated
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>How scores are calculated</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Suggested quarterly ratings for developers, scored out of 100 and
            derived from synced Jira data across four weighted metrics — Bug
            Quality ({WEIGHTS.bugQuality}), Complex Tasks ({WEIGHTS.complexTasks}),
            Sprint Commitment ({WEIGHTS.sprintCommitment}), and MTTR ({WEIGHTS.mttr}).{" "}
            <strong>Score</strong> counts every completed Jira, unfiltered.{" "}
            <strong>Score NSA. (E)</strong> is the same formula and scale,
            but self-assigned Jiras are excluded and Complex Tasks is
            weighted by LOC-predicted complexity instead of marked — the
            only other column directly comparable to Score. Alongside them,
            four Jira Complexity Rating columns isolate just the Complex
            Tasks contribution (out of 30 — the other 70 points of Score
            are the same regardless of complexity source or
            self-assignment, so they&apos;re left out to keep the comparison
            clean): <strong>Complex. (M)</strong> and{" "}
            <strong>Complex. (E)</strong> keep every Jira (identical
            population to Score — marked vs. LOC-predicted complexity);{" "}
            <strong>Complex. NSA. (M)</strong> and{" "}
            <strong>Complex. NSA. (E)</strong> exclude self-assigned Jiras
            (reporter === credited person) entirely. Complexity Accuracy —
            both an all-Jiras and a non-self-assigned reading — moved into
            the per-developer breakdown; use the details icon to see it.
            Ratings are a decision aid, not a verdict.
          </p>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Final score is each metric&apos;s points (0–5) × its weight, summed and
            scaled to 0–100. Only the four weighted metrics below count; the rest
            are shown for context.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {ORDER.map(({ key, label }) => {
              const info = METRIC_INFO[key];
              const scored = info.range !== "N/A";
              return (
                <div
                  key={key}
                  className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {label}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {scored ? `${info.weightPct} of score` : "not scored"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {info.summary}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {info.detail}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {NOTES.map((note) => (
              <div key={note.title}>
                <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  {note.title}
                </h4>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {note.intro}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-zinc-500 dark:text-zinc-400">
                  {note.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

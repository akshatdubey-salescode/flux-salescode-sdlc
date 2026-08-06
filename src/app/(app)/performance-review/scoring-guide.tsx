// In-app explainer of every score field + the cross-cutting rules. Collapsible
// so it sits unobtrusively above the leaderboard. All copy comes from
// metric-descriptions.ts (which derives its numbers from config), so this stays
// correct as the engine changes.
import {
  METRIC_INFO,
  DATE_CAPTURE_NOTE,
  ATTRIBUTION_NOTE,
  SCOPE_NOTE,
  BOARD_NOTE,
  ADJUSTED_SCORE_NOTE,
} from "@/lib/scorecard/metric-descriptions";
import type { MetricKey } from "@/lib/scorecard/config";

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
  ADJUSTED_SCORE_NOTE,
];

export function ScoringGuide() {
  return (
    <details className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-zinc-800 marker:text-zinc-400 dark:text-zinc-200">
        How scores are calculated
      </summary>
      <div className="space-y-5 border-t border-zinc-100 px-4 py-4 dark:border-zinc-800/60">
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
    </details>
  );
}

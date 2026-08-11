"use client";

// The "What each metric means" / "How dates are captured" explainer, in a
// modal opened from a button next to the heading — mirrors ScoringGuide's
// placement/pattern on the main leaderboard page. Keeps the drill-down page
// itself to the score summary, the always-visible metric grid, and the
// weighted-bugs/features/etc. tables; the per-metric prose explanation lives
// behind this button instead of always being on screen.
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { METRIC_INFO, DATE_CAPTURE_NOTE } from "@/lib/scorecard/metric-descriptions";
import { formatComplexityAccuracy } from "./complexity-accuracy-stat";
import type { ScorecardDetail } from "./data";

function fmtPoints(p: number | null | undefined): string {
  return p == null ? "—" : p.toFixed(2);
}

/** One Complexity Accuracy reading: correct/checked (pct%), or a dash. */
function ComplexityAccuracyStat({
  correct,
  checked,
}: {
  correct: number;
  checked: number;
}) {
  return <>{formatComplexityAccuracy(correct, checked)}</>;
}

const ALL_JIRAS_INFO =
  "Includes every completed Jira, including self-created-and-assigned ones — same population as Score.";
const NSA_INFO =
  "Excludes self-assigned Jiras — issues where the reporter is also the person credited for the work. Score is unaffected; only this reading reflects that exclusion.";
const MARKED_FORMULA =
  "The Complex Tasks metric's own contribution only (weight 0.30 × points × scale 20, so 0-30) — weighted by each task's marked complexity. Bug Quality/MTTR/Sprint Commitment (the other 70 points of Score) are deliberately left out, so this column isn't diluted by metrics that don't vary with complexity.";
const EXPECTED_FORMULA =
  "Same as the Marked rating in this population, except weighted by each task's LOC-predicted complexity instead of the marked value.";
const SCORE_NSA_E_INFO =
  "Same formula as Score (Bug Quality + MTTR + Sprint Commitment + Complex Tasks), but computed with self-assigned Jiras excluded and Complex Tasks weighted by LOC-predicted complexity instead of marked. Unlike Complex. NSA. (E) below (Complex Tasks contribution alone, 0-30), this is the full four-metric composite, 0-100 — directly comparable to Score.";

export function MetricMeaningModal({ detail }: { detail: ScorecardDetail }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          What each metric means
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>What each metric means</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900/60 dark:bg-blue-950/30">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {DATE_CAPTURE_NOTE.title}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {DATE_CAPTURE_NOTE.intro}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {DATE_CAPTURE_NOTE.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
          <dl className="space-y-3">
            {detail.breakdown.metrics.map((m) => {
              const info = METRIC_INFO[m.key];
              return (
                <Fragment key={m.key}>
                  <div
                    className={
                      "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 " +
                      (m.available ? "" : "opacity-70")
                    }
                  >
                    <dt className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {m.label}
                      </span>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        weight {m.weight.toFixed(2)}
                      </span>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        range {info.range}
                      </span>
                      {m.weight === 0 && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                          does not affect score
                        </span>
                      )}
                    </dt>
                    <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {info.detail}
                    </dd>
                    <dd className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                      This developer:{" "}
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {m.available ? m.raw : "N/A — not tracked"}
                      </span>{" "}
                      →{" "}
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        {m.available
                          ? `${fmtPoints(m.points)} points`
                          : "no points"}
                      </span>
                      {m.available && m.weight > 0 && (
                        <>
                          {" "}
                          (contributes {m.contribution.toFixed(2)} to the
                          final score)
                        </>
                      )}
                    </dd>
                  </div>
                  {m.key === "codeChurn" && (
                    <>
                      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                        <dt className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            Complex. (M)
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            all Jiras
                          </span>
                        </dt>
                        <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                          {ALL_JIRAS_INFO}
                        </dd>
                        <dd className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                          {MARKED_FORMULA}
                        </dd>
                        <dd className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                          This developer:{" "}
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {detail.markedComplexityScoreAll.toFixed(1)} / 30
                          </span>
                        </dd>
                      </div>
                      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                        <dt className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            Complex. (E)
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            all Jiras
                          </span>
                        </dt>
                        <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                          {ALL_JIRAS_INFO}
                        </dd>
                        <dd className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                          {EXPECTED_FORMULA}
                        </dd>
                        <dd className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                          This developer:{" "}
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {detail.expectedComplexityScoreAll.toFixed(1)} / 30
                          </span>
                        </dd>
                      </div>
                      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                        <dt className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            Complex. NSA. (M)
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            self-assigned excluded
                          </span>
                        </dt>
                        <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                          {NSA_INFO}
                        </dd>
                        <dd className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                          {MARKED_FORMULA}
                        </dd>
                        <dd className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                          This developer:{" "}
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {detail.markedComplexityScore.toFixed(1)} / 30
                          </span>
                        </dd>
                      </div>
                      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                        <dt className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            Complex. NSA. (E)
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            self-assigned excluded
                          </span>
                        </dt>
                        <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                          {NSA_INFO}
                        </dd>
                        <dd className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                          {EXPECTED_FORMULA}
                        </dd>
                        <dd className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                          This developer:{" "}
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {detail.expectedComplexityScore.toFixed(1)} / 30
                          </span>
                        </dd>
                      </div>
                      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                        <dt className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            Score NSA. (E)
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            full composite, not Complex Tasks alone
                          </span>
                        </dt>
                        <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                          {SCORE_NSA_E_INFO}
                        </dd>
                        <dd className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                          This developer:{" "}
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {detail.scoreNsaExpected.toFixed(1)} / 100
                          </span>
                        </dd>
                      </div>
                      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                        <dt className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            Complexity Accuracy (All Jiras)
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            all Jiras
                          </span>
                        </dt>
                        <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                          {ALL_JIRAS_INFO}
                        </dd>
                        <dd className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                          This developer:{" "}
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            <ComplexityAccuracyStat
                              correct={detail.complexityAccuracyAllCorrect}
                              checked={detail.complexityAccuracyAllChecked}
                            />
                          </span>
                        </dd>
                      </div>
                      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                        <dt className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            Complexity Accuracy (NSA only)
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            self-assigned excluded
                          </span>
                        </dt>
                        <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                          {NSA_INFO}
                        </dd>
                        <dd className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                          This developer:{" "}
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            <ComplexityAccuracyStat
                              correct={detail.complexityAccuracyCorrect}
                              checked={detail.complexityAccuracyChecked}
                            />
                          </span>
                        </dd>
                      </div>
                    </>
                  )}
                </Fragment>
              );
            })}
          </dl>
        </div>
      </DialogContent>
    </Dialog>
  );
}

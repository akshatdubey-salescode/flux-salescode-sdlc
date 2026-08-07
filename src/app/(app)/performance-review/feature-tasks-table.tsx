"use client";

import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import type { ScorecardFeatureItem } from "./data";
import { filterFeatureTasks } from "./feature-tasks-filter";

/**
 * Renders a Jira issue key. When the issue's instance URL is known it links to
 * the original Jira issue, opening in a new tab; otherwise it's plain text.
 * Local copy of page.tsx's JiraKeyLink — kept colocated here rather than
 * shared, same pattern as Contribution() in leaderboard-table.tsx.
 */
function JiraKeyLink({ item }: { item: { key: string; url?: string } }) {
  if (!item.url) return <>{item.key}</>;
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:underline dark:text-blue-400"
    >
      {item.key}
    </a>
  );
}

/** Small "i" badge, same hover/focus pattern as the leaderboard's header badges. */
function InfoBadge({ text }: { text: string }) {
  return (
    <span
      tabIndex={0}
      title={text}
      className="inline-flex cursor-help rounded-full border border-zinc-300 px-1 text-[10px] leading-4 text-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:text-zinc-300"
    >
      i
    </span>
  );
}

/**
 * This table itself (Key/Summary/Complexity) predates this branch entirely —
 * see git history on page.tsx (1a3f775, Akshat Dubey). Everything this file
 * does is opt-in on top of it: the toggle defaults OFF, showing every task
 * exactly as it's always shown; switching it on only *hides* self-assigned
 * rows client-side, it never changes what's fetched or scored. Nobody who
 * doesn't touch the toggle sees any different behavior than before.
 */
export function FeatureTasksTable({ items }: { items: ScorecardFeatureItem[] }) {
  const [nonSelfAssignedOnly, setNonSelfAssignedOnly] = useState(false);

  const visible = useMemo(
    () => filterFeatureTasks(items, nonSelfAssignedOnly),
    [items, nonSelfAssignedOnly],
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Feature tasks ({visible.length}
          {nonSelfAssignedOnly && visible.length !== items.length ? ` of ${items.length}` : ""})
        </h2>
        <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Switch
            checked={nonSelfAssignedOnly}
            onCheckedChange={setNonSelfAssignedOnly}
          />
          Non-self-assigned only
          <InfoBadge text="Off (default): shows every feature task, exactly as this table has always shown it. On: hides self-assigned tasks (reporter also the credited person) — they still count toward Score either way, this only changes what's displayed here." />
        </label>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Non-bug tasks the developer completed this quarter, counted as
        feature output for the Bug Quality score.{" "}
        <strong>Expected</strong> is what complexity the task&apos;s
        matched LOC predicts — shown in{" "}
        <span className="font-semibold text-amber-700 dark:text-amber-400">
          amber
        </span>{" "}
        whenever it disagrees with the marked value, for any complexity
        level. The separate{" "}
        <span className="font-medium text-amber-600 dark:text-amber-400">
          ⚠ flagged
        </span>{" "}
        badge is narrower — only Complexity 4-5 tasks whose LOC is
        suspiciously low — worth a quick look, not an automatic
        downgrade. A task with no matched PR shows &ldquo;—&rdquo;
        for LOC (nothing measured), but Expected still shows{" "}
        <strong>1</strong> — no code found predicts the lowest
        complexity, same convention as an unmarked Complexity
        column defaulting to 1. Tasks marked{" "}
        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          self-assigned
        </span>{" "}
        still count here and toward Score, but are excluded from
        Complex. (M), Complex. (E), and Complexity
        Accuracy — use the toggle above to hide them.
      </p>
      <div className="max-h-96 overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="sticky top-0">
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/95">
              <th className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Key
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Summary
              </th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Complexity
              </th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                LOC
              </th>
              <th
                className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500"
                title="What complexity the matched LOC predicts (complexity-loc-thresholds.ts), for comparison against the marked value"
              >
                Expected
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr
                key={t.key}
                className={
                  "border-b border-zinc-100 last:border-0 dark:border-zinc-800/60 " +
                  (t.complexityMismatch ? "bg-amber-50 dark:bg-amber-950/20" : "")
                }
              >
                <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-xs text-zinc-600 dark:text-zinc-300">
                  <JiraKeyLink item={t} />
                </td>
                <td className="px-4 py-2.5 align-top text-zinc-700 dark:text-zinc-300">
                  {t.summary}
                  {t.complexityMismatch && (
                    <span
                      className="ml-1.5 text-amber-600 dark:text-amber-400"
                      title={t.mismatchSuggestion ?? undefined}
                    >
                      ⚠ flagged
                    </span>
                  )}
                  {t.selfAssigned && (
                    <span
                      className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      title="Reporter is also the credited person — counts toward Score, excluded from Complex. (M), Complex. (E), and Complexity Accuracy"
                    >
                      self-assigned
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  {t.complexity != null ? (
                    Math.min(5, Math.max(1, Math.round(t.complexity)))
                  ) : (
                    <span
                      title="Complexity not set in Jira — defaults to C1 (weight 1)"
                      className="text-zinc-400"
                    >
                      1
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  {t.loc != null ? (
                    t.loc
                  ) : (
                    <span className="text-zinc-400" title="No PR matched yet">
                      —
                    </span>
                  )}
                </td>
                {(() => {
                  // Same defaulting convention as the score itself
                  // (complexityWeight() in build.ts): unmarked
                  // complexity → 1, no matched PR/LOC → 1. Never a
                  // dash — always a number to compare against.
                  const marked =
                    t.complexity != null
                      ? Math.min(5, Math.max(1, Math.round(t.complexity)))
                      : 1;
                  const expected = t.expectedComplexity ?? 1;
                  const matches = marked === expected;
                  return (
                    <td className="px-4 py-2.5 text-right align-top tabular-nums">
                      {matches ? (
                        <span className="text-zinc-600 dark:text-zinc-400">{expected}</span>
                      ) : (
                        <span
                          className="font-semibold text-amber-700 dark:text-amber-400"
                          title="Marked complexity doesn't match what the matched LOC predicts"
                        >
                          {expected}
                        </span>
                      )}
                    </td>
                  );
                })()}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-zinc-400"
                >
                  {items.length === 0
                    ? "No feature tasks completed this quarter."
                    : "No non-self-assigned feature tasks this quarter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

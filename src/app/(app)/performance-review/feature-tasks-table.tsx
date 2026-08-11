"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import type { ScorecardFeatureItem } from "./data";
import { filterFeatureTasks } from "./feature-tasks-filter";
import { setSelfAssignedOverride, clearSelfAssignedOverride } from "./actions";

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

/**
 * This table itself (Key/Summary/Complexity) predates this branch entirely —
 * see git history on page.tsx (1a3f775, Akshat Dubey). Everything this file
 * does is opt-in on top of it: the toggle defaults OFF, showing every task
 * exactly as it's always shown; switching it on only *hides* self-assigned
 * rows client-side, it never changes what's fetched or scored. Nobody who
 * doesn't touch the toggle sees any different behavior than before.
 */
export function FeatureTasksTable({
  items,
  isSuperuser,
  quarterKey,
}: {
  items: ScorecardFeatureItem[];
  /** Gates the override controls — everyone else just sees the badge, same
   * as before this existed. */
  isSuperuser: boolean;
  quarterKey: string;
}) {
  const [nonSelfAssignedOnly, setNonSelfAssignedOnly] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const router = useRouter();

  const visible = useMemo(
    () => filterFeatureTasks(items, nonSelfAssignedOnly),
    [items, nonSelfAssignedOnly],
  );

  // Persists a superuser's correction (jira_self_assigned_overrides) and
  // recomputes this quarter immediately, rather than requiring a separate
  // manual Recompute click — the correction is what the superuser came here
  // to make, so it should take effect right away.
  async function handleOverride(
    jiraKey: string,
    action: "markSelf" | "markNot" | "clear",
  ) {
    setPendingKey(jiraKey);
    try {
      const res =
        action === "clear"
          ? await clearSelfAssignedOverride(jiraKey, quarterKey)
          : await setSelfAssignedOverride(jiraKey, action === "markSelf", quarterKey);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${jiraKey} updated — recomputed for this quarter.`);
      router.refresh();
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Feature tasks ({visible.length}
          {nonSelfAssignedOnly && visible.length !== items.length ? ` of ${items.length}` : ""})
        </h2>
        <label
          className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400"
          title="Off (default): shows every feature task, exactly as this table has always shown it. On: hides self-assigned tasks (reporter also the credited person) — they still count toward Score either way, this only changes what's displayed here."
        >
          <Switch
            checked={nonSelfAssignedOnly}
            onCheckedChange={setNonSelfAssignedOnly}
          />
          Non-self-assigned only
        </label>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Non-bug tasks completed this quarter, counted as feature output for
        the Bug Quality score.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <span
          className="font-semibold text-amber-700 dark:text-amber-400"
          title="What complexity the task's matched LOC predicts — shown in amber whenever it disagrees with the marked value, for any complexity level."
        >
          Amber = Expected ≠ Marked
        </span>
        <span
          className="font-medium text-amber-600 dark:text-amber-400"
          title="Only Complexity 4-5 tasks whose LOC is suspiciously low — worth a quick look, not an automatic downgrade."
        >
          ⚠ flagged = C4/C5 outlier
        </span>
        <span
          className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          title="Reporter is also the credited person — still counts here and toward Score, but excluded from Complex. (M), Complex. (E), and Complexity Accuracy. Use the toggle above to hide these rows."
        >
          self-assigned
        </span>
        <span
          className="text-zinc-500 dark:text-zinc-400"
          title="No PR matched yet — nothing measured. Expected then carries the marked value forward instead of defaulting to 1, so it never contradicts a rating nobody could actually check."
        >
          &ldquo;—&rdquo; LOC = no PR matched
        </span>
      </div>
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
                  {t.selfAssignedOverridden && (
                    <span
                      className="ml-1.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
                      title="A superuser manually overrode this Jira's self-assigned status"
                    >
                      overridden
                    </span>
                  )}
                  {isSuperuser && (
                    <button
                      type="button"
                      disabled={pendingKey === t.key}
                      onClick={() =>
                        handleOverride(
                          t.key,
                          t.selfAssignedOverridden ? "clear" : t.selfAssigned ? "markNot" : "markSelf",
                        )
                      }
                      title={
                        t.selfAssignedOverridden
                          ? "Revert to the computed reporter === credited-person comparison"
                          : `Force this Jira to count as ${t.selfAssigned ? "NOT " : ""}self-assigned`
                      }
                      className="ml-1.5 text-[10px] font-medium text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
                    >
                      {pendingKey === t.key
                        ? "Saving…"
                        : t.selfAssignedOverridden
                          ? "Clear override"
                          : t.selfAssigned
                            ? "Mark not self-assigned"
                            : "Mark self-assigned"}
                    </button>
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
                  // complexity → 1. t.expectedComplexity already carries the
                  // marked value forward when there's no matched PR (see
                  // expectedComplexityForLoc) — never a dash here, always a
                  // number to compare against.
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

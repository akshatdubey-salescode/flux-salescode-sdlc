"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { RiSearchLine } from "@remixicon/react";
import { WEIGHTS, SCORE_SCALE } from "@/lib/scorecard/config";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScorecardRow } from "./data";
import { ratingValueForSortKey, type SortKey } from "./rating-sort";

/** Max points any metric can score; the final score scales this by weight. */
const MAX_POINTS = 5;

/** Total achievable final score (active weights sum to 1 → 100). */
const MAX_SCORE =
  Object.values(WEIGHTS).reduce((s, w) => s + w, 0) * MAX_POINTS * SCORE_SCALE;

/** Max Complex Tasks contribution alone (weight 0.30 × 5 × 20 → 30) — what
 * each of the four Complex./Complex. NSA. columns is out of. Deliberately not
 * MAX_SCORE: Bug Quality/MTTR/Sprint Commitment (the other 70 points) are the
 * same regardless of marked-vs-expected or self-assigned exclusion, so
 * they're left out of these four so the comparison isn't diluted. */
const MAX_COMPLEX_CONTRIBUTION = WEIGHTS.complexTasks * MAX_POINTS * SCORE_SCALE;

/**
 * A metric's contribution to the 0–100 final score (points × weight × scale)
 * rendered as `value / max`, so the per-metric columns are on the same scale as
 * the Score (and sum to it) rather than raw 0–5 points.
 */
function Contribution({
  points,
  weight,
}: {
  points: number | null | undefined;
  weight: number;
}) {
  if (points == null) return <>—</>;
  const value = points * weight * SCORE_SCALE;
  const max = weight * MAX_POINTS * SCORE_SCALE;
  return (
    <>
      {value.toFixed(1)}
      <span className="font-normal text-zinc-400"> / {max.toFixed(1)}</span>
    </>
  );
}

/** A rating rendered as `value / max`. Score uses MAX_SCORE (100); the four
 * Complex./Complex. NSA. columns use MAX_COMPLEX_CONTRIBUTION (30) — they're
 * on different scales, so max is always passed explicitly, never assumed. */
function RatingCell({ value, max }: { value: number; max: number }) {
  return (
    <>
      {value.toFixed(1)}
      <span className="font-normal text-zinc-400"> / {max.toFixed(0)}</span>
    </>
  );
}

// SortKey and its value-selection logic live in ./rating-sort (unit-tested
// there) — "score" is the default, matching the server's own order
// (fetchScorecards sorts by finalScore), so the initial render needs no
// client-side re-sort at all.

/** Small sort-direction indicator next to a sortable column's label. */
function SortIndicator({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <span className="ml-1 text-zinc-300 dark:text-zinc-600">↕</span>;
  return <span className="ml-1 text-zinc-700 dark:text-zinc-300">{dir === "desc" ? "↓" : "↑"}</span>;
}

const ALL_JIRAS_INFO =
  "Includes every completed Jira, including self-created-and-assigned ones — same population as Score.";
const NSA_INFO =
  "Excludes self-assigned Jiras — issues where the reporter is also the person credited for the work. Score is unaffected; only this column reflects that exclusion.";
const SCORE_NSA_E_INFO =
  "Same formula as Score (Bug Quality + MTTR + Sprint Commitment + Complex Tasks), but computed with self-assigned Jiras excluded and Complex Tasks weighted by LOC-predicted complexity instead of marked. Unlike Complex. NSA. (E) (Complex Tasks contribution alone, out of 30), this is the full composite, out of 100 — directly comparable to Score.";

/**
 * Every numeric column's label, hover tooltip, and cell renderer, keyed by
 * its SortKey — all numeric columns are sortable (see SortIndicator usage
 * below), and this is also the set the performanceReviewVisibleColumns
 * feature flag (visible-columns.ts) picks a subset of, in ALL_NUMERIC_COLUMNS'
 * canonical order. Previously-separate header "i" badges are folded into each
 * column's own `title` (a native hover tooltip on the <th>, not a visible
 * icon) — nothing explained there is lost, just no longer a clutter icon,
 * and the full explanation still lives in the "How scores are calculated"
 * modal.
 */
type NumericColumn = {
  key: SortKey;
  label: string;
  title: string;
  cell: (row: ScorecardRow) => ReactNode;
};

export const NUMERIC_COLUMNS: NumericColumn[] = [
  {
    key: "score",
    label: "Score",
    title: "The original Performance Review score — every completed Jira counts, including self-created-and-assigned ones. Click to sort",
    cell: (row) => <RatingCell value={row.finalScore} max={MAX_SCORE} />,
  },
  {
    key: "scoreNsaE",
    label: "Score NSA. (E)",
    title: `${SCORE_NSA_E_INFO} Click to sort`,
    cell: (row) => <RatingCell value={row.scoreNsaExpected} max={MAX_SCORE} />,
  },
  {
    key: "m",
    label: "Complex. (M)",
    title: `Complex Tasks contribution only (out of 30), rated by each task's marked complexity, every completed Jira included. Bug Quality/MTTR/Sprint Commitment aren't part of this — see Score for those. ${ALL_JIRAS_INFO} Click to sort`,
    cell: (row) => <RatingCell value={row.markedComplexityScoreAll} max={MAX_COMPLEX_CONTRIBUTION} />,
  },
  {
    key: "e",
    label: "Complex. (E)",
    title: `Same as Complex. (M) (out of 30), but using the LOC-predicted complexity instead of the marked value. ${ALL_JIRAS_INFO} Click to sort`,
    cell: (row) => <RatingCell value={row.expectedComplexityScoreAll} max={MAX_COMPLEX_CONTRIBUTION} />,
  },
  {
    key: "nsaM",
    label: "Complex. NSA. (M)",
    title: `Same as Complex. (M) (out of 30), but self-assigned Jiras are excluded entirely. ${NSA_INFO} Click to sort`,
    cell: (row) => <RatingCell value={row.markedComplexityScore} max={MAX_COMPLEX_CONTRIBUTION} />,
  },
  {
    key: "nsaE",
    label: "Complex. NSA. (E)",
    title: `Same as Complex. (E) (out of 30), but self-assigned Jiras are excluded entirely. ${NSA_INFO} Click to sort`,
    cell: (row) => <RatingCell value={row.expectedComplexityScore} max={MAX_COMPLEX_CONTRIBUTION} />,
  },
  {
    key: "bugQuality",
    label: "Bug Qual.",
    title: "Bug Quality's contribution to Score (points × weight). Click to sort",
    cell: (row) => <Contribution points={row.bugQualityPoints} weight={WEIGHTS.bugQuality} />,
  },
  {
    key: "sprintCommitment",
    label: "Sprint",
    title: "Sprint Commitment's contribution to Score (points × weight). Click to sort",
    cell: (row) => <Contribution points={row.sprintCommitmentPoints} weight={WEIGHTS.sprintCommitment} />,
  },
  {
    key: "complexTasks",
    label: "Complex",
    title: "Complex Tasks' contribution to Score (points × weight). Click to sort",
    cell: (row) => <Contribution points={row.complexTasksPoints} weight={WEIGHTS.complexTasks} />,
  },
  {
    key: "mttr",
    label: "MTTR",
    title: "MTTR's contribution to Score (points × weight). Click to sort",
    cell: (row) => <Contribution points={row.mttrPoints} weight={WEIGHTS.mttr} />,
  },
];

export function LeaderboardTable({
  rows,
  quarterKey,
  quarterLabel,
  visibleColumns,
}: {
  rows: ScorecardRow[];
  quarterKey: string;
  quarterLabel: string;
  visibleColumns: SortKey[];
}) {
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // NUMERIC_COLUMNS filtered down to whatever performanceReviewVisibleColumns
  // (the feature flag) currently allows, in NUMERIC_COLUMNS' own canonical
  // order — the source of truth for both the header row and every data row.
  const columns = useMemo(
    () => NUMERIC_COLUMNS.filter((c) => visibleColumns.includes(c.key)),
    [visibleColumns],
  );

  // Clicking the column already being sorted flips direction; clicking a
  // different rating column switches to it, defaulting to descending
  // (highest rating first — the useful default for any of the five).
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // Distinct departments present in the list, for the filter dropdown.
  const departments = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.department).filter((d): d is string => !!d)),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (dept !== "all" && r.department !== dept) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.manager?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rows, query, dept]);

  // Re-sorts on top of the filtered list — this is what actually renders as
  // rows, so it reflects the currently active sort column/direction.
  const sorted = useMemo(() => {
    const valueOf = (r: ScorecardRow) => ratingValueForSortKey(r, sortKey);
    return [...filtered].sort((a, b) =>
      sortDir === "desc" ? valueOf(b) - valueOf(a) : valueOf(a) - valueOf(b),
    );
  }, [filtered, sortKey, sortDir]);

  // "#" is this person's rank across the *entire org* under the current sort
  // column — computed from the full, unfiltered rows so it stays the same
  // number whether or not a search/department filter is narrowing what's
  // currently visible. Deliberately keyed off the live sortKey/sortDir (not
  // the server-computed row.rank) so it still matches whatever column the
  // user is actually looking at, just measured against everyone, not only
  // the currently-filtered subset.
  const rankByEmail = useMemo(() => {
    const valueOf = (r: ScorecardRow) => ratingValueForSortKey(r, sortKey);
    const fullSorted = [...rows].sort((a, b) =>
      sortDir === "desc" ? valueOf(b) - valueOf(a) : valueOf(a) - valueOf(b),
    );
    return new Map(fullSorted.map((r, i) => [r.email, i + 1]));
  }, [rows, sortKey, sortDir]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <RiSearchLine
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or manager…"
            className="h-9 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-100/10"
          />
        </div>
        <Select value={dept} onValueChange={setDept}>
          <SelectTrigger className="h-9 w-52">
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* max-h + overflow-auto together make this div the actual scroll
          container for the table — vertically (bounded, so the header can
          stick within it) and horizontally (contains the table's own
          scrollbar so it can't overflow the page). Reverted from a two-stage
          "full height until scrolled to, then bounds+sticks" version: that
          version conditionally added max-height only once scrolled-to, but
          since a sticky element stays in normal document flow, shrinking its
          own height at that instant collapsed the page's total height at the
          same scroll position — which yanked the scroll position back,
          un-triggering the very state that caused the shrink, growing it
          back, re-triggering it... an infinite feedback loop (the visible
          symptom: flickering, and scrolling effectively locked). A stable
          two-stage version is possible but needs the stuck state rendered
          via position: fixed + a same-height placeholder (removing it from
          document flow entirely, so its size can't feed back into the
          scroll position that measures it) — a real feature build, not a
          class tweak; this static version is the stable fallback. */}
      <div className="max-h-screen overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="sticky top-0">
            <tr className="rounded-t-lg border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800">
              <th className="w-12 whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                #
              </th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Developer
              </th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Manager
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500"
                  title={col.title}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center uppercase hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    {col.label}
                    <SortIndicator active={sortKey === col.key} dir={sortDir} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.email}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
              >
                <td className="px-4 py-3 align-top tabular-nums text-xs text-zinc-400">
                  {rankByEmail.get(row.email)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top">
                  <Link
                    href={`/performance-review?quarter=${quarterKey}&person=${encodeURIComponent(
                      row.email,
                    )}`}
                    className="group/link"
                    title="Jira Complexity Rating — full per-Jira breakdown, including Complexity Accuracy"
                  >
                    <span
                      className="font-medium text-zinc-900 group-hover/link:underline dark:text-zinc-100"
                      title={row.email}
                    >
                      {row.name}
                    </span>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top text-sm text-zinc-600 dark:text-zinc-400">
                  {row.manager ?? "—"}
                </td>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className="whitespace-nowrap px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400"
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={3 + columns.length}
                  className="px-4 py-8 text-center text-sm text-zinc-400"
                >
                  No scorecards for {quarterLabel} yet. Click{" "}
                  <strong>Recompute</strong> to generate ratings from the latest
                  synced Jira data.
                </td>
              </tr>
            )}

            {rows.length > 0 && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={3 + columns.length}
                  className="px-4 py-8 text-center text-sm text-zinc-400"
                >
                  No developers match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

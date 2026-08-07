"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RiSearchLine, RiInformationLine } from "@remixicon/react";
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

/** A 0–100 rating rendered as `value / max`, e.g. every Complex. column. */
function RatingCell({ value }: { value: number }) {
  return (
    <>
      {value.toFixed(1)}
      <span className="font-normal text-zinc-400"> / {MAX_SCORE.toFixed(0)}</span>
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

/**
 * Small "i" badge for a header, sitting next to (not inside) the sortable
 * label button — a nested button-in-button isn't valid HTML, so this is a
 * sibling span with its own hover/focus title, not a click target.
 */
function HeaderInfoBadge({ text }: { text: string }) {
  return (
    <span
      tabIndex={0}
      title={text}
      className="inline-flex shrink-0 cursor-help text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
    >
      <RiInformationLine size={13} />
    </span>
  );
}

const ALL_JIRAS_INFO =
  "Includes every completed Jira, including self-created-and-assigned ones — same population as Score.";
const NSA_INFO =
  "Excludes self-assigned Jiras — issues where the reporter is also the person credited for the work. Score is unaffected; only this column reflects that exclusion.";

export function LeaderboardTable({
  rows,
  quarterKey,
  quarterLabel,
}: {
  rows: ScorecardRow[];
  quarterKey: string;
  quarterLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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

  // Re-sorts on top of the filtered list — "#" below reflects position in
  // this order, not the server-computed row.rank, so it always matches what
  // the user is actually looking at.
  const sorted = useMemo(() => {
    const valueOf = (r: ScorecardRow) => ratingValueForSortKey(r, sortKey);
    return [...filtered].sort((a, b) =>
      sortDir === "desc" ? valueOf(b) - valueOf(a) : valueOf(a) - valueOf(b),
    );
  }, [filtered, sortKey, sortDir]);

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
            placeholder="Search developer by name…"
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

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {/* Inner overflow-x-auto (not the outer, rounded-corner-clipping div)
            so wide tables scroll horizontally instead of just clipping
            off-screen columns — nowrap on every header keeps labels from
            wrapping into two lines, which would otherwise let the browser
            squeeze columns down instead of triggering the scrollbar. */}
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/80">
              <th className="w-12 whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                #
              </th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Developer
              </th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Manager
              </th>
              <th
                className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500"
                title="The original Performance Review score — every completed Jira counts, including self-created-and-assigned ones. Click to sort"
              >
                <button
                  type="button"
                  onClick={() => toggleSort("score")}
                  className="inline-flex items-center uppercase hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  Score
                  <SortIndicator active={sortKey === "score"} dir={sortDir} />
                </button>
              </th>
              <th
                className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500"
                title="Rated by each task's marked complexity, every completed Jira included. Click to sort"
              >
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleSort("mar")}
                    className="inline-flex items-center uppercase hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    Complex. (Mar)
                    <SortIndicator active={sortKey === "mar"} dir={sortDir} />
                  </button>
                  <HeaderInfoBadge text={ALL_JIRAS_INFO} />
                </span>
              </th>
              <th
                className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500"
                title="Same formula as Complex. (Mar), but the Complex Tasks metric uses the LOC-predicted complexity instead of the marked value. Click to sort"
              >
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleSort("exp")}
                    className="inline-flex items-center uppercase hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    Complex. (Exp)
                    <SortIndicator active={sortKey === "exp"} dir={sortDir} />
                  </button>
                  <HeaderInfoBadge text={ALL_JIRAS_INFO} />
                </span>
              </th>
              <th
                className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500"
                title="Same as Complex. (Mar), but self-assigned Jiras are excluded entirely. Click to sort"
              >
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleSort("nsaMar")}
                    className="inline-flex items-center uppercase hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    Complex. NSA. (Mar)
                    <SortIndicator active={sortKey === "nsaMar"} dir={sortDir} />
                  </button>
                  <HeaderInfoBadge text={NSA_INFO} />
                </span>
              </th>
              <th
                className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500"
                title="Same as Complex. (Exp), but self-assigned Jiras are excluded entirely. Click to sort"
              >
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleSort("nsaExp")}
                    className="inline-flex items-center uppercase hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    Complex. NSA. (Exp)
                    <SortIndicator active={sortKey === "nsaExp"} dir={sortDir} />
                  </button>
                  <HeaderInfoBadge text={NSA_INFO} />
                </span>
              </th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Bug Qual.
              </th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Sprint
              </th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Complex
              </th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                MTTR
              </th>
              <th
                className="w-12 whitespace-nowrap px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500"
                title="Jira Complexity Rating — full per-Jira breakdown, including Complexity Accuracy"
              >
                Details
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.email}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
              >
                <td className="px-4 py-3 align-top tabular-nums text-xs text-zinc-400">
                  {i + 1}
                </td>
                <td className="px-4 py-3 align-top">
                  <Link
                    href={`/performance-review?quarter=${quarterKey}&person=${encodeURIComponent(
                      row.email,
                    )}`}
                    className="group/link"
                  >
                    <span className="block font-medium text-zinc-900 group-hover/link:underline dark:text-zinc-100">
                      {row.name}
                    </span>
                    <span className="block font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {row.email}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 align-top text-sm text-zinc-600 dark:text-zinc-400">
                  {row.manager ?? "—"}
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  <RatingCell value={row.finalScore} />
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  <RatingCell value={row.finalScore} />
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  <RatingCell value={row.expectedComplexityScoreAll} />
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  <RatingCell value={row.markedComplexityScore} />
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  <RatingCell value={row.expectedComplexityScore} />
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  <Contribution
                    points={row.bugQualityPoints}
                    weight={WEIGHTS.bugQuality}
                  />
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  <Contribution
                    points={row.sprintCommitmentPoints}
                    weight={WEIGHTS.sprintCommitment}
                  />
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  <Contribution
                    points={row.complexTasksPoints}
                    weight={WEIGHTS.complexTasks}
                  />
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  <Contribution points={row.mttrPoints} weight={WEIGHTS.mttr} />
                </td>
                <td className="px-4 py-3 text-center align-top">
                  <Link
                    href={`/performance-review?quarter=${quarterKey}&person=${encodeURIComponent(
                      row.email,
                    )}`}
                    title="Jira Complexity Rating — full per-Jira breakdown, including Complexity Accuracy"
                    aria-label={`View Jira Complexity Rating for ${row.name}`}
                    className="inline-flex text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    <RiInformationLine size={18} />
                  </Link>
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={13}
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
                  colSpan={13}
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
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RiSearchLine } from "@remixicon/react";
import type { ScorecardRow } from "./data";

function fmtPoints(p: number | null | undefined): string {
  return p == null ? "—" : p.toFixed(2);
}

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
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

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/80">
              <th className="w-12 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                #
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Developer
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Score
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Bug Qual.
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Sprint
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Complex
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                MTTR
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.email}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
              >
                <td className="px-4 py-3 align-top tabular-nums text-xs text-zinc-400">
                  {row.rank}
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
                <td className="px-4 py-3 text-right align-top text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {row.finalScore.toFixed(1)}
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  {fmtPoints(row.bugQualityPoints)}
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  {fmtPoints(row.sprintCommitmentPoints)}
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  {fmtPoints(row.complexTasksPoints)}
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                  {fmtPoints(row.mttrPoints)}
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
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
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-zinc-400"
                >
                  No developers match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

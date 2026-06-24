"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RiSearchLine } from "@remixicon/react";
import type { LocRow } from "./data";

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toLocaleString()}`;
}

export function LocTable({ rows, rangeQuery }: { rows: LocRow[]; rangeQuery: string }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.department?.toLowerCase().includes(q) ?? false) ||
        r.managerChain.some((m) => m.toLowerCase().includes(q))
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
          placeholder="Search by name, email, department, or manager…"
          className="h-9 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-100/10"
        />
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide w-12">
                #
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Person
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Department
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Reporting Manager
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Net LOC
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Added
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Deleted
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Commits
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Repos
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.email}
                className="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0"
              >
                <td className="px-4 py-3 text-xs text-zinc-400 tabular-nums align-top">
                  {row.rank}
                </td>
                <td className="px-4 py-3 align-top">
                  <Link
                    href={`/views/lines-of-code?${rangeQuery}&person=${encodeURIComponent(row.email)}`}
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
                <td className="px-4 py-3 align-top text-sm text-zinc-700 dark:text-zinc-300">
                  {row.department ?? <span className="text-zinc-400 dark:text-zinc-600">—</span>}
                </td>
                <td className="px-4 py-3 align-top text-sm">
                  {row.managerChain.length === 0 ? (
                    <span className="text-zinc-400 dark:text-zinc-600">—</span>
                  ) : (
                    <>
                      <span className="block text-zinc-700 dark:text-zinc-300">
                        {row.managerChain[0]}
                      </span>
                      {row.managerChain.length > 1 && (
                        <span
                          className="block text-xs text-zinc-400 dark:text-zinc-500"
                          title={`Reporting line: ${row.managerChain.join(" → ")}`}
                        >
                          ↑ {row.managerChain.slice(1).join(" → ")}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td
                  className={
                    "px-4 py-3 text-right font-semibold tabular-nums align-top " +
                    (row.net < 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-zinc-900 dark:text-zinc-100")
                  }
                >
                  {row.net.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 align-top">
                  {signed(row.additions)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-red-500 dark:text-red-400 align-top">
                  −{row.deletions.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400 align-top">
                  {row.commits.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400 align-top">
                  {row.repos.toLocaleString()}
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-zinc-400">
                  No attributed contributions in this period. Run a GitHub sync and map
                  accounts under Superuser → GitHub Accounts.
                </td>
              </tr>
            )}

            {rows.length > 0 && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-zinc-400">
                  No people match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

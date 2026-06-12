import Link from "next/link";
import { RiArrowRightUpLine } from "@remixicon/react";
import { requireAuth } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  currentFyStartYear,
  currentQuarterNum,
  getRelevantQuarters,
  quarterBounds,
} from "@/lib/date-utils";
import { fetchLinesOfCode, fetchUnattributed, fetchPersonBreakdown } from "./data";
import { FilterBar } from "./filter-bar";

type SearchParams = Promise<{ start?: string; end?: string; person?: string }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function defaultRange(): { start: string; end: string } {
  return quarterBounds(currentFyStartYear(), currentQuarterNum());
}

function parseRange(params: { start?: string; end?: string }): {
  start: string;
  end: string;
} {
  const fallback = defaultRange();
  const start = params.start && ISO_DATE.test(params.start) ? params.start : fallback.start;
  const end = params.end && ISO_DATE.test(params.end) ? params.end : fallback.end;
  return { start, end };
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toLocaleString()}`;
}

export default async function LinesOfCodePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAuth();

  const sp = await searchParams;
  const { start, end } = parseRange(sp);
  // Hide the Q3 2025 (Oct–Dec 2025) quick-filter chip on this view. Matched by
  // start date so it's unambiguous; becomes a no-op once that quarter ages out
  // of the relevant window. Custom date ranges can still reach those dates.
  const quarters = getRelevantQuarters().filter((q) => q.start !== "2025-10-01");
  const rangeQuery = `start=${start}&end=${end}`;

  // Drill-down: one person's contribution split per repo.
  if (sp.person) {
    const detail = await fetchPersonBreakdown(sp.person, start, end);
    return (
      <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <SidebarTrigger />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/views">Views</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={`/views/lines-of-code?${rangeQuery}`}>Lines of Code</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{detail.email}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>

        <main className="flex-1 p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{detail.email}</h1>
              <p className="text-sm text-zinc-500 mt-1">
                {detail.totals.net.toLocaleString()} net lines (+
                {detail.totals.additions.toLocaleString()} / −
                {detail.totals.deletions.toLocaleString()}) across{" "}
                {detail.repos.length} repo{detail.repos.length === 1 ? "" : "s"} and{" "}
                {detail.totals.commits.toLocaleString()} commits in this period.
                {detail.logins.length > 0 && (
                  <>
                    {" "}GitHub:{" "}
                    {detail.logins.map((l, i) => (
                      <span key={l} className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
                        @{l}
                        {i < detail.logins.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </>
                )}
              </p>
            </div>

            <FilterBar quarters={quarters} start={start} end={end} />

            <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                      Repository
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
                  </tr>
                </thead>
                <tbody>
                  {detail.repos.map((r) => (
                    <tr
                      key={r.repo}
                      className="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0"
                    >
                      <td className="px-4 py-3 align-top">
                        <a
                          href={`https://github.com/${r.repo}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {r.repo}
                          <RiArrowRightUpLine className="size-3 shrink-0 opacity-60" />
                        </a>
                      </td>
                      <td
                        className={
                          "px-4 py-3 text-right font-semibold tabular-nums align-top " +
                          (r.net < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-100")
                        }
                      >
                        {r.net.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 align-top">
                        {signed(r.additions)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-red-500 dark:text-red-400 align-top">
                        −{r.deletions.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400 align-top">
                        {r.commits.toLocaleString()}
                      </td>
                    </tr>
                  ))}

                  {detail.repos.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-400">
                        No contributions in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const [rows, unattributed] = await Promise.all([
    fetchLinesOfCode(start, end),
    fetchUnattributed(start, end),
  ]);

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/views">Views</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Lines of Code Delivered</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Lines of Code Delivered
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              Net lines (additions − deletions) merged to each repo&apos;s default
              branch, attributed by commit author and rolled up per person. Sourced
              from GitHub&apos;s weekly contributor stats, so figures are
              week-granular and count every changed line — including generated files
              and lock files. Read it as a delivery signal, not a productivity score.
            </p>
          </div>

          <FilterBar quarters={quarters} start={start} end={end} />

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
                {rows.map((row) => (
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
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-sm text-zinc-400"
                    >
                      No attributed contributions in this period. Run a GitHub sync
                      and map accounts under Superuser → GitHub Accounts.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {unattributed && unattributed.accounts > 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {unattributed.accounts.toLocaleString()} unmapped GitHub account
              {unattributed.accounts === 1 ? "" : "s"} contributed{" "}
              {signed(unattributed.net)} net lines in this period and are not shown
              above.{" "}
              <Link
                href="/superuser/github-accounts"
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                Map them to people →
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

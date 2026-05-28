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
import { fetchTopUnplannedAssignees } from "./data";
import { FilterBar } from "./filter-bar";

type SearchParams = Promise<{
  start?: string;
  end?: string;
  includeCompleted?: string;
}>;

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

export default async function TopUnplannedAssigneesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAuth();

  const sp = await searchParams;
  const { start, end } = parseRange(sp);
  const includeCompleted = sp.includeCompleted === "1";
  const quarters = getRelevantQuarters();

  const rows = await fetchTopUnplannedAssignees(start, end, includeCompleted);

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
              <BreadcrumbPage>Top Unplanned Assignees</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Top Assignees with Unplanned Tasks
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              An issue is unplanned when it is missing a start date or a
              due/end date.
            </p>
          </div>

          <FilterBar
            quarters={quarters}
            start={start}
            end={end}
            includeCompleted={includeCompleted}
          />

          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide w-12">
                    #
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Name
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Email
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Team
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Unplanned Tasks
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
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100 align-top">
                      {row.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400 align-top">
                      {row.email}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {row.teams.length === 0 ? (
                        <span className="text-xs text-zinc-400">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {row.teams.map((team) => (
                            <Link
                              key={team.id}
                              href={`/observer/${team.id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 transition-colors"
                            >
                              <span className="truncate max-w-[160px]">
                                {team.name}
                              </span>
                              <RiArrowRightUpLine className="size-3 shrink-0 opacity-60" />
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 align-top">
                      {row.unplanned_count.toLocaleString()}
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-sm text-zinc-400"
                    >
                      No unplanned tasks in this period.
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

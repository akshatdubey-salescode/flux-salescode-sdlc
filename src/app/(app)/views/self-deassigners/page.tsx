import Link from "next/link";
import {
  RiArrowRightUpLine,
  RiArrowDownLine,
  RiArrowUpLine,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import { requireAuth } from "@/lib/auth/server";
import { PageHeader } from "@/components/page-header";
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
import {
  fetchTopSelfDeassigners,
  fetchSelfRemovalEvents,
  type SelfDeassignerSort,
  type SortDir,
} from "./data";
import { FilterBar } from "./filter-bar";

type SearchParams = Promise<{
  start?: string;
  end?: string;
  author?: string;
  sort?: string;
  dir?: string;
}>;

const SORT_KEYS: SelfDeassignerSort[] = [
  "total",
  "unassigned",
  "reporter",
  "other",
];

function parseSort(value: string | undefined): SelfDeassignerSort {
  return SORT_KEYS.includes(value as SelfDeassignerSort)
    ? (value as SelfDeassignerSort)
    : "total";
}

function parseDir(value: string | undefined): SortDir {
  return value === "asc" ? "asc" : "desc";
}

const TO_KIND_LABEL: Record<string, string> = {
  unassigned: "→ Unassigned",
  reporter: "→ Reporter",
  other: "→ Someone else",
};

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

export default async function SelfDeassignersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAuth();

  const sp = await searchParams;
  const { start, end } = parseRange(sp);
  const quarters = getRelevantQuarters();
  const rangeQuery = `start=${start}&end=${end}`;

  // Drill-down: a single person's self-removal events.
  if (sp.author) {
    const detail = await fetchSelfRemovalEvents(sp.author, start, end);
    return (
      <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
        <PageHeader>
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
                  <Link href={`/views/self-deassigners?${rangeQuery}`}>
                    Self-Deassigners
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{detail.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageHeader>

        <main className="flex-1 p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {detail.name}
              </h1>
              <p className="text-sm text-zinc-500 mt-1">
                {detail.email ?? "—"} · {detail.events.length} self-reassignment
                {detail.events.length === 1 ? "" : "s"} in this period.
              </p>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                      Issue
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                      Moved to
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                      When
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.events.map((ev, i) => (
                    <tr
                      key={`${ev.jira_key}-${i}`}
                      className="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0"
                    >
                      <td className="px-4 py-3 align-top">
                        <a
                          href={ev.browse_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {ev.jira_key}
                          <RiArrowRightUpLine className="size-3 shrink-0 opacity-60" />
                        </a>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1 max-w-md">
                          {ev.summary}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {TO_KIND_LABEL[ev.to_kind] ?? ev.to_kind}
                        </span>
                        {ev.to_name && (
                          <span className="block text-xs text-zinc-400 mt-0.5">
                            {ev.to_name}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-zinc-500 dark:text-zinc-400 tabular-nums align-top whitespace-nowrap">
                        {new Date(ev.changed_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}

                  {detail.events.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-4 py-8 text-center text-sm text-zinc-400"
                      >
                        No self-reassignments in this period.
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

  const sort = parseSort(sp.sort);
  const dir = parseDir(sp.dir);
  const rows = await fetchTopSelfDeassigners(start, end, sort, dir);

  // Clicking the active column flips direction; a new column starts descending.
  const sortHref = (key: SelfDeassignerSort) => {
    const nextDir = key === sort && dir === "desc" ? "asc" : "desc";
    return `/views/self-deassigners?${rangeQuery}&sort=${key}&dir=${nextDir}`;
  };

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/views">Views</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Self-Deassigners</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Top Self-Deassigners
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              Ranks people by how often they removed <em>themselves</em> as the
              assignee of an issue — moving the work to unassigned, back to the
              reporter, or to someone else. This is a candidate list to
              investigate, not proof of intent: legitimate handoffs appear here
              too.
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
                    Name
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Team
                  </th>
                  {(
                    [
                      { key: "unassigned" as const, label: "To Unassigned" },
                      { key: "reporter" as const, label: "To Reporter" },
                      { key: "other" as const, label: "To Someone Else" },
                      { key: "total" as const, label: "Total" },
                    ]
                  ).map(({ key, label }) => {
                    const active = sort === key;
                    const ArrowIcon =
                      active && dir === "asc" ? RiArrowUpLine : RiArrowDownLine;
                    return (
                      <th
                        key={key}
                        aria-sort={
                          active
                            ? dir === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                        className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                      >
                        <Link
                          href={sortHref(key)}
                          className={cn(
                            "inline-flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors",
                            active
                              ? "text-zinc-900 dark:text-zinc-100"
                              : "text-zinc-500"
                          )}
                        >
                          {label}
                          <ArrowIcon
                            className={cn(
                              "size-3 shrink-0 transition-opacity",
                              active ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </Link>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.account_id}
                    className="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0"
                  >
                    <td className="px-4 py-3 text-xs text-zinc-400 tabular-nums align-top">
                      {row.rank}
                    </td>
                    <td className="px-4 py-3 font-medium align-top">
                      <Link
                        href={`/views/self-deassigners?${rangeQuery}&author=${encodeURIComponent(row.account_id)}`}
                        className="text-zinc-900 hover:underline dark:text-zinc-100"
                      >
                        {row.name}
                      </Link>
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
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400 align-top">
                      {row.to_unassigned.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400 align-top">
                      {row.to_reporter.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400 align-top">
                      {row.to_other.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 align-top">
                      {row.total.toLocaleString()}
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-sm text-zinc-400"
                    >
                      No self-reassignments in this period.
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

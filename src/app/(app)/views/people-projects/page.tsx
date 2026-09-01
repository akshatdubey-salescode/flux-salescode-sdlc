import Link from "next/link";
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
import { fetchPeopleProjects } from "./data";
import { filterPeopleProjects } from "./filter";
import { FilterBar } from "./filter-bar";
import { ExportButton } from "./export-button";

type SearchParams = Promise<{
  start?: string;
  end?: string;
  q?: string;
  dept?: string;
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

export default async function PeopleProjectsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAuth();

  const sp = await searchParams;
  const { start, end } = parseRange(sp);
  const q = (sp.q ?? "").trim().slice(0, 100);
  const selectedDepartments = (sp.dept ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const quarters = getRelevantQuarters();

  const allRows = await fetchPeopleProjects(start, end);
  const departments = [
    ...new Set(
      allRows.map((r) => r.department).filter((d): d is string => !!d)
    ),
  ].sort((a, b) => a.localeCompare(b));
  const rows = filterPeopleProjects(allRows, q, selectedDepartments);

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
              <BreadcrumbPage>People &amp; Projects</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              People &amp; Projects
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              Who is working on which projects in the selected period. A person
              is counted on an issue/task as its assignee or an additional
              assignee; an issue/task counts as active when it existed in the
              period and was last updated on or after the period&apos;s start.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <FilterBar
              quarters={quarters}
              start={start}
              end={end}
              q={q}
              departments={departments}
              selectedDepartments={selectedDepartments}
            />
            <ExportButton
              start={start}
              end={end}
              q={q}
              departments={selectedDepartments}
            />
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Person
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Dept / Manager
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Projects
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wide whitespace-nowrap">
                    # Projects
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wide whitespace-nowrap">
                    Issues / Tasks
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wide whitespace-nowrap">
                    Open
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.email}
                    className="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0"
                  >
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={`/tasks/${encodeURIComponent(row.email)}`}
                        className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                      >
                        {row.name}
                      </Link>
                      <span className="block font-mono text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {row.email}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {row.department || row.managerName ? (
                        <>
                          {row.department && (
                            <span className="block text-xs text-zinc-700 dark:text-zinc-300">
                              {row.department}
                            </span>
                          )}
                          {row.managerName && (
                            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                              ↳ {row.managerName}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {row.projects.map((p) => (
                          <Link
                            key={p.projectId}
                            href={`/projects/${p.projectId}`}
                            title={`${p.projectName} — ${p.issueCount} issue${p.issueCount === 1 ? "" : "s"}/task${p.issueCount === 1 ? "" : "s"} (${p.openCount} open)`}
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 transition-colors"
                          >
                            <span className="truncate max-w-[160px]">
                              {p.projectName}
                            </span>
                            <span className="tabular-nums text-zinc-400 dark:text-zinc-500">
                              {p.issueCount}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 align-top">
                      {row.projects.length}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300 align-top">
                      {row.totalIssues.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400 align-top">
                      {row.totalOpen.toLocaleString()}
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-sm text-zinc-400"
                    >
                      {q || selectedDepartments.length
                        ? "No people match the current filters."
                        : "No active issues/tasks in this period."}
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

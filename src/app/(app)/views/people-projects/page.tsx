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
import {
  fetchPeopleProjects,
  fetchUnattributedBugs,
  type PersonProjectsRow,
} from "./data";
import { filterPeopleProjects } from "./filter";
import { FilterBar } from "./filter-bar";
import { ExportButton } from "./export-button";

type SearchParams = Promise<{
  start?: string;
  end?: string;
  q?: string;
  dept?: string;
  sort?: string;
  dir?: string;
}>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Chips shown per person before collapsing into "+N more" (full list in the
// hover tooltip and the Excel report).
const MAX_PROJECT_CHIPS = 8;

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

// ---- Column sorting (URL-driven: ?sort=<key>&dir=asc|desc) ------------------

type SortKey =
  | "name"
  | "projects"
  | "issues"
  | "open"
  | "p1"
  | "p2"
  | "p3"
  | "bugs"
  | "loc"
  | "present";

const SORT_ACCESSORS: Record<
  SortKey,
  (r: PersonProjectsRow) => number | string | null
> = {
  name: (r) => r.name.toLowerCase(),
  projects: (r) => r.projects.length,
  issues: (r) => r.totalIssues,
  open: (r) => r.totalOpen,
  p1: (r) => r.totalP1Bugs,
  p2: (r) => r.totalP2Bugs,
  p3: (r) => r.totalP3Bugs,
  bugs: (r) => r.totalBugs,
  loc: (r) => r.locNet,
  present: (r) => r.daysPresent,
};

function isSortKey(v: string | undefined): v is SortKey {
  return !!v && v in SORT_ACCESSORS;
}

function sortRows(
  rows: PersonProjectsRow[],
  key: SortKey,
  dir: "asc" | "desc"
): PersonProjectsRow[] {
  const acc = SORT_ACCESSORS[key];
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = acc(a);
    const vb = acc(b);
    // People with no data for the column (e.g. no GitHub mapping) sink to
    // the bottom in either direction.
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "string") return mul * va.localeCompare(vb as string);
    return mul * ((va as number) - (vb as number));
  });
}

function SortableTh({
  label,
  k,
  sort,
  dir,
  query,
  align = "right",
  compact = false,
}: {
  label: string;
  k: SortKey;
  sort: SortKey | null;
  dir: "asc" | "desc";
  query: string;
  align?: "left" | "right";
  compact?: boolean;
}) {
  const active = sort === k;
  // First click: names ascend, numbers descend (the useful direction each).
  const nextDir = active ? (dir === "desc" ? "asc" : "desc") : k === "name" ? "asc" : "desc";
  return (
    <th
      className={`${compact ? "px-3" : "px-4"} py-2.5 text-${align} text-xs font-semibold text-zinc-500 uppercase tracking-wide whitespace-nowrap`}
    >
      <Link
        href={`/views/people-projects?${query}&sort=${k}&dir=${nextDir}`}
        className="inline-flex items-center gap-1 hover:text-zinc-800 dark:hover:text-zinc-200"
        title={`Sort by ${label}`}
      >
        {label}
        {active && <span className="text-[10px]">{dir === "desc" ? "▼" : "▲"}</span>}
      </Link>
    </th>
  );
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
  const sort = isSortKey(sp.sort) ? sp.sort : null;
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const quarters = getRelevantQuarters();

  const [allRows, unattributedBugs] = await Promise.all([
    fetchPeopleProjects(start, end),
    fetchUnattributedBugs(start, end),
  ]);
  const departments = [
    ...new Set(
      allRows.map((r) => r.department).filter((d): d is string => !!d)
    ),
  ].sort((a, b) => a.localeCompare(b));
  let rows = filterPeopleProjects(allRows, q, selectedDepartments);
  if (sort) rows = sortRows(rows, sort, dir);

  // Everything except sort/dir, so header links preserve the active filters.
  const baseParams = new URLSearchParams({ start, end });
  if (q) baseParams.set("q", q);
  if (selectedDepartments.length) baseParams.set("dept", selectedDepartments.join(","));
  const baseQuery = baseParams.toString();

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
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-4xl">
              <h1 className="text-2xl font-semibold tracking-tight">
                People &amp; Projects
              </h1>
              <p className="text-sm text-zinc-500 mt-1">
                Who is working on which projects in the selected period —
                including every current employee, even with no work. A person
                is counted on an issue/task as its assignee or an additional
                assignee; an issue/task counts as active when it existed in the
                period and was last updated on or after the period&apos;s
                start. Bug counts (P1/P2/P3) match the Bug Board: attributed to
                the bug&apos;s issue owner (the project&apos;s issue-owner
                field, not the assignee), counted when the bug was created in
                the period, excluding &quot;Not a Bug&quot; /
                &quot;Can&apos;t Reproduce&quot; statuses. Net LOC (additions −
                deletions) comes from GitHub contributor stats for the same
                period (weekly granularity) and is attributed to the person,
                not split by project. Attendance shows days present out of the
                period&apos;s working days (Keka holidays and weekly-offs
                excluded; hover for absences and average hours). Click a column
                header to sort.
              </p>
            </div>
            <div className="shrink-0 pt-1">
              <ExportButton
                start={start}
                end={end}
                q={q}
                departments={selectedDepartments}
              />
            </div>
          </div>

          <FilterBar
            quarters={quarters}
            start={start}
            end={end}
            q={q}
            departments={departments}
            selectedDepartments={selectedDepartments}
          />

          {unattributedBugs.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              {unattributedBugs.length.toLocaleString()} bug
              {unattributedBugs.length === 1 ? "" : "s"} created in this period
              {unattributedBugs.length === 1 ? " has" : " have"} no issue owner
              set and {unattributedBugs.length === 1 ? "isn't" : "aren't"}{" "}
              counted for anyone above — the &quot;Unowned Bugs&quot; sheet in
              the downloaded report lists them for fixing.
            </p>
          )}

          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-x-auto">
            <table className="w-full min-w-[1300px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
                  <SortableTh label="Person" k="name" sort={sort} dir={dir} query={baseQuery} align="left" />
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Dept / Manager
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide min-w-[340px]">
                    Projects
                  </th>
                  <SortableTh label="# Projects" k="projects" sort={sort} dir={dir} query={baseQuery} />
                  <SortableTh label="Issues / Tasks" k="issues" sort={sort} dir={dir} query={baseQuery} />
                  <SortableTh label="Open" k="open" sort={sort} dir={dir} query={baseQuery} />
                  <SortableTh label="P1" k="p1" sort={sort} dir={dir} query={baseQuery} compact />
                  <SortableTh label="P2" k="p2" sort={sort} dir={dir} query={baseQuery} compact />
                  <SortableTh label="P3" k="p3" sort={sort} dir={dir} query={baseQuery} compact />
                  <SortableTh label="Total Bugs" k="bugs" sort={sort} dir={dir} query={baseQuery} />
                  <SortableTh label="Net LOC" k="loc" sort={sort} dir={dir} query={baseQuery} />
                  <SortableTh label="Attendance" k="present" sort={sort} dir={dir} query={baseQuery} />
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
                      {row.projects.length === 0 ? (
                        <span className="text-xs text-zinc-400 italic">
                          No project activity in this period
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {row.projects.slice(0, MAX_PROJECT_CHIPS).map((p) => (
                            <Link
                              key={p.projectId}
                              href={`/projects/${p.projectId}`}
                              title={`${p.projectName} — ${p.issueCount} issue${p.issueCount === 1 ? "" : "s"}/task${p.issueCount === 1 ? "" : "s"} (${p.openCount} open) · Bugs: P1 ${p.p1Bugs}, P2 ${p.p2Bugs}, P3 ${p.p3Bugs} (total ${p.bugTotal})`}
                              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 transition-colors"
                            >
                              <span className="truncate max-w-[160px]">
                                {p.projectName}
                              </span>
                              <span className="tabular-nums text-zinc-400 dark:text-zinc-500">
                                {p.issueCount}
                              </span>
                              {p.bugTotal > 0 && (
                                <span className="tabular-nums font-semibold text-red-600 dark:text-red-400">
                                  {p.bugTotal} bug{p.bugTotal === 1 ? "" : "s"}
                                </span>
                              )}
                            </Link>
                          ))}
                          {row.projects.length > MAX_PROJECT_CHIPS && (
                            <span
                              className="inline-flex items-center rounded-md border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400 cursor-default"
                              title={row.projects
                                .slice(MAX_PROJECT_CHIPS)
                                .map(
                                  (p) =>
                                    `${p.projectName} (${p.issueCount}${p.bugTotal > 0 ? `, ${p.bugTotal} bug${p.bugTotal === 1 ? "" : "s"}` : ""})`
                                )
                                .join("\n")}
                            >
                              +{row.projects.length - MAX_PROJECT_CHIPS} more
                            </span>
                          )}
                        </div>
                      )}
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
                    <td className="px-3 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400 align-top">
                      {row.totalP1Bugs.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400 align-top">
                      {row.totalP2Bugs.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400 align-top">
                      {row.totalP3Bugs.toLocaleString()}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums align-top ${
                        row.totalBugs > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-zinc-400 dark:text-zinc-500"
                      }`}
                    >
                      {row.totalBugs.toLocaleString()}
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300 align-top whitespace-nowrap"
                      title={
                        row.locNet !== null
                          ? `+${(row.locAdditions ?? 0).toLocaleString()} / −${(row.locDeletions ?? 0).toLocaleString()}`
                          : "No mapped GitHub activity in this period"
                      }
                    >
                      {row.locNet !== null ? row.locNet.toLocaleString() : "—"}
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300 align-top whitespace-nowrap"
                      title={
                        row.daysPresent !== null
                          ? `${row.daysPresent} day${row.daysPresent === 1 ? "" : "s"} with logged hours (weekend/holiday work included) · ${row.workingDays ?? 0} scheduled working day${(row.workingDays ?? 0) === 1 ? "" : "s"} · ${row.daysAbsent ?? 0} absent${row.avgEffectiveHours !== null ? ` · avg ${row.avgEffectiveHours} h/day` : ""}`
                          : "No Keka attendance data in this period"
                      }
                    >
                      {row.daysPresent !== null ? (
                        <>
                          {row.daysPresent}
                          <span className="text-zinc-400 dark:text-zinc-500">
                            {" "}
                            / {row.workingDays ?? 0}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={12}
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

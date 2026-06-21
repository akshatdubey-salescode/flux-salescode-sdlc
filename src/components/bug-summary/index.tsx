"use client";

import { useEffect, useMemo, useState } from "react";
import {
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiArrowUpDownLine,
  RiExternalLinkLine,
  RiSearchLine,
  RiBugLine,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getRangePresets } from "@/lib/date-utils";
import {
  initials,
  priorityStyles,
  statusCategoryStyles,
  formatRelativeTime,
} from "@/components/project-tracking/helpers";
import {
  ENV_UNSET,
  UNASSIGNED_OWNER,
  type BugRow,
  type BugPriorityBucket,
} from "@/lib/bug-summary";
import { DateRangeBar } from "./date-range-bar";

type Props = { projectId: string };

type OwnerSummary = {
  ownerName: string;
  ownerEmail: string | null;
  p1: number;
  p2: number;
  p3: number;
  other: number;
  total: number;
  open: number;
};

type DetailSortKey =
  | "key"
  | "summary"
  | "owner"
  | "priority"
  | "environment"
  | "status"
  | "updated";

const SUMMARY_PAGE_SIZE = 10;
const DETAIL_PAGE_SIZE = 25;

// Severity ordering so the Priority column sorts P1 → P2 → P3 → Other.
const BUCKET_RANK: Record<BugPriorityBucket, number> = {
  P1: 0,
  P2: 1,
  P3: 2,
  Other: 3,
};

function defaultRange(): { start: string; end: string } {
  const last30 = getRangePresets().find((p) => p.label === "Last 30 days");
  return last30
    ? { start: last30.start, end: last30.end }
    : { start: "", end: "" };
}

function buildOwnerSummaries(bugs: BugRow[]): OwnerSummary[] {
  const map = new Map<string, OwnerSummary>();
  for (const b of bugs) {
    // Group by email when known so the same person isn't split by name casing;
    // fall back to the display name for unassigned/unresolved owners.
    const key = b.ownerEmail ?? b.ownerName;
    let s = map.get(key);
    if (!s) {
      s = {
        ownerName: b.ownerName,
        ownerEmail: b.ownerEmail,
        p1: 0,
        p2: 0,
        p3: 0,
        other: 0,
        total: 0,
        open: 0,
      };
      map.set(key, s);
    }
    if (b.priorityBucket === "P1") s.p1++;
    else if (b.priorityBucket === "P2") s.p2++;
    else if (b.priorityBucket === "P3") s.p3++;
    else s.other++;
    s.total++;
    if (b.isOpen) s.open++;
  }
  return [...map.values()].sort(
    (a, b) =>
      b.total - a.total ||
      b.open - a.open ||
      a.ownerName.localeCompare(b.ownerName)
  );
}

export function BugSummaryTab({ projectId }: Props) {
  const [bugs, setBugs] = useState<BugRow[]>([]);
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);

  // Global filters (apply to both tables).
  const [range, setRange] = useState(defaultRange);
  const [envFilter, setEnvFilter] = useState<string | null>(null);

  // Detail-table-only controls.
  const [query, setQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null); // owner key
  const [sortKey, setSortKey] = useState<DetailSortKey>("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Pagination.
  const [summaryPage, setSummaryPage] = useState(1);
  const [detailPage, setDetailPage] = useState(1);

  useEffect(() => {
    if (!range.start || !range.end) return;
    setLoading(true);
    const params = new URLSearchParams({ start: range.start, end: range.end });
    fetch(`/api/projects/${projectId}/bugs?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setBugs(data.bugs ?? []);
        setJiraBaseUrl(data.jiraBaseUrl ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, range.start, range.end]);

  // Environment filter applies globally, so the developer table re-aggregates.
  const filteredBugs = useMemo(
    () => (envFilter ? bugs.filter((b) => b.environment === envFilter) : bugs),
    [bugs, envFilter]
  );

  const summaries = useMemo(() => buildOwnerSummaries(filteredBugs), [filteredBugs]);
  const hasOther = useMemo(
    () => filteredBugs.some((b) => b.priorityBucket === "Other"),
    [filteredBugs]
  );

  const totals = useMemo(
    () =>
      summaries.reduce(
        (acc, s) => {
          acc.p1 += s.p1;
          acc.p2 += s.p2;
          acc.p3 += s.p3;
          acc.other += s.other;
          acc.total += s.total;
          acc.open += s.open;
          return acc;
        },
        { p1: 0, p2: 0, p3: 0, other: 0, total: 0, open: 0 }
      ),
    [summaries]
  );

  // Distinct environment labels present, in a stable preferred order. Derived
  // from the full (date-scoped) set so selecting one doesn't drop the others.
  const environments = useMemo(() => {
    const present = new Set(bugs.map((b) => b.environment));
    const preferred = ["Prod", "Demo", "UAT"];
    const ordered = preferred.filter((e) => present.has(e));
    const rest = [...present]
      .filter((e) => !preferred.includes(e) && e !== ENV_UNSET)
      .sort();
    if (present.has(ENV_UNSET)) rest.push(ENV_UNSET);
    return [...ordered, ...rest];
  }, [bugs]);

  const detailSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = filteredBugs.filter((b) => {
      if (ownerFilter && (b.ownerEmail ?? b.ownerName) !== ownerFilter) return false;
      if (!q) return true;
      return (
        b.jiraKey.toLowerCase().includes(q) ||
        b.summary.toLowerCase().includes(q) ||
        b.ownerName.toLowerCase().includes(q) ||
        b.environment.toLowerCase().includes(q) ||
        (b.priority ?? "").toLowerCase().includes(q) ||
        b.status.toLowerCase().includes(q)
      );
    });

    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "key":
          cmp = a.jiraKey.localeCompare(b.jiraKey, undefined, { numeric: true });
          break;
        case "summary":
          cmp = a.summary.localeCompare(b.summary);
          break;
        case "owner":
          cmp = a.ownerName.localeCompare(b.ownerName);
          break;
        case "priority":
          cmp = BUCKET_RANK[a.priorityBucket] - BUCKET_RANK[b.priorityBucket];
          break;
        case "environment":
          cmp = a.environment.localeCompare(b.environment);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "updated":
          cmp =
            new Date(a.jiraUpdatedAt ?? 0).getTime() -
            new Date(b.jiraUpdatedAt ?? 0).getTime();
          break;
      }
      if (cmp === 0) cmp = a.jiraKey.localeCompare(b.jiraKey, undefined, { numeric: true });
      return cmp * dir;
    });
    return list;
  }, [filteredBugs, query, ownerFilter, sortKey, sortDir]);

  // Reset pagination when the underlying filtered set changes.
  useEffect(() => setSummaryPage(1), [envFilter, bugs]);
  useEffect(() => setDetailPage(1), [envFilter, query, ownerFilter, sortKey, sortDir, bugs]);

  const summaryTotalPages = Math.max(1, Math.ceil(summaries.length / SUMMARY_PAGE_SIZE));
  const summaryPageSafe = Math.min(summaryPage, summaryTotalPages);
  const summaryPageItems = summaries.slice(
    (summaryPageSafe - 1) * SUMMARY_PAGE_SIZE,
    summaryPageSafe * SUMMARY_PAGE_SIZE
  );

  const detailTotalPages = Math.max(1, Math.ceil(detailSorted.length / DETAIL_PAGE_SIZE));
  const detailPageSafe = Math.min(detailPage, detailTotalPages);
  const detailPageItems = detailSorted.slice(
    (detailPageSafe - 1) * DETAIL_PAGE_SIZE,
    detailPageSafe * DETAIL_PAGE_SIZE
  );

  function handleSort(key: DetailSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible default direction per column: text ascending, time descending.
      setSortDir(key === "updated" ? "desc" : "asc");
    }
  }

  function browseUrl(key: string) {
    if (!jiraBaseUrl) return null;
    return `${jiraBaseUrl.replace(/\/$/, "")}/browse/${key}`;
  }

  return (
    <div className="space-y-7">
      {/* ----------------------------------------------------------------- */}
      {/* Global filters: date range + environment                          */}
      {/* ----------------------------------------------------------------- */}
      <div className="space-y-3">
        <DateRangeBar
          start={range.start}
          end={range.end}
          onChange={(start, end) => setRange({ start, end })}
          disabled={loading}
        />
        {environments.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Env
            </span>
            <FilterChip
              label="All"
              active={envFilter === null}
              onClick={() => setEnvFilter(null)}
            />
            {environments.map((env) => (
              <FilterChip
                key={env}
                label={env === ENV_UNSET ? "No env" : env}
                active={envFilter === env}
                onClick={() => setEnvFilter(envFilter === env ? null : env)}
              />
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : bugs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 p-12 text-center dark:border-zinc-800">
          <RiBugLine className="mx-auto size-6 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
            No bugs raised in this period
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Try a wider date range, or check that bugs have synced from Jira.
          </p>
        </div>
      ) : (
        <>
          {/* ------------------------------------------------------------- */}
          {/* Developer-wise bug count                                       */}
          {/* ------------------------------------------------------------- */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                Developer-wise Bug Count
                <span className="ml-2 text-xs font-normal text-zinc-400">
                  {summaries.length} {summaries.length === 1 ? "developer" : "developers"}
                </span>
              </h2>
              <span className="text-xs text-zinc-400">
                Owner = Issue Owner, falling back to Assignee
              </span>
            </div>

            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-left font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                      <th className="px-4 py-2.5">Developer</th>
                      <th className="px-3 py-2.5 text-center w-16">P1</th>
                      <th className="px-3 py-2.5 text-center w-16">P2</th>
                      <th className="px-3 py-2.5 text-center w-16">P3</th>
                      {hasOther && <th className="px-3 py-2.5 text-center w-16">Other</th>}
                      <th className="px-3 py-2.5 text-center w-20">Total</th>
                      <th className="px-3 py-2.5 text-center w-16">Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                    {summaryPageItems.map((s) => {
                      const key = s.ownerEmail ?? s.ownerName;
                      const active = ownerFilter === key;
                      return (
                        <tr
                          key={key}
                          onClick={() => setOwnerFilter(active ? null : key)}
                          className={cn(
                            "cursor-pointer transition-colors",
                            active
                              ? "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/40"
                              : "bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900/60"
                          )}
                          title={active ? "Click to clear filter" : "Click to filter bugs below"}
                        >
                          <td className="px-4 py-2">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className={cn(
                                  "flex size-6 items-center justify-center rounded-full text-[9px] font-bold",
                                  s.ownerName === UNASSIGNED_OWNER
                                    ? "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                                    : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                                )}
                              >
                                {s.ownerName === UNASSIGNED_OWNER ? "–" : initials(s.ownerName)}
                              </span>
                              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                                {s.ownerName}
                              </span>
                            </span>
                          </td>
                          <CountCell value={s.p1} />
                          <CountCell value={s.p2} />
                          <CountCell value={s.p3} />
                          {hasOther && <CountCell value={s.other} />}
                          <td className="px-3 py-2 text-center">
                            <span className="font-semibold text-rose-600 dark:text-rose-400">
                              {s.total}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center font-medium text-zinc-700 dark:text-zinc-300">
                            {s.open}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
                      <td className="px-4 py-2.5">Total</td>
                      <td className="px-3 py-2.5 text-center">{totals.p1}</td>
                      <td className="px-3 py-2.5 text-center">{totals.p2}</td>
                      <td className="px-3 py-2.5 text-center">{totals.p3}</td>
                      {hasOther && <td className="px-3 py-2.5 text-center">{totals.other}</td>}
                      <td className="px-3 py-2.5 text-center">{totals.total}</td>
                      <td className="px-3 py-2.5 text-center">{totals.open}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <Pagination
              page={summaryPageSafe}
              totalPages={summaryTotalPages}
              total={summaries.length}
              pageSize={SUMMARY_PAGE_SIZE}
              unit="developers"
              onPage={setSummaryPage}
            />
          </section>

          {/* ------------------------------------------------------------- */}
          {/* Detailed, searchable + sortable bug list                       */}
          {/* ------------------------------------------------------------- */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                All Bugs
                <span className="ml-2 text-xs font-normal text-zinc-400">
                  {detailSorted.length} of {filteredBugs.length}
                </span>
              </h2>
              <div className="relative w-full max-w-xs">
                <RiSearchLine className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search key, summary, owner…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>

            {ownerFilter && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span>
                  Filtered to{" "}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {summaries.find((s) => (s.ownerEmail ?? s.ownerName) === ownerFilter)?.ownerName ??
                      "selected developer"}
                  </span>
                </span>
                <button
                  onClick={() => setOwnerFilter(null)}
                  className="rounded border border-zinc-200 px-1.5 py-0.5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Clear
                </button>
              </div>
            )}

            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                      <SortHeader label="Key" col="key" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-24" />
                      <SortHeader label="Summary" col="summary" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Owner" col="owner" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-40" />
                      <SortHeader label="Priority" col="priority" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-24" />
                      <SortHeader label="Environment" col="environment" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-28" />
                      <SortHeader label="Status" col="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-36" />
                      <SortHeader label="Updated" col="updated" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-24 text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                    {detailPageItems.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-zinc-400">
                          No bugs match the current filters.
                        </td>
                      </tr>
                    ) : (
                      detailPageItems.map((b) => {
                        const url = browseUrl(b.jiraKey);
                        const pStyles = priorityStyles(b.priority);
                        const sStyles = statusCategoryStyles(b.statusCategory);
                        return (
                          <tr
                            key={b.id}
                            className="bg-white transition-colors hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900/60"
                          >
                            <td className="px-3 py-2 whitespace-nowrap">
                              {url ? (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 font-mono font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                                >
                                  {b.jiraKey}
                                  <RiExternalLinkLine className="size-2.5 opacity-60" />
                                </a>
                              ) : (
                                <span className="font-mono font-semibold text-zinc-500">{b.jiraKey}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 max-w-0">
                              {url ? (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block truncate font-medium text-zinc-800 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50"
                                  title={b.summary}
                                >
                                  {b.summary}
                                </a>
                              ) : (
                                <span className="block truncate font-medium text-zinc-800 dark:text-zinc-200" title={b.summary}>
                                  {b.summary}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className={cn(
                                    "flex size-5 items-center justify-center rounded-full text-[8px] font-bold",
                                    b.ownerName === UNASSIGNED_OWNER
                                      ? "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                                      : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                                  )}
                                >
                                  {b.ownerName === UNASSIGNED_OWNER ? "–" : initials(b.ownerName)}
                                </span>
                                <span className="truncate text-zinc-700 dark:text-zinc-300">{b.ownerName}</span>
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center gap-1.5">
                                <span className={cn("size-1.5 rounded-full", pStyles.dot)} />
                                <span className={cn("font-medium", pStyles.text)}>
                                  {b.priority ?? "—"}
                                </span>
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {b.environment === ENV_UNSET ? (
                                <span className="text-zinc-300 dark:text-zinc-600">{ENV_UNSET}</span>
                              ) : (
                                <span className="inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                  {b.environment}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={cn(
                                  "inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold",
                                  sStyles.badge
                                )}
                              >
                                {b.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-zinc-400">
                              {formatRelativeTime(b.jiraUpdatedAt)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <Pagination
              page={detailPageSafe}
              totalPages={detailTotalPages}
              total={detailSorted.length}
              pageSize={DETAIL_PAGE_SIZE}
              unit="bugs"
              onPage={setDetailPage}
            />
          </section>
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  unit,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  unit: string;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between text-xs text-zinc-500">
      <span>
        Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} {unit}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            className="rounded border border-zinc-200 px-2.5 py-1 font-medium hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Previous
          </button>
          <span className="px-2">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => onPage(page + 1)}
            disabled={page >= totalPages}
            className="rounded border border-zinc-200 px-2.5 py-1 font-medium hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function CountCell({ value }: { value: number }) {
  return (
    <td className="px-3 py-2 text-center tabular-nums">
      {value > 0 ? (
        <span className="text-zinc-700 dark:text-zinc-300">{value}</span>
      ) : (
        <span className="text-zinc-300 dark:text-zinc-700">·</span>
      )}
    </td>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
      )}
    >
      {label}
    </button>
  );
}

function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  col: DetailSortKey;
  sortKey: DetailSortKey;
  sortDir: "asc" | "desc";
  onSort: (col: DetailSortKey) => void;
  className?: string;
}) {
  const active = sortKey === col;
  return (
    <th className={cn("px-3 py-2.5 text-left font-medium text-zinc-500", className)}>
      <button
        onClick={() => onSort(col)}
        className="inline-flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <RiArrowUpSLine className="size-3.5" />
          ) : (
            <RiArrowDownSLine className="size-3.5" />
          )
        ) : (
          <RiArrowUpDownLine className="size-3 opacity-30" />
        )}
      </button>
    </th>
  );
}

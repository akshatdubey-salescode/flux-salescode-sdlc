"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiArrowUpDownLine,
  RiExternalLinkLine,
  RiSearchLine,
  RiBugLine,
  RiResetLeftLine,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { getRangePresets } from "@/lib/date-utils";
import {
  initials,
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

const SORT_KEYS: DetailSortKey[] = [
  "key",
  "summary",
  "owner",
  "priority",
  "environment",
  "status",
  "updated",
];
const DEFAULT_SORT: DetailSortKey = "priority";
const DEFAULT_DIR: "asc" | "desc" = "asc";

const SUMMARY_PAGE_SIZE = 20;
const DETAIL_PAGE_SIZE = 25;

// URL query param keys. Prefixed so they never collide with the project's
// other tabs (project-tracking uses bare `q`/`sortBy`/`page`/… on the same URL).
const QP = {
  start: "bs_start",
  end: "bs_end",
  env: "bs_env",
  q: "bs_q",
  owner: "bs_owner",
  sort: "bs_sort",
  dir: "bs_dir",
  inv: "bs_inv", // "0" = include invalid statuses; absent = exclude (default)
} as const;

// Severity ordering so the Priority column sorts P1 → P2 → P3 → Other.
const BUCKET_RANK: Record<BugPriorityBucket, number> = {
  P1: 0,
  P2: 1,
  P3: 2,
  Other: 3,
};

// Severity colour ramp (most → least urgent): red → orange → amber → sky → slate.
// Keyed by a normalized level so both numeric (P0–P4) and named (Highest/High/…)
// Jira priorities land on the same colour. The shared priorityStyles helper only
// knows the named set, so it leaves P0–P4 grey — hence this dedicated ramp.
type PriorityLevel = "p0" | "p1" | "p2" | "p3" | "p4" | "none";

function priorityLevel(priority: string | null): PriorityLevel {
  const p = (priority ?? "").trim().toLowerCase();
  if (p === "p0") return "p0";
  if (["p1", "highest", "blocker", "critical"].includes(p)) return "p1";
  if (["p2", "high", "major"].includes(p)) return "p2";
  if (["p3", "medium", "moderate"].includes(p)) return "p3";
  if (["p4", "low", "lowest", "minor", "trivial"].includes(p)) return "p4";
  return "none";
}

const PRIORITY_COLORS: Record<PriorityLevel, { badge: string; dot: string }> = {
  p0: { badge: "bg-red-200 text-red-900 dark:bg-red-950/60 dark:text-red-200", dot: "bg-red-700" },
  p1: { badge: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300", dot: "bg-red-500" },
  p2: { badge: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300", dot: "bg-orange-500" },
  p3: { badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300", dot: "bg-amber-500" },
  p4: { badge: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300", dot: "bg-sky-500" },
  none: { badge: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400", dot: "bg-zinc-300 dark:bg-zinc-600" },
};

// Accent for the developer-table priority-bucket columns (P1/P2/P3/Other).
const BUCKET_COLORS: Record<BugPriorityBucket, string> = {
  P1: "text-red-600 dark:text-red-400",
  P2: "text-orange-600 dark:text-orange-400",
  P3: "text-amber-600 dark:text-amber-400",
  Other: "text-zinc-500 dark:text-zinc-400",
};

function defaultRange(): { start: string; end: string } {
  const last30 = getRangePresets().find((p) => p.label === "Last 30 days");
  return last30 ? { start: last30.start, end: last30.end } : { start: "", end: "" };
}

function asSortKey(v: string | null): DetailSortKey {
  return v && (SORT_KEYS as string[]).includes(v) ? (v as DetailSortKey) : DEFAULT_SORT;
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
  const router = useRouter();
  const searchParams = useSearchParams();

  const [bugs, setBugs] = useState<BugRow[]>([]);
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);

  // --- Filters are derived from the URL so they persist + are shareable. -----
  const def = defaultRange();
  const start = searchParams.get(QP.start) || def.start;
  const end = searchParams.get(QP.end) || def.end;
  const envFilter = searchParams.get(QP.env); // null when absent
  const ownerFilter = searchParams.get(QP.owner); // owner key, null when absent
  const q = searchParams.get(QP.q) ?? "";
  const sortKey = asSortKey(searchParams.get(QP.sort));
  const sortDir: "asc" | "desc" = searchParams.get(QP.dir) === "desc" ? "desc" : "asc";
  // Exclude "Not a bug" / "Can't Reproduce" by default; bs_inv=0 includes them.
  const excludeInvalid = searchParams.get(QP.inv) !== "0";

  const rangeChanged = start !== def.start || end !== def.end;
  const hasActiveFilters =
    rangeChanged ||
    envFilter !== null ||
    ownerFilter !== null ||
    q !== "" ||
    !excludeInvalid ||
    sortKey !== DEFAULT_SORT ||
    sortDir !== DEFAULT_DIR;

  // Local mirror of the search box for responsive typing; debounced into the URL.
  const [searchInput, setSearchInput] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pagination (transient — not persisted).
  const [summaryPage, setSummaryPage] = useState(1);
  const [detailPage, setDetailPage] = useState(1);

  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function handleSearch(value: string) {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ [QP.q]: value || null });
    }, 300);
  }

  function resetFilters() {
    setSearchInput("");
    updateParams({
      [QP.start]: null,
      [QP.end]: null,
      [QP.env]: null,
      [QP.owner]: null,
      [QP.q]: null,
      [QP.sort]: null,
      [QP.dir]: null,
      [QP.inv]: null,
    });
  }

  function handleSort(key: DetailSortKey) {
    if (sortKey === key) {
      updateParams({ [QP.dir]: sortDir === "asc" ? "desc" : "asc" });
    } else {
      // Sensible default direction per column: text ascending, time descending.
      updateParams({ [QP.sort]: key, [QP.dir]: key === "updated" ? "desc" : "asc" });
    }
  }

  useEffect(() => {
    if (!start || !end) return;
    setLoading(true);
    const params = new URLSearchParams({ start, end });
    fetch(`/api/projects/${projectId}/bugs?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setBugs(data.bugs ?? []);
        setJiraBaseUrl(data.jiraBaseUrl ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, start, end]);

  // Global filters (environment + invalid-status exclusion) feed BOTH tables,
  // so the developer-wise counts re-aggregate too.
  const filteredBugs = useMemo(
    () =>
      bugs.filter(
        (b) =>
          (!envFilter || b.environment === envFilter) &&
          (!excludeInvalid || !b.isInvalid)
      ),
    [bugs, envFilter, excludeInvalid]
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
    const needle = q.trim().toLowerCase();
    let list = filteredBugs.filter((b) => {
      if (ownerFilter && (b.ownerEmail ?? b.ownerName) !== ownerFilter) return false;
      if (!needle) return true;
      return (
        b.jiraKey.toLowerCase().includes(needle) ||
        b.summary.toLowerCase().includes(needle) ||
        b.ownerName.toLowerCase().includes(needle) ||
        b.environment.toLowerCase().includes(needle) ||
        (b.priority ?? "").toLowerCase().includes(needle) ||
        b.status.toLowerCase().includes(needle)
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
  }, [filteredBugs, q, ownerFilter, sortKey, sortDir]);

  // Reset pagination when the underlying filtered set changes.
  useEffect(() => setSummaryPage(1), [envFilter, excludeInvalid, bugs]);
  useEffect(
    () => setDetailPage(1),
    [envFilter, excludeInvalid, q, ownerFilter, sortKey, sortDir, bugs]
  );

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

  function browseUrl(key: string) {
    if (!jiraBaseUrl) return null;
    return `${jiraBaseUrl.replace(/\/$/, "")}/browse/${key}`;
  }

  return (
    <div className="space-y-7">
      {/* ----------------------------------------------------------------- */}
      {/* Global filters: date range + environment + reset                  */}
      {/* ----------------------------------------------------------------- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DateRangeBar
            start={start}
            end={end}
            onChange={(s, e) => updateParams({ [QP.start]: s, [QP.end]: e })}
            disabled={loading}
          />
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <RiResetLeftLine className="size-3.5" />
              Reset filters
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {environments.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                Env
              </span>
              <FilterChip
                label="All"
                active={envFilter === null}
                onClick={() => updateParams({ [QP.env]: null })}
              />
              {environments.map((env) => (
                <FilterChip
                  key={env}
                  label={env === ENV_UNSET ? "No env" : env}
                  active={envFilter === env}
                  onClick={() => updateParams({ [QP.env]: envFilter === env ? null : env })}
                />
              ))}
            </div>
          ) : (
            <span />
          )}

          <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <Checkbox
              checked={excludeInvalid}
              onCheckedChange={(v) => updateParams({ [QP.inv]: v === true ? null : "0" })}
            />
            Exclude “Not a bug” &amp; “Can’t Reproduce”
          </label>
        </div>
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
                      <th className={cn("px-3 py-2.5 text-center w-16 font-semibold", BUCKET_COLORS.P1)}>P1</th>
                      <th className={cn("px-3 py-2.5 text-center w-16 font-semibold", BUCKET_COLORS.P2)}>P2</th>
                      <th className={cn("px-3 py-2.5 text-center w-16 font-semibold", BUCKET_COLORS.P3)}>P3</th>
                      {hasOther && <th className={cn("px-3 py-2.5 text-center w-16 font-semibold", BUCKET_COLORS.Other)}>Other</th>}
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
                          onClick={() =>
                            updateParams({ [QP.owner]: active ? null : key })
                          }
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
                          <CountCell value={s.p1} colorClass={BUCKET_COLORS.P1} />
                          <CountCell value={s.p2} colorClass={BUCKET_COLORS.P2} />
                          <CountCell value={s.p3} colorClass={BUCKET_COLORS.P3} />
                          {hasOther && <CountCell value={s.other} colorClass={BUCKET_COLORS.Other} />}
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
                  value={searchInput}
                  onChange={(e) => handleSearch(e.target.value)}
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
                  onClick={() => updateParams({ [QP.owner]: null })}
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
                        const pColor = PRIORITY_COLORS[priorityLevel(b.priority)];
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
                              {b.priority ? (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                    pColor.badge
                                  )}
                                >
                                  <span className={cn("size-1.5 rounded-full", pColor.dot)} />
                                  {b.priority}
                                </span>
                              ) : (
                                <span className="text-zinc-300 dark:text-zinc-600">—</span>
                              )}
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

function CountCell({ value, colorClass }: { value: number; colorClass?: string }) {
  return (
    <td className="px-3 py-2 text-center tabular-nums">
      {value > 0 ? (
        <span className={cn("font-medium", colorClass ?? "text-zinc-700 dark:text-zinc-300")}>
          {value}
        </span>
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
          ? "bg-primary text-primary-foreground"
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

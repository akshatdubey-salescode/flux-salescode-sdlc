"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiSearchLine,
  RiExternalLinkLine,
  RiArrowRightUpLine,
  RiBugLine,
  RiPieChartLine,
  RiAppsLine,
} from "@remixicon/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DateRangeBar } from "@/components/bug-summary/date-range-bar";
import { currentFiscalQuarterChip } from "@/lib/date-utils";
import type { BugBoardResponse, BugProject } from "@/app/api/bugs/route";
import {
  buildOwnerRows,
  computeTeamStats,
  deriveOwnerOptions,
  deriveEnvironments,
  effectiveCounts,
  jiraOwnerBugLink,
  rag,
  RAG_BADGE,
  PRIORITIES,
  type OwnerRow,
  type ProjectBreakdown,
  type Counts,
  type TeamStats,
  type PriorityKey,
} from "@/lib/bugs/aggregate";
import { ENV_UNSET } from "@/lib/bug-summary";

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------

type SortKey = "name" | "total" | "p1" | "p2" | "p3" | "p4" | "open";
type PriorityCol = { key: PriorityKey; label: string; jql: string };

const SORT_OPTS: { value: SortKey; label: string }[] = [
  { value: "total", label: "Total" },
  { value: "name",  label: "Name"  },
  { value: "p1",    label: "P1"    },
  { value: "p2",    label: "P2"    },
  { value: "p3",    label: "P3"    },
  { value: "p4",    label: "P4"    },
  { value: "open",  label: "Open"  },
];

const ALL_PRIORITY_COLS: PriorityCol[] = [
  { key: "p1", label: "P1", jql: "P1" },
  { key: "p2", label: "P2", jql: "P2" },
  { key: "p3", label: "P3", jql: "P3" },
  { key: "p4", label: "P4", jql: "P4" },
];

/**
 * Link to a developer's My Bugs view (the per-user Tasks page, Bugs tab),
 * carrying the board's active date range so the landing page shows the same
 * window. `bs_*` drives the BugTracker range; `qstart/qend` keep the Tasks
 * header range in sync.
 */
function myBugsHref(
  email: string,
  from?: string,
  to?: string,
  env?: string | null,
  projectKeys?: string[],
): string {
  const params = new URLSearchParams({ tab: "bugs" });
  if (from && to) {
    params.set("qstart", from);
    params.set("qend", to);
    params.set("bs_start", from);
    params.set("bs_end", to);
  }
  if (env) params.set("bs_env", env); // BugTracker matches on the normalized label
  if (projectKeys && projectKeys.length) params.set("bs_proj", projectKeys.join(","));
  return `/tasks/${encodeURIComponent(email)}?${params}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BugBoardClient() {
  type FetchResult =
    | { ok: true;  data: BugBoardResponse; cacheKey: string }
    | { ok: false; error: string;          cacheKey: string };

  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null);
  const [selProjects,   setSelProjects]   = useState<string[]>([]);
  const [selOwners,     setSelOwners]     = useState<string[]>([]);
  const [selPriorities, setSelPriorities] = useState<PriorityKey[]>([...PRIORITIES]);
  const [selEnv,        setSelEnv]        = useState<string | null>(null);
  const [cfOnly,        setCfOnly]        = useState(false);
  // Date range as inclusive YYYY-MM-DD bounds; defaults to the current fiscal
  // quarter (matching my-tasks / my-bugs), driven by the shared DateRangeBar.
  const defaultQuarter = useMemo(() => currentFiscalQuarterChip(), []);
  const [start, setStart] = useState(defaultQuarter?.start ?? "");
  const [end,   setEnd]   = useState(defaultQuarter?.end ?? "");
  const [sortBy,        setSortBy]        = useState<SortKey>("total");
  const [sortDir,       setSortDir]       = useState<"asc" | "desc">("desc");
  const [expandedSource,   setExpandedSource]   = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const cacheKey = `${start}:${end}`;

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams();
    if (start) params.set("from", start);
    if (end)   params.set("to", end);
    fetch(`/api/bugs${params.size ? `?${params}` : ""}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: BugBoardResponse) => {
        if (alive) setFetchResult({ ok: true, data: d, cacheKey });
      })
      .catch((e) => {
        if (alive) setFetchResult({ ok: false, error: String(e), cacheKey });
      });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  const isCurrentKey  = fetchResult?.cacheKey === cacheKey;
  const loading = !isCurrentKey;
  const error   = isCurrentKey && !fetchResult.ok  ? fetchResult.error : null;
  const data    = isCurrentKey &&  fetchResult.ok  ? fetchResult.data  : null;

  const projectById = useMemo(() => {
    const m = new Map<string, BugProject>();
    for (const p of data?.projects ?? []) m.set(p.id, p);
    return m;
  }, [data]);

  const freshdeskFieldId = data?.freshdeskFieldId ?? null;

  const projectIdSet = useMemo(() => new Set(selProjects), [selProjects]);
  // Selected projects as Jira keys, for persisting into the My Bugs deep-link
  // (the BugTracker there filters by project key, not our internal project id).
  const selProjectKeys = useMemo(
    () => selProjects.map((id) => projectById.get(id)?.jiraProjectKey).filter((k): k is string => !!k),
    [selProjects, projectById],
  );
  const prioritySet  = useMemo(
    () => new Set(selPriorities) as Set<PriorityKey>,
    [selPriorities],
  );
  const allPrioritiesSelected = selPriorities.length === 4;

  // Env filter is applied at the cell level (before owner aggregation) so the
  // counts, % share, and breakdowns all reflect the selected environment.
  const ownerRows = useMemo(() => {
    if (!data) return [];
    const cells = selEnv ? data.cells.filter((c) => c.environment === selEnv) : data.cells;
    return buildOwnerRows(cells, projectIdSet);
  }, [data, projectIdSet, selEnv]);

  const effectiveRows: OwnerRow[] = useMemo(() => {
    const applyFilters = (c: Counts): Partial<Counts> => {
      const afterPriority = allPrioritiesSelected ? c : effectiveCounts(c, prioritySet);
      if (!cfOnly) return afterPriority;
      return {
        ...afterPriority,
        total: afterPriority.cfTotal,
        p1: afterPriority.cf1, p2: afterPriority.cf2,
        p3: afterPriority.cf3, p4: afterPriority.cf4,
        // open breakdown not available per source — zero it so cells show "—"
        open: 0, open1: 0, open2: 0, open3: 0, open4: 0,
      };
    };
    return ownerRows.map((row) => ({
      ...row,
      ...applyFilters(row),
      projects: row.projects.map((p) => ({ ...p, ...applyFilters(p) })),
    }));
  }, [ownerRows, allPrioritiesSelected, prioritySet, cfOnly]);

  const teamStats = useMemo(() => computeTeamStats(effectiveRows), [effectiveRows]);

  const projectOptions = useMemo(
    () => (data?.projects ?? []).map((p) => ({ value: p.id, label: p.name })),
    [data],
  );
  const ownerOptions = useMemo(
    () => deriveOwnerOptions(data?.cells ?? []),
    [data],
  );
  const envOptions = useMemo(
    () => deriveEnvironments(data?.cells ?? []),
    [data],
  );
  const visiblePriorityCols = useMemo(
    () => ALL_PRIORITY_COLS.filter((c) => prioritySet.has(c.key)),
    [prioritySet],
  );

  const displayRows = useMemo(() => {
    const ownerSet  = new Set(selOwners);
    const filterOn  = ownerSet.size > 0;
    const rows = effectiveRows.filter((r) =>
      r.isUnassigned ? !filterOn : !filterOn || ownerSet.has(r.key),
    );
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      if (sortBy === "name") return dir * a.name.localeCompare(b.name);
      return dir * ((a[sortBy] as number) - (b[sortBy] as number));
    });
    return rows;
  }, [effectiveRows, selOwners, sortBy, sortDir]);

  const grandTotal = useMemo<Counts>(() => {
    const acc: Counts = {
      total: 0, p1: 0, p2: 0, p3: 0, p4: 0,
      open: 0, open1: 0, open2: 0, open3: 0, open4: 0,
      cfTotal: 0, cf1: 0, cf2: 0, cf3: 0, cf4: 0,
    };
    for (const r of displayRows) {
      acc.total += r.total; acc.p1 += r.p1; acc.p2 += r.p2;
      acc.p3 += r.p3; acc.p4 += r.p4; acc.open += r.open;
      acc.open1 += r.open1; acc.open2 += r.open2; acc.open3 += r.open3; acc.open4 += r.open4;
      acc.cfTotal += r.cfTotal; acc.cf1 += r.cf1; acc.cf2 += r.cf2; acc.cf3 += r.cf3; acc.cf4 += r.cf4;
    }
    return acc;
  }, [displayRows]);

  const totalProjectBreakdowns = useMemo<ProjectBreakdown[]>(() => {
    const map = new Map<string, ProjectBreakdown>();
    for (const row of displayRows) {
      for (const p of row.projects) {
        const ex = map.get(p.projectId);
        if (!ex) { map.set(p.projectId, { ...p }); continue; }
        ex.total += p.total; ex.p1 += p.p1; ex.p2 += p.p2; ex.p3 += p.p3; ex.p4 += p.p4;
        ex.open += p.open; ex.open1 += p.open1; ex.open2 += p.open2; ex.open3 += p.open3; ex.open4 += p.open4;
        ex.cfTotal += p.cfTotal; ex.cf1 += p.cf1; ex.cf2 += p.cf2; ex.cf3 += p.cf3; ex.cf4 += p.cf4;
      }
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [displayRows]);

  const totalOwnerRow = useMemo<OwnerRow>(() => ({
    key: "__total__", name: "Total", email: null, account: null, isUnassigned: false,
    projects: totalProjectBreakdowns,
    ...grandTotal,
  }), [totalProjectBreakdowns, grandTotal]);

  const togglePriority = (key: PriorityKey) =>
    setSelPriorities((prev) =>
      prev.includes(key)
        ? prev.length > 1 ? prev.filter((k) => k !== key) : prev
        : [...prev, key],
    );

  const toggleSource = (key: string) =>
    setExpandedSource((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });

  const toggleProjects = (key: string) =>
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });

  // Resolved date range for Jira deep-links + My Bugs links — the active bounds.
  const resolvedFrom = start || undefined;
  const resolvedTo = end || undefined;

  // Developer + visible-priority cols + Total + Open + % Share + View
  const colSpan = 1 + visiblePriorityCols.length + 4;

  return (
    <div className="space-y-5">
      {/* Stats bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <RiBugLine size={18} className="text-red-500" />
            User wise Bug Count
          </h1>
          {!loading && !error && (
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatChip label="users" value={teamStats.numOwners} />
              <StatChip label={cfOnly ? "customer bugs shown" : "bugs shown"} value={displayRows.reduce((s, r) => s + r.total, 0)} />
              <StatChip label={cfOnly ? "avg CF / user" : "avg / user"} value={Math.round(teamStats.avg.total)} />
              <span className="text-muted-foreground/50">·</span>
              <span className="inline-flex items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400">above avg</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">≈ avg</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">below avg</span>
                </span>
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Priority
        </span>
        {ALL_PRIORITY_COLS.map((c) => {
          const active = prioritySet.has(c.key);
          return (
            <button
              key={c.key}
              onClick={() => togglePriority(c.key)}
              className={`h-6 rounded border px-2 text-[11px] font-semibold transition-colors ${
                active
                  ? "border-primary/40 bg-primary/5 text-primary dark:bg-primary/10"
                  : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          );
        })}

        <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

        <button
          onClick={() => setCfOnly((v) => !v)}
          className={`h-6 rounded border px-2 text-[11px] font-semibold transition-colors ${
            cfOnly
              ? "border-amber-400/60 bg-amber-50 text-amber-700 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-400"
              : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          Customer-found only
        </button>

        <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

        <DateRangeBar
          start={start}
          end={end}
          onChange={(s, e) => { setStart(s); setEnd(e); }}
          disabled={loading}
        />

        {envOptions.length > 0 && (
          <>
            <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
              Env
            </span>
            <button
              onClick={() => setSelEnv(null)}
              className={`h-6 rounded border px-2 text-[11px] font-semibold transition-colors ${
                selEnv === null
                  ? "border-primary/40 bg-primary/5 text-primary dark:bg-primary/10"
                  : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              All
            </button>
            {envOptions.map((env) => {
              const active = selEnv === env;
              return (
                <button
                  key={env}
                  onClick={() => setSelEnv(active ? null : env)}
                  className={`h-6 rounded border px-2 text-[11px] font-semibold transition-colors ${
                    active
                      ? "border-primary/40 bg-primary/5 text-primary dark:bg-primary/10"
                      : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {env === ENV_UNSET ? "No env" : env}
                </button>
              );
            })}
          </>
        )}

        <SearchableMultiSelect
          label="Projects"
          options={projectOptions}
          selected={selProjects}
          onChange={setSelProjects}
        />
        <SearchableMultiSelect
          label="Developers"
          options={ownerOptions}
          selected={selOwners}
          onChange={setSelOwners}
        />

        <div className="ml-auto">
          <SortControl
            sortBy={sortBy}
            sortDir={sortDir}
            onChange={(by, dir) => { setSortBy(by); setSortDir(dir); }}
          />
        </div>
      </div>

      {/* Loading / error */}
      {loading && (
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <RiBugLine size={15} className="animate-pulse text-red-400" />
            Loading…
          </span>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          Failed to load: {error}
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/60">
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Developer
                </th>
                {visiblePriorityCols.map((c) => (
                  <th key={c.key} className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Open</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">% Share</th>
                <th className="w-16 px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">View</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No bugs match the current filters.
                  </td>
                </tr>
              ) : (
                displayRows.map((row) => (
                  <OwnerRowView
                    key={row.key}
                    row={row}
                    team={teamStats}
                    projectById={projectById}
                    sourceOpen={expandedSource.has(row.key)}
                    projectsOpen={expandedProjects.has(row.key)}
                    onToggleSource={() => toggleSource(row.key)}
                    onToggleProjects={() => toggleProjects(row.key)}
                    visiblePriorityCols={visiblePriorityCols}
                    prioritySet={prioritySet}
                    colSpan={colSpan}
                    dateFrom={resolvedFrom}
                    dateTo={resolvedTo}
                    env={selEnv}
                    projectKeys={selProjectKeys}
                    cfOnly={cfOnly}
                    freshdeskFieldId={freshdeskFieldId}
                  />
                ))
              )}
            </tbody>
            {displayRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-zinc-300 bg-zinc-50/90 dark:border-zinc-700 dark:bg-zinc-900/60">
                  <td className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-foreground">
                    Total
                  </td>
                  {visiblePriorityCols.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-foreground">
                      {grandTotal[c.key] || <span className="font-normal text-muted-foreground/40">—</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right text-xs font-extrabold tabular-nums text-foreground">
                    {grandTotal.total}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-foreground">
                    {grandTotal.open}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-foreground">
                    100%
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <ActionButton active={expandedSource.has("__total__")}   onClick={() => toggleSource("__total__")}   title="Customer vs QA breakdown" icon={<RiPieChartLine size={13} />} />
                      <ActionButton active={expandedProjects.has("__total__")} onClick={() => toggleProjects("__total__")} title="Project-wise split"        icon={<RiAppsLine    size={13} />} />
                    </div>
                  </td>
                </tr>
                {expandedSource.has("__total__") && (
                  <tr>
                    <td colSpan={colSpan} className="bg-zinc-50/50 px-5 py-3 dark:bg-zinc-800/20">
                      <FoundBreakdown counts={grandTotal} prioritySet={prioritySet} />
                    </td>
                  </tr>
                )}
                {expandedProjects.has("__total__") && (
                  <tr>
                    <td colSpan={colSpan} className="bg-zinc-50/50 px-5 py-3 dark:bg-zinc-800/20">
                      <ProjectSplit row={totalOwnerRow} projectById={projectById} visiblePriorityCols={visiblePriorityCols} prioritySet={prioritySet} dateFrom={resolvedFrom} dateTo={resolvedTo} cfOnly={cfOnly} freshdeskFieldId={freshdeskFieldId} />
                    </td>
                  </tr>
                )}
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat chip
// ---------------------------------------------------------------------------

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-px dark:border-zinc-800 dark:bg-zinc-900">
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Owner row
// ---------------------------------------------------------------------------

function OwnerRowView({
  row,
  team,
  projectById,
  sourceOpen,
  projectsOpen,
  onToggleSource,
  onToggleProjects,
  visiblePriorityCols,
  prioritySet,
  colSpan,
  dateFrom,
  dateTo,
  env,
  projectKeys,
  cfOnly,
  freshdeskFieldId,
}: {
  row: OwnerRow;
  team: TeamStats;
  projectById: Map<string, BugProject>;
  sourceOpen: boolean;
  projectsOpen: boolean;
  onToggleSource: () => void;
  onToggleProjects: () => void;
  visiblePriorityCols: PriorityCol[];
  prioritySet: Set<PriorityKey>;
  colSpan: number;
  dateFrom?: string;
  dateTo?: string;
  env?: string | null;
  projectKeys?: string[];
  cfOnly?: boolean;
  freshdeskFieldId?: number | null;
}) {
  const contrib = team.grandTotal > 0 ? (row.total / team.grandTotal) * 100 : 0;
  const neutral = row.isUnassigned;

  return (
    <>
      <tr className="border-b border-zinc-100 transition-colors hover:bg-zinc-50/60 dark:border-zinc-800/60 dark:hover:bg-zinc-800/20">
        <td className="px-4 py-3">
          <span className="group inline-flex items-center gap-1.5">
            <span className={`text-sm font-medium ${neutral ? "italic text-muted-foreground" : "text-foreground"}`}>
              {row.name}
            </span>
            {!neutral && row.email && (
              <Link
                href={myBugsHref(row.email, dateFrom, dateTo, env, projectKeys)}
                title={`Open ${row.name}'s bugs`}
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground/40 opacity-0 transition-opacity hover:text-primary group-hover:opacity-100 focus:opacity-100"
              >
                <RiArrowRightUpLine size={14} />
              </Link>
            )}
          </span>
        </td>
        {visiblePriorityCols.map((c) => (
          <CountCell key={c.key} value={row[c.key]} avg={team.avg[c.key]} neutral={neutral} />
        ))}
        <CountCell value={row.total} avg={team.avg.total} neutral={neutral} bold />
        <CountCell value={row.open}  avg={team.avg.open}  neutral={neutral} />
        <ContribCell pct={contrib} value={row.total} avg={team.avg.total} neutral={neutral} />
        <td className="px-3 py-3">
          <div className="flex items-center justify-center gap-1">
            <ActionButton active={sourceOpen}   onClick={onToggleSource}   title="Customer vs QA breakdown" icon={<RiPieChartLine size={13} />} />
            <ActionButton active={projectsOpen} onClick={onToggleProjects} title="Project-wise split"        icon={<RiAppsLine    size={13} />} />
          </div>
        </td>
      </tr>

      {sourceOpen && (
        <tr className="border-b border-zinc-100 dark:border-zinc-800/60">
          <td colSpan={colSpan} className="bg-zinc-50/50 px-5 py-3 dark:bg-zinc-800/20">
            <FoundBreakdown counts={row} prioritySet={prioritySet} />
          </td>
        </tr>
      )}

      {projectsOpen && (
        <tr className="border-b border-zinc-100 dark:border-zinc-800/60">
          <td colSpan={colSpan} className="bg-zinc-50/50 px-5 py-3 dark:bg-zinc-800/20">
            <ProjectSplit row={row} projectById={projectById} visiblePriorityCols={visiblePriorityCols} prioritySet={prioritySet} dateFrom={dateFrom} dateTo={dateTo} cfOnly={cfOnly} freshdeskFieldId={freshdeskFieldId} />
          </td>
        </tr>
      )}
    </>
  );
}

function ActionButton({
  active, onClick, title, icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex size-7 items-center justify-center rounded-md border transition-colors ${
        active
          ? "border-primary/40 bg-primary/5 text-primary dark:bg-primary/10"
          : "border-transparent text-muted-foreground hover:border-zinc-200 hover:bg-zinc-100 hover:text-foreground dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
      }`}
    >
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function CountCell({
  value, avg, neutral, bold,
}: {
  value: number;
  avg: number;
  neutral?: boolean;
  bold?: boolean;
}) {
  const state = neutral ? "neutral" : rag(value, avg);
  const badge = RAG_BADGE[state];
  return (
    <td className="px-3 py-3 text-right tabular-nums text-sm">
      {value ? (
        badge
          ? <span className={badge}>{value}</span>
          : <span className={bold ? "font-bold text-foreground" : "text-foreground"}>{value}</span>
      ) : (
        <span className="text-muted-foreground/30">—</span>
      )}
    </td>
  );
}

function ContribCell({
  pct, value, avg, neutral,
}: {
  pct: number;
  value: number;
  avg: number;
  neutral?: boolean;
}) {
  const state = neutral ? "neutral" : rag(value, avg);
  const badge = RAG_BADGE[state];
  const text = `${pct.toFixed(1)}%`;
  return (
    <td className="px-3 py-3 text-right tabular-nums text-sm">
      {badge
        ? <span className={badge}>{text}</span>
        : <span className="text-foreground">{text}</span>
      }
    </td>
  );
}

// ---------------------------------------------------------------------------
// Source breakdown panel
// ---------------------------------------------------------------------------

function FoundBreakdown({ counts, prioritySet }: { counts: Counts; prioritySet: Set<PriorityKey> }) {
  const rows = [
    { label: "P1", key: "p1" as PriorityKey, total: counts.p1, cf: counts.cf1 },
    { label: "P2", key: "p2" as PriorityKey, total: counts.p2, cf: counts.cf2 },
    { label: "P3", key: "p3" as PriorityKey, total: counts.p3, cf: counts.cf3 },
    { label: "P4", key: "p4" as PriorityKey, total: counts.p4, cf: counts.cf4 },
  ].filter((r) => prioritySet.has(r.key));

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Source breakdown
      </p>
      <div
        className="inline-grid gap-x-6 gap-y-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        style={{ gridTemplateColumns: `auto repeat(${rows.length}, minmax(44px, 1fr))` }}
      >
        <span />
        {rows.map((r) => (
          <span key={r.label} className="text-right text-[11px] font-semibold uppercase text-muted-foreground">{r.label}</span>
        ))}
        <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
          <span className="inline-block size-2 rounded-full bg-amber-400" />Customer-found
        </span>
        {rows.map((r) => (
          <span key={r.label} className="text-right tabular-nums font-medium">
            {r.cf || <span className="text-muted-foreground/30">—</span>}
          </span>
        ))}
        <span className="flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400">
          <span className="inline-block size-2 rounded-full bg-blue-400" />QA-found
        </span>
        {rows.map((r) => (
          <span key={r.label} className="text-right tabular-nums font-medium">
            {r.total - r.cf || <span className="text-muted-foreground/30">—</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project split panel
// ---------------------------------------------------------------------------

function ProjectSplit({
  row, projectById, visiblePriorityCols, prioritySet, dateFrom, dateTo, cfOnly, freshdeskFieldId,
}: {
  row: OwnerRow;
  projectById: Map<string, BugProject>;
  visiblePriorityCols: PriorityCol[];
  prioritySet: Set<PriorityKey>;
  dateFrom?: string;
  dateTo?: string;
  cfOnly?: boolean;
  freshdeskFieldId?: number | null;
}) {
  const projAvgTotal = row.projects.length > 0 ? row.total / row.projects.length : 0;

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Project breakdown — click row or priority to open in Jira
      </p>
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-100/60 text-left dark:bg-zinc-800/50">
              <th className="px-3 py-2 font-semibold uppercase tracking-wide text-muted-foreground">Project</th>
              {visiblePriorityCols.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</th>
              ))}
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Total</th>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Open</th>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">% Share</th>
            </tr>
          </thead>
          <tbody>
            {row.projects.map((p) => (
              <ProjectRowView
                key={p.projectId}
                p={p}
                ownerTotal={row.total}
                projAvgTotal={projAvgTotal}
                account={row.account}
                project={projectById.get(p.projectId)}
                visiblePriorityCols={visiblePriorityCols}
                prioritySet={prioritySet}
                dateFrom={dateFrom}
                dateTo={dateTo}
                cfOnly={cfOnly}
                freshdeskFieldId={freshdeskFieldId}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectRowView({
  p, ownerTotal, projAvgTotal, account, project, visiblePriorityCols, dateFrom, dateTo, cfOnly, freshdeskFieldId,
}: {
  p: ProjectBreakdown;
  ownerTotal: number;
  projAvgTotal: number;
  account: string | null;
  project: BugProject | undefined;
  visiblePriorityCols: PriorityCol[];
  prioritySet: Set<PriorityKey>;
  dateFrom?: string;
  dateTo?: string;
  cfOnly?: boolean;
  freshdeskFieldId?: number | null;
}) {
  const contrib  = ownerTotal > 0 ? (p.total / ownerTotal) * 100 : 0;
  const state    = rag(p.total, projAvgTotal);
  const badge    = RAG_BADGE[state];
  const rowLink  = project ? jiraOwnerBugLink(project, account, undefined, dateFrom, dateTo, cfOnly, freshdeskFieldId) : null;

  const open = (priority?: string) => {
    if (!project) return;
    window.open(jiraOwnerBugLink(project, account, priority, dateFrom, dateTo, cfOnly, freshdeskFieldId), "_blank", "noopener,noreferrer");
  };

  return (
    <tr
      className={`border-t border-zinc-100 transition-colors dark:border-zinc-800/60 ${rowLink ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/30" : ""}`}
      onClick={() => open()}
    >
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          {p.projectName}
          {rowLink && <RiExternalLinkLine size={10} className="shrink-0 opacity-40" />}
        </span>
      </td>
      {visiblePriorityCols.map((c) => (
        <td key={c.key} className="px-3 py-2 text-right tabular-nums">
          {p[c.key] ? (
            <button
              onClick={(e) => { e.stopPropagation(); open(c.jql); }}
              className="font-medium text-foreground hover:text-primary hover:underline"
            >
              {p[c.key]}
            </button>
          ) : (
            <span className="text-muted-foreground/30">—</span>
          )}
        </td>
      ))}
      <td className="px-3 py-2 text-right tabular-nums font-bold text-foreground">{p.total}</td>
      <td className="px-3 py-2 text-right tabular-nums text-foreground">{p.open}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {badge
          ? <span className={badge}>{contrib.toFixed(1)}%</span>
          : <span className="text-foreground">{contrib.toFixed(1)}%</span>
        }
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Filter controls
// ---------------------------------------------------------------------------

function SearchableMultiSelect({
  label, options, selected, onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (vals: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const active = selected.length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={`inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors ${
          active
            ? "border-primary/40 bg-primary/5 text-primary dark:bg-primary/10"
            : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}>
          {label}
          {active && (
            <span className="rounded-full bg-primary px-1 py-px text-[9px] font-bold leading-none text-primary-foreground">
              {selected.length}
            </span>
          )}
          <RiArrowDownSLine size={12} className="opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <div className="border-b border-border p-2">
          <div className="relative">
            <RiSearchLine size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="h-7 w-full rounded border border-input bg-background pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="px-3 py-3 text-center text-xs text-muted-foreground">No matches</p>
        ) : (
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.map((opt) => (
              <div
                key={opt.value}
                onClick={() => toggle(opt.value)}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
              >
                <span className={`flex size-3.5 shrink-0 items-center justify-center rounded border ${
                  selected.includes(opt.value)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input"
                }`}>
                  {selected.includes(opt.value) && (
                    <svg viewBox="0 0 10 10" className="size-2.5" fill="none">
                      <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="truncate text-foreground">{opt.label}</span>
              </div>
            ))}
          </div>
        )}
        {active && (
          <div className="border-t border-border px-3 py-1.5">
            <button onClick={() => onChange([])} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SortControl({
  sortBy, sortDir, onChange,
}: {
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  onChange: (by: SortKey, dir: "asc" | "desc") => void;
}) {
  const current = SORT_OPTS.find((o) => o.value === sortBy) ?? SORT_OPTS[0];
  return (
    <div className="flex items-center gap-0.5">
      <Popover>
        <PopoverTrigger asChild>
          <button className="inline-flex h-7 items-center gap-1 rounded-l-md border border-input bg-background px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            Sort: {current.label}
            <RiArrowDownSLine size={12} className="opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-36 p-0">
          <div className="py-1">
            {SORT_OPTS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onChange(opt.value, sortDir)}
                className={`flex w-full items-center px-3 py-1.5 text-xs hover:bg-muted ${
                  sortBy === opt.value ? "font-semibold text-foreground" : "text-muted-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <button
        onClick={() => onChange(sortBy, sortDir === "asc" ? "desc" : "asc")}
        className="inline-flex h-7 items-center rounded-r-md border border-l-0 border-input bg-background px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        title={sortDir === "asc" ? "Ascending" : "Descending"}
      >
        {sortDir === "asc" ? <RiArrowUpSLine size={13} /> : <RiArrowDownSLine size={13} />}
      </button>
    </div>
  );
}

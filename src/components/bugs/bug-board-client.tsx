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
  RiUserUnfollowLine,
  RiDownload2Line,
} from "@remixicon/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangeBar } from "@/components/bug-summary/date-range-bar";
import { currentFiscalQuarterChip } from "@/lib/date-utils";
import type { BugBoardResponse, BugProject } from "@/app/api/bugs/route";
import {
  buildOwnerRows,
  computeTeamStats,
  deriveOwnerOptions,
  deriveEnvironments,
  effectiveCounts,
  rag,
  RAG_BADGE,
  PRIORITIES,
  type OwnerRow,
  type ProjectBreakdown,
  type Counts,
  type TeamStats,
  type PriorityKey,
} from "@/lib/bugs/aggregate";
import { ENV_UNSET, type BugRow } from "@/lib/bug-summary";
import { BugModal } from "./bug-modal";
import { BugIssueList } from "./bug-issue-list";

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------

type SortKey = "name" | "total" | "p1" | "p2" | "p3" | "p4" | "open";
type PriorityCol = { key: PriorityKey; label: string; jql: string };

// "open" is appended conditionally (see SORT_OPTS_BASE usage below) — only
// when feature_flags.showBugBoardOpenColumn is on, matching the column
// itself being feature-flagged out of the table.
const SORT_OPTS_BASE: { value: SortKey; label: string }[] = [
  { value: "total", label: "Total" },
  { value: "name",  label: "Name"  },
  { value: "p1",    label: "P1"    },
  { value: "p2",    label: "P2"    },
  { value: "p3",    label: "P3"    },
  { value: "p4",    label: "P4"    },
];

// Tie-break cascade for any column-wise sort, in this fixed priority order
// (each descending) — whichever key is the primary sort itself is skipped
// (comparing it to itself can never break a tie), then Name (ascending) is
// the always-unique final tiebreaker.
const TIE_BREAK_ORDER: SortKey[] = ["total", "p1", "p2", "p3", "p4", "open"];

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

export function BugBoardClient({ showOpenColumn }: { showOpenColumn: boolean }) {
  type FetchResult =
    | { ok: true;  data: BugBoardResponse; cacheKey: string }
    | { ok: false; error: string;          cacheKey: string };

  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null);
  const [selProjects,   setSelProjects]   = useState<string[]>([]);
  const [selOwners,     setSelOwners]     = useState<string[]>([]);
  const [nameQuery,     setNameQuery]     = useState("");
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
  // Which row's breakdown modal is open (null = none) — one modal, two tabs
  // (Project Breakdown, Source Breakdown), replacing what used to be two
  // separate modals behind two separate row icons.
  const [breakdownRow, setBreakdownRow] = useState<OwnerRow | null>(null);
  const [breakdownTab, setBreakdownTab] = useState<"project" | "source">("project");
  const [missingOwnerOpen, setMissingOwnerOpen] = useState(false);

  const openBreakdown = (row: OwnerRow, tab: "project" | "source" = "project") => {
    setBreakdownRow(row);
    setBreakdownTab(tab);
  };

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
      // A project only ever enters row.projects because at least one real
      // cell existed for it — but the Priority/Customer-found filter above
      // is applied per project too, and can zero one out on its own (e.g.
      // every bug this person has on that project was a priority that's now
      // deselected). Filtering to total>0 here, not just at the person
      // level, is what keeps a 0-bug project out of their own breakdown
      // modal instead of showing as a dead "0 / 0 / 0.0%" row.
      projects: row.projects
        .map((p) => ({ ...p, ...applyFilters(p) }))
        .filter((p) => p.total > 0),
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

  // Stable rank by Total bugs (descending), computed from the full
  // Priority/Env/Project-filtered set — before the Developer filter/search
  // narrows what's actually shown, so applying a Developer filter never
  // changes anyone's # value. Excludes the synthetic "Missing Issue Owner"
  // bucket (not a person to rank) and anyone left with 0 bugs after the
  // filters (a hidden zero-bug row should never eat a rank number a visible
  // person would otherwise have gotten).
  const rankByKey = useMemo(() => {
    const ranked = effectiveRows
      .filter((r) => !r.isUnassigned && r.total > 0)
      .sort((a, b) => b.total - a.total);
    return new Map(ranked.map((r, i) => [r.key, i + 1]));
  }, [effectiveRows]);

  const displayRows = useMemo(() => {
    const ownerSet  = new Set(selOwners);
    const filterOn  = ownerSet.size > 0;
    const q = nameQuery.trim().toLowerCase();
    const rows = effectiveRows.filter((r) => {
      // A 0-bug row (e.g. someone whose only bugs were a priority that's
      // now deselected) has nothing left to show and would otherwise eat a
      // rank number no visible row actually has.
      if (r.total === 0) return false;
      if (r.isUnassigned ? filterOn : filterOn && !ownerSet.has(r.key)) return false;
      if (q && !(r.name.toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;

      const primary = (() => {
        if (sortBy === "name") return dir * a.name.localeCompare(b.name);
        const av = a[sortBy] as number;
        const bv = b[sortBy] as number;
        // A "—" (0) in the sorted column has nothing to rank by — it sinks
        // to the bottom regardless of asc/desc, same as the Missing Issue
        // Owner row above. Direction only decides order between two real
        // values.
        if (!av !== !bv) return av ? -1 : 1;
        return dir * (av - bv);
      })();
      if (primary !== 0) return primary;

      // Deterministic tie-break so equal rows land in the same order on
      // every render, not whatever order they happened to already be in —
      // see TIE_BREAK_ORDER above.
      for (const key of TIE_BREAK_ORDER) {
        if (key === sortBy) continue;
        const diff = (b[key] as number) - (a[key] as number);
        if (diff !== 0) return diff;
      }
      return a.name.localeCompare(b.name);
    });
    return rows;
  }, [effectiveRows, selOwners, nameQuery, sortBy, sortDir]);

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

  const missingOwnerCount = useMemo(
    () => displayRows.find((r) => r.isUnassigned)?.total ?? 0,
    [displayRows],
  );

  const togglePriority = (key: PriorityKey) =>
    setSelPriorities((prev) =>
      prev.includes(key)
        ? prev.length > 1 ? prev.filter((k) => k !== key) : prev
        : [...prev, key],
    );

  // Clicking the column already being sorted flips direction; clicking a
  // different one switches to it, defaulting to descending — same behavior
  // as the Performance Review leaderboard's own column-header sort.
  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  // Resolved date range for Jira deep-links + My Bugs links — the active bounds.
  const resolvedFrom = start || undefined;
  const resolvedTo = end || undefined;

  // # + Developer + visible-priority cols + Total + (Open, if flagged on) + % Share
  const colSpan = 2 + visiblePriorityCols.length + 2 + (showOpenColumn ? 1 : 0);

  const [exporting, setExporting] = useState(false);

  // Org-wide bug list (every project, not just what's currently on screen) →
  // /api/bugs/export with scope "developer", which is the rollup sheet PLUS
  // a per-developer section listing every one of their bugs — not just
  // counts. Same route + workbook styling the per-project/My Bugs/team
  // BugTracker "Download in Excel" buttons already use.
  async function handleExportExcel() {
    if (exporting || !start || !end) return;
    setExporting(true);
    try {
      // Every filter currently applied on screen — Priority, Raised (date
      // range, already start/end), Env, Projects, Developers, Customer-found
      // only — so the export is exactly what's filtered, not everything in
      // the date range. /api/bugs/list applies these server-side, against
      // the same owner/environment/customer-found resolution the table
      // itself uses.
      const params = new URLSearchParams({ start, end });
      params.set("priorities", selPriorities.map((p) => p.toUpperCase()).join(","));
      if (selEnv) params.set("env", selEnv);
      if (selProjects.length) params.set("projectIds", selProjects.join(","));
      if (selOwners.length) params.set("ownerKeys", selOwners.join(","));
      if (cfOnly) params.set("cfOnly", "true");

      const listRes = await fetch(`/api/bugs/list?${params}`);
      if (!listRes.ok) throw new Error("Failed to load bugs");
      const { bugs } = (await listRes.json()) as { bugs: BugRow[] };

      const exportRes = await fetch("/api/bugs/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: bugs,
          title: "Bug Board",
          showProject: true,
          scope: "developer",
          start,
          end,
          environment: selEnv,
          // Same feature_flags.showBugBoardOpenColumn gate as the on-screen
          // table — one flag, both surfaces, never independently out of sync.
          showOpen: showOpenColumn,
        }),
      });
      if (!exportRes.ok) throw new Error("Export failed");
      const blob = await exportRes.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bug_Board-developer-bugs-${end}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[handleExportExcel] error:", err);
    } finally {
      setExporting(false);
    }
  }

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
              {missingOwnerCount > 0 && (
                <button
                  onClick={() => setMissingOwnerOpen(true)}
                  className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-px text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50"
                  title="View the individual issues with no owner"
                >
                  <RiUserUnfollowLine size={11} />
                  <span className="font-semibold tabular-nums">{missingOwnerCount}</span>
                  <span>missing owner</span>
                </button>
              )}
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
        <button
          type="button"
          onClick={handleExportExcel}
          disabled={exporting}
          className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          <RiDownload2Line className="size-3.5" />
          {exporting ? "Exporting…" : "Export to Excel"}
        </button>
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
          labelClassName="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70"
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

        <div className="relative">
          <RiSearchLine
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="Search developer…"
            className="h-6 w-44 rounded border border-input bg-background pl-7 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>

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
            showOpenColumn={showOpenColumn}
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
        <div className="max-h-screen overflow-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0">
              {/* rounded-t-xl matches the wrapper's own rounded-xl — without it
                  this colored row's square corners poke past the wrapper's
                  rounded ones, showing as a stray notch (mirrors the fix
                  below on tfoot's rounded-b-xl). dark:bg-zinc-800, not -900:
                  the wrapper itself is dark:bg-zinc-900, so bg-zinc-900 here
                  was invisible — same shade as the header sat on. Matches the
                  Performance Review leaderboard's header treatment. */}
              {/* text-xs (not text-[11px]) + text-zinc-500 (not
                  text-muted-foreground, a lighter token) + py-2.5 (not
                  py-3) — matches the Performance Review leaderboard's
                  header exactly; those three were the only real
                  differences left once the bg/rounding already matched. */}
              <tr className="rounded-t-xl border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800">
                <th className="w-10 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  #
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Developer
                </th>
                {visiblePriorityCols.map((c) => (
                  <SortableTh
                    key={c.key}
                    label={c.label}
                    sortKey={c.key}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500"
                  />
                ))}
                <SortableTh
                  label="Total"
                  sortKey="total"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500"
                />
                {showOpenColumn && (
                  <SortableTh
                    label="Open"
                    sortKey="open"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500"
                  />
                )}
                {/* % Share has no SortKey of its own — it's directly
                    proportional to Total, so sorting by it would just
                    reproduce Total's own order. Wired to "total" rather
                    than inventing a redundant key. */}
                <SortableTh
                  label="% Share"
                  sortKey="total"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500"
                />
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
                displayRows.map((row, idx) => (
                  <OwnerRowView
                    key={row.key}
                    row={row}
                    // Sorted by Total: the stable, Developer-filter-proof
                    // rank (see rankByKey above). Sorted by anything else:
                    // just this row's position in the list as currently
                    // sorted — "who's #1 in P2" only means something
                    // relative to a P2 sort, not the Total-based standing.
                    // Unassigned is always last and never ranked either way.
                    rank={
                      row.isUnassigned
                        ? null
                        : sortBy === "total"
                          ? rankByKey.get(row.key) ?? null
                          : idx + 1
                    }
                    team={teamStats}
                    onOpenBreakdown={() => openBreakdown(row)}
                    visiblePriorityCols={visiblePriorityCols}
                    dateFrom={resolvedFrom}
                    dateTo={resolvedTo}
                    env={selEnv}
                    projectKeys={selProjectKeys}
                    showOpenColumn={showOpenColumn}
                  />
                ))
              )}
            </tbody>
            {displayRows.length > 0 && (
              <tfoot>
                {/* rounded-b-xl for the same reason as thead's rounded-t-xl
                    above — this row's own bg would otherwise square off
                    against the wrapper's rounded-xl bottom corners. */}
                <tr className="rounded-b-xl border-t-2 border-zinc-300 bg-zinc-50/90 dark:border-zinc-700 dark:bg-zinc-900/60">
                  <td className="px-4 py-2.5" />
                  <td className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-foreground">
                    <button
                      type="button"
                      onClick={() => openBreakdown(totalOwnerRow)}
                      className="hover:underline"
                      title="Everyone's breakdown"
                    >
                      Total
                    </button>
                  </td>
                  {visiblePriorityCols.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-foreground">
                      {grandTotal[c.key] || <span className="font-normal text-muted-foreground/40">—</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right text-xs font-extrabold tabular-nums text-foreground">
                    {grandTotal.total}
                  </td>
                  {showOpenColumn && (
                    <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-foreground">
                      {grandTotal.open}
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-foreground">
                    100%
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* One modal, two tabs — Project Breakdown first, Source Breakdown
          second (that order, not alphabetical/whatever) — replacing what
          used to be two separate modals behind two separate row icons. */}
      <BugModal
        open={breakdownRow != null}
        onOpenChange={(open) => !open && setBreakdownRow(null)}
        title={breakdownRow ? `Breakdown — ${breakdownRow.name}` : "Breakdown"}
      >
        {breakdownRow && (
          <Tabs value={breakdownTab} onValueChange={(v) => setBreakdownTab(v as "project" | "source")}>
            <TabsList>
              <TabsTrigger value="project">Project Breakdown</TabsTrigger>
              <TabsTrigger value="source">Source Breakdown</TabsTrigger>
            </TabsList>
            <TabsContent value="project" className="mt-3">
              <ProjectSplit
                row={breakdownRow}
                visiblePriorityCols={visiblePriorityCols}
                dateFrom={resolvedFrom}
                dateTo={resolvedTo}
                showOpenColumn={showOpenColumn}
              />
            </TabsContent>
            <TabsContent value="source" className="mt-3">
              <FoundBreakdown counts={breakdownRow} prioritySet={prioritySet} />
            </TabsContent>
          </Tabs>
        )}
      </BugModal>

      <BugModal
        open={missingOwnerOpen}
        onOpenChange={setMissingOwnerOpen}
        title="Bugs with no issue owner"
      >
        <BugIssueList unassignedOnly from={resolvedFrom} to={resolvedTo} />
      </BugModal>
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
  rank,
  team,
  onOpenBreakdown,
  visiblePriorityCols,
  dateFrom,
  dateTo,
  env,
  projectKeys,
  showOpenColumn,
}: {
  row: OwnerRow;
  /** Stable rank by Total, from the full Priority/Env/Project-filtered set — null for the Missing Issue Owner row. */
  rank: number | null;
  team: TeamStats;
  onOpenBreakdown: () => void;
  visiblePriorityCols: PriorityCol[];
  dateFrom?: string;
  dateTo?: string;
  env?: string | null;
  projectKeys?: string[];
  showOpenColumn: boolean;
}) {
  const contrib = team.grandTotal > 0 ? (row.total / team.grandTotal) * 100 : 0;
  const neutral = row.isUnassigned;

  return (
    <tr className="border-b border-zinc-100 transition-colors hover:bg-zinc-50/60 dark:border-zinc-800/60 dark:hover:bg-zinc-800/20">
      <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
        {rank ?? "—"}
      </td>
      <td className="px-3 py-3">
        <span className="group inline-flex items-center gap-1.5">
          {/* Name is the link into the breakdown modal now — same pattern as
              the Performance Review leaderboard's Developer column — instead
              of two separate icon buttons off in a View column. */}
          <button
            type="button"
            onClick={onOpenBreakdown}
            className={`text-sm font-medium hover:underline ${neutral ? "italic text-muted-foreground" : "text-foreground"}`}
          >
            {row.name}
          </button>
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
      {showOpenColumn && <CountCell value={row.open} avg={team.avg.open} neutral={neutral} />}
      <ContribCell pct={contrib} value={row.total} avg={team.avg.total} neutral={neutral} />
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Sortable header cell — same ↕/↓/↑ indicator as the Performance Review
// leaderboard's own column headers, wired to the same sortBy/sortDir state
// the "Sort:" dropdown already uses (clicking a header is just another way
// to set it, not a second competing mechanism).
// ---------------------------------------------------------------------------

function SortableTh({
  label, sortKey, sortBy, sortDir, onSort, className,
}: {
  label: string;
  sortKey: SortKey;
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  className: string;
}) {
  const active = sortBy === sortKey;
  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 uppercase hover:text-foreground"
      >
        {label}
        <span className={active ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-300 dark:text-zinc-600"}>
          {active ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
        </span>
      </button>
    </th>
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
  row, visiblePriorityCols, dateFrom, dateTo, showOpenColumn,
}: {
  row: OwnerRow;
  visiblePriorityCols: PriorityCol[];
  dateFrom?: string;
  dateTo?: string;
  showOpenColumn: boolean;
}) {
  const projAvgTotal = row.projects.length > 0 ? row.total / row.projects.length : 0;
  // "__total__" is the synthetic grand-total row (everyone, not one person) —
  // only a real developer or the real unassigned bucket should scope the
  // per-project issue list down to their own bugs.
  const ownerKey = row.key !== "__total__" && !row.isUnassigned ? row.key : undefined;

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Click a row or priority to browse those issues
      </p>
      {/* table-fixed + explicit widths on every numeric column (which never
          wrap and never need more than a few chars) means Project is the
          only column without a set width — it gets whatever's left and
          truncates instead of ever forcing the table wider than the modal. */}
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-100/60 text-left dark:bg-zinc-800/50">
              <th className="px-3 py-2 font-semibold uppercase tracking-wide text-zinc-500">Project</th>
              {visiblePriorityCols.map((c) => (
                <th key={c.key} className="w-12 whitespace-nowrap px-2 py-2 text-right font-semibold uppercase tracking-wide text-zinc-500">{c.label}</th>
              ))}
              <th className="w-14 whitespace-nowrap px-2 py-2 text-right font-semibold uppercase tracking-wide text-zinc-500">Total</th>
              {showOpenColumn && (
                <th className="w-14 whitespace-nowrap px-2 py-2 text-right font-semibold uppercase tracking-wide text-zinc-500">Open</th>
              )}
              {/* w-20, not w-16 — at w-16 (64px) the "% Share" label itself
                  (tracking-wide uppercase, ~66px) overflowed its own column
                  and got clipped by the wrapper's overflow-hidden, reading as
                  the header text getting eaten/buried at the right edge.
                  pr-3 mirrors Project's pl-3 — the same inset on both ends of
                  the table, rather than % Share sitting tight against the
                  edge. Comes out of Project's own width (it has none set),
                  so a long project name simply truncates a few chars sooner
                  instead of the table ever needing to widen. */}
              <th className="w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right font-semibold uppercase tracking-wide text-zinc-500">% Share</th>
            </tr>
          </thead>
          <tbody>
            {row.projects.map((p) => (
              <ProjectRowView
                key={p.projectId}
                p={p}
                ownerTotal={row.total}
                projAvgTotal={projAvgTotal}
                visiblePriorityCols={visiblePriorityCols}
                dateFrom={dateFrom}
                dateTo={dateTo}
                ownerKey={ownerKey}
                unassignedOnly={row.isUnassigned}
                showOpenColumn={showOpenColumn}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectRowView({
  p, ownerTotal, projAvgTotal, visiblePriorityCols, dateFrom, dateTo, ownerKey, unassignedOnly, showOpenColumn,
}: {
  p: ProjectBreakdown;
  ownerTotal: number;
  projAvgTotal: number;
  visiblePriorityCols: PriorityCol[];
  dateFrom?: string;
  dateTo?: string;
  /** Scopes the issue-list modal to one developer's bugs — undefined for the grand-total row. */
  ownerKey?: string;
  /** True only for the real "no issue owner" bucket — never for the grand-total row. */
  unassignedOnly?: boolean;
  showOpenColumn: boolean;
}) {
  const contrib = ownerTotal > 0 ? (p.total / ownerTotal) * 100 : 0;
  const state   = rag(p.total, projAvgTotal);
  const badge   = RAG_BADGE[state];
  // Reads directly from our own jira_issues (via /api/bugs/issues) instead of
  // firing a generated JQL search — see BugIssueList's own comment for why
  // that JQL was unreliable (it compared a custom field to a raw accountId,
  // which Jira's JQL engine generally can't resolve for non-system fields).
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const openIssues = (priority?: string) => {
    setPriorityFilter(priority ?? null);
    setModalOpen(true);
  };

  return (
    <>
      <tr
        className="cursor-pointer border-t border-zinc-100 transition-colors hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/30"
        onClick={() => openIssues()}
      >
        <td className="min-w-0 px-3 py-2">
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
            <span className="truncate" title={p.projectName}>{p.projectName}</span>
            <RiExternalLinkLine size={10} className="shrink-0 opacity-40" />
          </span>
        </td>
        {visiblePriorityCols.map((c) => (
          <td key={c.key} className="px-2 py-2 text-right tabular-nums">
            {p[c.key] ? (
              <button
                onClick={(e) => { e.stopPropagation(); openIssues(c.jql); }}
                className="font-medium text-foreground hover:text-primary hover:underline"
              >
                {p[c.key]}
              </button>
            ) : (
              <span className="text-muted-foreground/30">—</span>
            )}
          </td>
        ))}
        <td className="px-2 py-2 text-right tabular-nums font-bold text-foreground">{p.total}</td>
        {showOpenColumn && (
          <td className="px-2 py-2 text-right tabular-nums text-foreground">{p.open}</td>
        )}
        <td className="py-2 pl-2 pr-3 text-right tabular-nums">
          {badge
            ? <span className={badge}>{contrib.toFixed(1)}%</span>
            : <span className="text-foreground">{contrib.toFixed(1)}%</span>
          }
        </td>
      </tr>

      <BugModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={`${p.projectName}${priorityFilter ? ` — ${priorityFilter}` : ""}`}
      >
        <BugIssueList
          projectId={p.projectId}
          priority={priorityFilter ?? undefined}
          from={dateFrom}
          to={dateTo}
          ownerKey={ownerKey}
          unassignedOnly={unassignedOnly}
        />
      </BugModal>
    </>
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
  sortBy, sortDir, onChange, showOpenColumn,
}: {
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  onChange: (by: SortKey, dir: "asc" | "desc") => void;
  showOpenColumn: boolean;
}) {
  const sortOpts = showOpenColumn
    ? [...SORT_OPTS_BASE, { value: "open" as const, label: "Open" }]
    : SORT_OPTS_BASE;
  const current = sortOpts.find((o) => o.value === sortBy) ?? sortOpts[0];
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
            {sortOpts.map((opt) => (
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

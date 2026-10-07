"use client";

import { useMemo, useState } from "react";
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiSearchLine,
  RiSearchEyeLine,
} from "@remixicon/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  rag,
  RAG_BADGE,
  type Counts,
  type PriorityKey,
  type SortKey,
} from "@/lib/bugs/aggregate";

// Building blocks shared by the By Developer and By Project Bug Board views.

export type PriorityCol = { key: PriorityKey; label: string; jql: string };

// "open" is appended conditionally (see SORT_OPTS_BASE usage below) — only
// when feature_flags.showBugBoardOpenColumn is on, matching the column
// itself being feature-flagged out of the table.
export const SORT_OPTS_BASE: { value: SortKey; label: string }[] = [
  { value: "total", label: "Total" },
  { value: "name",  label: "Name"  },
  { value: "p1",    label: "P1"    },
  { value: "p2",    label: "P2"    },
  { value: "p3",    label: "P3"    },
  { value: "p4",    label: "P4"    },
];

export const ALL_PRIORITY_COLS: PriorityCol[] = [
  { key: "p1", label: "P1", jql: "P1" },
  { key: "p2", label: "P2", jql: "P2" },
  { key: "p3", label: "P3", jql: "P3" },
  { key: "p4", label: "P4", jql: "P4" },
];

// ---------------------------------------------------------------------------
// Stat chip
// ---------------------------------------------------------------------------

export function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-px dark:border-zinc-800 dark:bg-zinc-900">
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}


// ---------------------------------------------------------------------------
// Sortable header cell — same ↕/↓/↑ indicator as the Performance Review
// leaderboard's own column headers, wired to the same sortBy/sortDir state
// the "Sort:" dropdown already uses (clicking a header is just another way
// to set it, not a second competing mechanism).
// ---------------------------------------------------------------------------

export function SortableTh({
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

export function CountCell({
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

/**
 * Plain count cell for "RCA Unavail" — not RAG-classified against the team
 * average like CountCell (missing RCA isn't a "more bugs than usual" kind of
 * signal), just amber when nonzero so it reads as "needs attention" without
 * implying a red/green judgment relative to peers.
 */
export function RcaMissingCell({ value }: { value: number }) {
  return (
    <td className="px-3 py-3 text-right tabular-nums text-sm">
      {value ? (
        <span className="font-medium text-amber-700 dark:text-amber-400">{value}</span>
      ) : (
        <span className="text-muted-foreground/30">—</span>
      )}
    </td>
  );
}

/** Counts key holding the open-bug count for each priority column. */
const OPEN_KEY = { p1: "open1", p2: "open2", p3: "open3", p4: "open4" } as const;

/** "P1 Open" … headers — one per visible priority, placed right after the all-priority Open column. */
export function OpenByPriorityHeaders({
  cols, className, sortBy, sortDir, onSort,
}: {
  cols: PriorityCol[];
  className: string;
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  return (
    <>
      {cols.map((c) => (
        <SortableTh
          key={c.key}
          label={`${c.label} Open`}
          sortKey={OPEN_KEY[c.key]}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
          className={className}
        />
      ))}
    </>
  );
}

/** Per-priority open counts for one row, RAG-coloured against the average row like the Open column. */
export function OpenByPriorityCells({
  row, avg, cols, neutral,
}: {
  row: Counts;
  avg: Counts;
  cols: PriorityCol[];
  neutral?: boolean;
}) {
  return (
    <>
      {cols.map((c) => (
        <CountCell key={c.key} value={row[OPEN_KEY[c.key]]} avg={avg[OPEN_KEY[c.key]]} neutral={neutral} />
      ))}
    </>
  );
}

/** Footer totals for the per-priority open columns. */
export function OpenByPriorityTotals({ total, cols }: { total: Counts; cols: PriorityCol[] }) {
  return (
    <>
      {cols.map((c) => (
        <td key={c.key} className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-foreground">
          {total[OPEN_KEY[c.key]] || <span className="font-normal text-muted-foreground/40">—</span>}
        </td>
      ))}
    </>
  );
}

export function ContribCell({
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

export function FoundBreakdown({ counts, prioritySet }: { counts: Counts; prioritySet: Set<PriorityKey> }) {
  const rows = [
    { label: "P1", key: "p1" as PriorityKey, total: counts.p1, cf: counts.cf1, rcaMissing: counts.rcaMissing1 },
    { label: "P2", key: "p2" as PriorityKey, total: counts.p2, cf: counts.cf2, rcaMissing: counts.rcaMissing2 },
    { label: "P3", key: "p3" as PriorityKey, total: counts.p3, cf: counts.cf3, rcaMissing: counts.rcaMissing3 },
    { label: "P4", key: "p4" as PriorityKey, total: counts.p4, cf: counts.cf4, rcaMissing: counts.rcaMissing4 },
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
        <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
          <RiSearchEyeLine size={12} />RCA missing
        </span>
        {rows.map((r) => (
          <span key={r.label} className="text-right tabular-nums font-medium">
            {r.rcaMissing || <span className="text-muted-foreground/30">—</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter controls
// ---------------------------------------------------------------------------

export function SearchableMultiSelect({
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

export function SortControl({
  sortBy, sortDir, onChange, showOpenColumn,
}: {
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  onChange: (by: SortKey, dir: "asc" | "desc") => void;
  showOpenColumn: boolean;
}) {
  const sortOpts: { value: SortKey; label: string }[] = showOpenColumn
    ? [
        ...SORT_OPTS_BASE,
        { value: "open", label: "Open" },
        { value: "open1", label: "P1 Open" },
        { value: "open2", label: "P2 Open" },
        { value: "open3", label: "P3 Open" },
        { value: "open4", label: "P4 Open" },
      ]
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

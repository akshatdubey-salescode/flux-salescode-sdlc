"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  RiSearchLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiCloseLine,
  RiSparklingLine,
} from "@remixicon/react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RequirementRow = {
  id: string;
  title: string;
  githubRepoName: string;
  priority: string;
  status: string;
  createdAt: Date;
};

const PRIORITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["draft", "published"];

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const STATUS_STYLES: Record<string, string> = {
  published: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  draft: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

function formatRelative(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const hasSelection = selected.length > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
            hasSelection
              ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/20 dark:text-blue-400"
              : "border-border bg-background text-foreground hover:bg-muted"
          )}
        >
          {label}
          {hasSelection && (
            <span className="rounded-full bg-blue-500 px-1.5 py-px text-[10px] font-semibold text-white leading-none">
              {selected.length}
            </span>
          )}
          <RiArrowDownSLine className="size-3.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-0">
        <div className="max-h-52 overflow-y-auto py-1">
          {options.map((opt) => (
            <label
              key={opt}
              className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() =>
                  onChange(
                    selected.includes(opt)
                      ? selected.filter((v) => v !== opt)
                      : [...selected, opt]
                  )
                }
                className="size-3 rounded accent-blue-500"
              />
              <span className="capitalize text-zinc-700 dark:text-zinc-300">{opt}</span>
            </label>
          ))}
        </div>
        {hasSelection && (
          <div className="border-t border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
            <button
              onClick={() => onChange([])}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RequirementsList({ rows, total }: { rows: RequirementRow[]; total: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localSearch, setLocalSearch] = useState(searchParams.get("q") ?? "");

  const selectedStatus = searchParams.get("status")?.split(",").filter(Boolean) ?? [];
  const selectedPriority = searchParams.get("priority")?.split(",").filter(Boolean) ?? [];
  const sortBy = searchParams.get("sortBy") ?? "created";
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc";

  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function handleSearch(value: string) {
    setLocalSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ q: value || null });
    }, 300);
  }

  function toggleSort(col: string) {
    if (sortBy === col) {
      updateParams({ sortDir: sortDir === "asc" ? "desc" : "asc" });
    } else {
      updateParams({ sortBy: col, sortDir: "desc" });
    }
  }

  const activeFilters = [
    ...(selectedStatus.length ? [`Status: ${selectedStatus.join(", ")}`] : []),
    ...(selectedPriority.length ? [`Priority: ${selectedPriority.join(", ")}`] : []),
  ];
  const hasActiveFilters = activeFilters.length > 0 || !!localSearch;

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <RiSearchLine className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-400 pointer-events-none" />
            <Input
              value={localSearch}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search requirements…"
              className="pl-7 h-7 text-xs"
            />
          </div>

          <MultiSelect
            label="Status"
            options={STATUSES}
            selected={selectedStatus}
            onChange={(vals) => updateParams({ status: vals.join(",") || null })}
          />
          <MultiSelect
            label="Priority"
            options={PRIORITIES}
            selected={selectedPriority}
            onChange={(vals) => updateParams({ priority: vals.join(",") || null })}
          />

          {/* Sort */}
          <div className="flex items-center gap-0.5">
            <Popover>
              <PopoverTrigger asChild>
                <button className="inline-flex h-7 items-center gap-1 rounded-l-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted">
                  Sort: {sortBy === "created" ? "Created" : sortBy === "title" ? "Title" : "Priority"}
                  <RiArrowDownSLine className="size-3.5 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-36 p-0">
                <div className="py-1">
                  {(["created", "title", "priority"] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => updateParams({ sortBy: opt, sortDir: "desc" })}
                      className={cn(
                        "flex w-full items-center px-3 py-1.5 text-xs capitalize hover:bg-zinc-100 dark:hover:bg-zinc-800",
                        sortBy === opt
                          ? "font-semibold text-zinc-900 dark:text-zinc-100"
                          : "text-zinc-600 dark:text-zinc-400"
                      )}
                    >
                      {opt === "created" ? "Created" : opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <button
              onClick={() => updateParams({ sortDir: sortDir === "asc" ? "desc" : "asc" })}
              className="inline-flex h-7 items-center rounded-r-md border border-l-0 border-border bg-background px-2 text-muted-foreground hover:bg-muted"
            >
              {sortDir === "asc" ? (
                <RiArrowUpSLine className="size-3.5" />
              ) : (
                <RiArrowDownSLine className="size-3.5" />
              )}
            </button>
          </div>

          {hasActiveFilters && (
            <button
              onClick={() => {
                setLocalSearch("");
                updateParams({ q: null, status: null, priority: null });
              }}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline underline-offset-2"
            >
              Clear all
            </button>
          )}

          <span className="ml-auto text-xs text-zinc-400">
            {total} {total === 1 ? "requirement" : "requirements"}
          </span>
        </div>

        {/* Active filter chips */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedStatus.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
              >
                Status: <span className="capitalize">{s}</span>
                <button
                  onClick={() =>
                    updateParams({
                      status: selectedStatus.filter((v) => v !== s).join(",") || null,
                    })
                  }
                  className="text-zinc-400 hover:text-zinc-600"
                >
                  <RiCloseLine className="size-3" />
                </button>
              </span>
            ))}
            {selectedPriority.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
              >
                Priority: <span className="capitalize">{p}</span>
                <button
                  onClick={() =>
                    updateParams({
                      priority: selectedPriority.filter((v) => v !== p).join(",") || null,
                    })
                  }
                  className="text-zinc-400 hover:text-zinc-600"
                >
                  <RiCloseLine className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
          <div className="flex size-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 mb-4">
            <RiSparklingLine size={20} className="text-zinc-400" />
          </div>
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {hasActiveFilters ? "No requirements match your filters" : "No requirements yet"}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            {hasActiveFilters
              ? "Try adjusting your search or filters."
              : "Use the AI builder to generate your first requirement."}
          </p>
          {!hasActiveFilters && (
            <Link
              href="/requirements/new"
              className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              <RiSparklingLine size={15} />
              Build with AI
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <SortableHeader label="Title" col="title" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="min-w-[240px]" />
                  <SortableHeader label="Repository" col="repo" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="w-48" />
                  <SortableHeader label="Priority" col="priority" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="w-24" />
                  <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider text-zinc-500 w-24">
                    Status
                  </th>
                  <SortableHeader label="Created" col="created" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900/50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/requirements/${r.id}`)}
                  >
                    <td className="px-3 py-3 font-medium text-zinc-900 dark:text-zinc-50 max-w-xs">
                      <span className="line-clamp-1">{r.title}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-zinc-500 dark:text-zinc-400 truncate block max-w-[180px]">
                        {r.githubRepoName.split("/")[1] ?? r.githubRepoName}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize",
                          PRIORITY_STYLES[r.priority] ?? "bg-zinc-100 text-zinc-500"
                        )}
                      >
                        {r.priority}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize",
                          STATUS_STYLES[r.status] ?? "bg-zinc-100 text-zinc-500"
                        )}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-zinc-400 dark:text-zinc-500">
                      {formatRelative(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableHeader({
  label,
  col,
  sortBy,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  col: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
  className?: string;
}) {
  const active = sortBy === col;
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-left font-semibold uppercase tracking-wider text-zinc-500 cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-300",
        className
      )}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          sortDir === "asc" ? (
            <RiArrowUpSLine className="size-3.5" />
          ) : (
            <RiArrowDownSLine className="size-3.5" />
          )
        ) : (
          <span className="size-3.5 opacity-0 group-hover:opacity-30">↕</span>
        )}
      </span>
    </th>
  );
}

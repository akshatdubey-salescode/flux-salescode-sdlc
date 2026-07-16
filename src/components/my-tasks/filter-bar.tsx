"use client";

import { useId, useRef, useState } from "react";
import {
  RiSearchLine,
  RiFilterLine,
  RiCloseLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiInformationLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SORT_OPTIONS } from "../project-tracking/helpers";
import type { MyTasksFilterState, MyTasksFields } from "./helpers";
import { getRelevantQuarters } from "@/lib/date-utils";

type Props = {
  filters: MyTasksFilterState;
  fields: MyTasksFields | null;
  onUpdate: (updates: Partial<Record<string, string | null>>) => void;
  total: number;
};

export function MyTasksFilterBar({ filters, fields, onUpdate, total }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(filters.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeFilterCount = [
    filters.projects.length > 0,
    filters.status.length > 0,
    filters.priority.length > 0,
    filters.reporter.length > 0,
    filters.issueType.length > 0,
    filters.labels.length > 0,
    !!(filters.qstart || filters.dateFrom),
    !!(filters.qend || filters.dateTo),
    filters.includeReported,
    filters.unplannedOnly,
  ].filter(Boolean).length;

  function handleSearch(value: string) {
    setLocalSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUpdate({ q: value || null, page: "1" });
    }, 300);
  }

  function clearAll() {
    setLocalSearch("");
    onUpdate({
      q: null,
      projects: null,
      status: null,
      priority: null,
      reporter: null,
      issueType: null,
      labels: null,
      dateFrom: null,
      dateTo: null,
      qstart: "all",
      qend: "all",
      unplannedOnly: null,
      page: "1",
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-[240px]">
          <RiSearchLine className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-400 pointer-events-none" />
          <Input
            value={localSearch}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search your tasks…"
            className="pl-7"
          />
        </div>

        {fields && (
          <>
            <MultiSelect
              label="Project"
              options={fields.projects.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
              selected={filters.projects}
              onChange={(vals) =>
                onUpdate({ projects: vals.join(",") || null, page: "1" })
              }
              searchable
              searchPlaceholder="Search projects…"
            />
            <MultiSelect
              label="Issue Type"
              options={fields.issueTypes.map((t) => ({ value: t, label: t }))}
              selected={filters.issueType}
              onChange={(vals) =>
                onUpdate({ issueType: vals.join(",") || null, page: "1" })
              }
            />
            <MultiSelect
              label="Priority"
              options={fields.priorities.map((p) => ({ value: p, label: p }))}
              selected={filters.priority}
              onChange={(vals) =>
                onUpdate({ priority: vals.join(",") || null, page: "1" })
              }
            />
          </>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => setMoreOpen(true)}
          className={cn(activeFilterCount > 3 && "border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-400")}
        >
          <RiFilterLine className="size-3.5" />
          More
          {activeFilterCount > 3 && (
            <span className="ml-0.5 rounded-full bg-blue-500 px-1.5 py-px text-[10px] font-semibold text-white leading-none">
              {activeFilterCount - 3}
            </span>
          )}
        </Button>

        <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

        <SortSelector
          sortBy={filters.sortBy}
          sortDir={filters.sortDir}
          onSortByChange={(v) => onUpdate({ sortBy: v, page: "1" })}
          onSortDirToggle={() =>
            onUpdate({
              sortDir: filters.sortDir === "asc" ? "desc" : "asc",
              page: "1",
            })
          }
        />

        <div className="flex items-center gap-2">
          <Checkbox
            id="show-completed"
            checked={filters.showCompleted}
            onCheckedChange={(checked) =>
              onUpdate({ showCompleted: checked ? "true" : null, page: "1" })
            }
          />
          <Label htmlFor="show-completed" className="cursor-pointer text-xs font-normal text-zinc-600 dark:text-zinc-400">
            Show Completed
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="unplanned-only"
            checked={filters.unplannedOnly}
            onCheckedChange={(checked) =>
              onUpdate({ unplannedOnly: checked ? "true" : null, page: "1" })
            }
          />
          <Label htmlFor="unplanned-only" className="cursor-pointer text-xs font-normal text-zinc-600 dark:text-zinc-400">
            Unplanned only
          </Label>
        </div>

        {(activeFilterCount > 0 || filters.q) && (
          <button
            onClick={clearAll}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline underline-offset-2"
          >
            Clear all
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-zinc-400">
            {total} {total === 1 ? "task" : "tasks"}
          </span>
        </div>
      </div>

      {activeFilterCount > 0 && (
        <ActiveChips filters={filters} fields={fields} onUpdate={onUpdate} />
      )}

      <MoreFiltersSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        filters={filters}
        fields={fields}
        onUpdate={onUpdate}
      />
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchable = false,
  searchPlaceholder = "Search…",
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const hasSelection = selected.length > 0;
  const filteredOptions =
    searchable && query.trim()
      ? options.filter((o) =>
          o.label.toLowerCase().includes(query.trim().toLowerCase())
        )
      : options;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
            hasSelection
              ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/20 dark:text-blue-400"
              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
      <PopoverContent align="start" className="w-52 p-0">
        {searchable && options.length > 0 && (
          <div className="relative border-b border-zinc-100 dark:border-zinc-800">
            <RiSearchLine className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent py-2 pl-8 pr-2.5 text-xs text-zinc-700 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-300"
            />
          </div>
        )}
        {options.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-zinc-400">
            No options
          </p>
        ) : filteredOptions.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-zinc-400">
            No matches
          </p>
        ) : (
          <div className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.map((opt) => (
              <div
                key={opt.value}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => toggle(opt.value)}
              >
                <Checkbox
                  checked={selected.includes(opt.value)}
                  onCheckedChange={() => toggle(opt.value)}
                />
                <span className="truncate text-zinc-700 dark:text-zinc-300">
                  {opt.label}
                </span>
              </div>
            ))}
          </div>
        )}
        {selected.length > 0 && (
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

function SortSelector({
  sortBy,
  sortDir,
  onSortByChange,
  onSortDirToggle,
}: {
  sortBy: string;
  sortDir: "asc" | "desc";
  onSortByChange: (v: string) => void;
  onSortDirToggle: () => void;
}) {
  const current = SORT_OPTIONS.find((o) => o.value === sortBy) ?? SORT_OPTIONS[0];

  return (
    <div className="flex items-center gap-0.5">
      <Popover>
        <PopoverTrigger asChild>
          <button className="inline-flex h-7 items-center gap-1 rounded-l-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Sort: {current.label}
            <RiArrowDownSLine className="size-3.5 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-0">
          <div className="py-1">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onSortByChange(opt.value)}
                className={cn(
                  "flex w-full items-center px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  sortBy === opt.value
                    ? "font-semibold text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-600 dark:text-zinc-400"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <button
        onClick={onSortDirToggle}
        className="inline-flex h-7 items-center rounded-r-md border border-l-0 border-zinc-200 bg-white px-2 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        {sortDir === "asc" ? (
          <RiArrowUpSLine className="size-3.5" />
        ) : (
          <RiArrowDownSLine className="size-3.5" />
        )}
      </button>
    </div>
  );
}

function ActiveChips({
  filters,
  fields,
  onUpdate,
}: {
  filters: MyTasksFilterState;
  fields: MyTasksFields | null;
  onUpdate: (updates: Partial<Record<string, string | null>>) => void;
}) {
  const chips: { label: string; onRemove: () => void }[] = [];

  filters.projects.forEach((pid) => {
    const p = fields?.projects.find(pp => pp.id === pid);
    chips.push({
      label: `Project: ${p?.name || pid}`,
      onRemove: () =>
        onUpdate({
          projects: filters.projects.filter((v) => v !== pid).join(",") || null,
          page: "1",
        }),
    });
  });

  filters.status.forEach((s) =>
    chips.push({
      label: `Status: ${s}`,
      onRemove: () =>
        onUpdate({
          status: filters.status.filter((v) => v !== s).join(",") || null,
          page: "1",
        }),
    })
  );
  filters.priority.forEach((p) =>
    chips.push({
      label: `Priority: ${p}`,
      onRemove: () =>
        onUpdate({
          priority: filters.priority.filter((v) => v !== p).join(",") || null,
          page: "1",
        }),
    })
  );
  filters.reporter.forEach((r) =>
    chips.push({
      label: `Reporter: ${r.split("@")[0]}`,
      onRemove: () =>
        onUpdate({
          reporter: filters.reporter.filter((v) => v !== r).join(",") || null,
          page: "1",
        }),
    })
  );
  filters.issueType.forEach((t) =>
    chips.push({
      label: `Type: ${t}`,
      onRemove: () =>
        onUpdate({
          issueType: filters.issueType.filter((v) => v !== t).join(",") || null,
          page: "1",
        }),
    })
  );
  filters.labels.forEach((l) =>
    chips.push({
      label: `Label: ${l}`,
      onRemove: () =>
        onUpdate({
          labels: filters.labels.filter((v) => v !== l).join(",") || null,
          page: "1",
        }),
    })
  );
  if (filters.qstart && filters.qend) {
    const match = getRelevantQuarters().find(
      (q) => q.start === filters.qstart && q.end === filters.qend
    );
    chips.push({
      label: match ? `${match.label} ${match.year}` : `Quarter: ${filters.qstart}`,
      onRemove: () => onUpdate({ qstart: "all", qend: "all", page: "1" }),
    });
  }
  if (filters.dateFrom)
    chips.push({
      label: `From: ${filters.dateFrom}`,
      onRemove: () => onUpdate({ dateFrom: null, page: "1" }),
    });
  if (filters.dateTo)
    chips.push({
      label: `To: ${filters.dateTo}`,
      onRemove: () => onUpdate({ dateTo: null, page: "1" }),
    });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip, i) => (
        <Badge
          key={i}
          variant="outline"
          className="gap-1 rounded-full border-blue-100 bg-blue-50/50 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-blue-400"
        >
          {chip.label}
          <button
            onClick={chip.onRemove}
            className="text-blue-400 hover:text-blue-600 dark:hover:text-blue-300"
          >
            <RiCloseLine className="size-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}

function MoreFiltersSheet({
  open,
  onOpenChange,
  filters,
  fields,
  onUpdate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  filters: MyTasksFilterState;
  fields: MyTasksFields | null;
  onUpdate: (updates: Partial<Record<string, string | null>>) => void;
}) {
  function toggleMulti(key: string, current: string[], value: string) {
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onUpdate({ [key]: next.join(",") || null, page: "1" });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-80">
        <SheetHeader className="border-b border-zinc-100 dark:border-zinc-800">
          <SheetTitle>More Filters</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-5 p-6">
          {/* Quarter */}
          <FilterSection label="Planned Quarter">
            <div className="flex gap-1.5 flex-wrap">
              {getRelevantQuarters().map((c) => {
                const active = filters.qstart === c.start && filters.qend === c.end;
                return (
                  <TooltipProvider key={`${c.label}-${c.year}`}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() =>
                            onUpdate({
                              qstart: active ? "all" : c.start,
                              qend: active ? "all" : c.end,
                              dateFrom: null,
                              dateTo: null,
                              page: "1",
                            })
                          }
                          className={cn(
                            "h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors flex items-center gap-1.5",
                            active
                              ? "bg-primary text-primary-foreground border-primary shadow-sm"
                              : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          )}
                        >
                          <span className="font-semibold">{c.label}</span>
                          <span className="opacity-60 text-[10px]">{c.year}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[10px]">
                        <p className="font-medium">{c.sublabel} {c.year}</p>
                        <p className="text-zinc-400">Jiras planned in this quarter (start–due overlaps it). Undated ones fall back to creation.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
          </FilterSection>

          {/* Date range */}
          <FilterSection label="Created Date">
            <div className="space-y-1.5">
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                  From
                </p>
                <Input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) =>
                    onUpdate({
                      dateFrom: e.target.value || null,
                      qstart: "all",
                      qend: "all",
                      page: "1",
                    })
                  }
                />
              </div>
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                  To
                </p>
                <Input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) =>
                    onUpdate({
                      dateTo: e.target.value || null,
                      qstart: "all",
                      qend: "all",
                      page: "1",
                    })
                  }
                />
              </div>
            </div>
          </FilterSection>

          {/* Include reported */}
          <FilterSection label="Scope">
            <div className="flex items-center gap-2.5">
              <Checkbox
                id="include-reported"
                checked={filters.includeReported}
                onCheckedChange={(checked) =>
                  onUpdate({ includeReported: checked ? "true" : null, page: "1" })
                }
              />
              <Label htmlFor="include-reported" className="cursor-pointer text-xs font-normal text-zinc-700 dark:text-zinc-300">
                Include issues I reported
              </Label>
            </div>
          </FilterSection>

          {/* Status */}
          {fields && fields.statuses.length > 0 && (
            <FilterSection label="Status">
              {Array.from(new Set(fields.statuses.map((s) => s.status))).map(
                (status) => (
                  <CheckRow
                    key={status}
                    label={status}
                    checked={filters.status.includes(status)}
                    onChange={() =>
                      toggleMulti("status", filters.status, status)
                    }
                  />
                )
              )}
            </FilterSection>
          )}

          {/* Reporter */}
          {fields && fields.reporters.length > 0 && (
            <FilterSection label="Reporter">
              {fields.reporters.map((r) => (
                <CheckRow
                  key={r.email}
                  label={r.name}
                  checked={filters.reporter.includes(r.email)}
                  onChange={() =>
                    toggleMulti("reporter", filters.reporter, r.email)
                  }
                />
              ))}
            </FilterSection>
          )}

          {/* Labels */}
          {fields && fields.labels.length > 0 && (
            <FilterSection label="Labels">
              <div className="flex flex-wrap gap-1.5">
                {fields.labels.map((l) => (
                  <button
                    key={l}
                    onClick={() =>
                      toggleMulti("labels", filters.labels, l)
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                      filters.labels.includes(l)
                        ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/20 dark:text-blue-400"
                        : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </FilterSection>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FilterSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </p>
      {children}
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2.5">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="cursor-pointer text-xs font-normal text-zinc-700 dark:text-zinc-300 truncate">
        {label}
      </Label>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import {
  RiSearchLine,
  RiFilterLine,
  RiCloseLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";
import { SORT_OPTIONS } from "../project-tracking/helpers";
import type { MyTasksFilterState, MyTasksFields } from "./helpers";

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
    !!filters.dateFrom,
    !!filters.dateTo,
    filters.hasComments,
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
      hasComments: null,
      page: "1",
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
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
            />
            <MultiSelect
              label="Status"
              options={Array.from(new Set(fields.statuses.map((s) => s.status))).map(
                (status) => ({
                  value: status,
                  label: status,
                })
              )}
              selected={filters.status}
              onChange={(vals) =>
                onUpdate({ status: vals.join(",") || null, page: "1" })
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

        {(activeFilterCount > 0 || filters.q) && (
          <button
            onClick={clearAll}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline underline-offset-2"
          >
            Clear all
          </button>
        )}

        <span className="ml-auto text-xs text-zinc-400">
          {total} {total === 1 ? "task" : "tasks"}
        </span>
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

function MultiSelect({ label, options, selected, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const hasSelection = selected.length > 0;

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
        {options.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-zinc-400">
            No options
          </p>
        ) : (
          <div className="max-h-60 overflow-y-auto py-1">
            {options.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  className="size-3 rounded accent-blue-500"
                />
                <span className="truncate text-zinc-700 dark:text-zinc-300">
                  {opt.label}
                </span>
              </label>
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
  if (filters.hasComments)
    chips.push({
      label: "Has comments",
      onRemove: () => onUpdate({ hasComments: null, page: "1" }),
    });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {chip.label}
          <button
            onClick={chip.onRemove}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <RiCloseLine className="size-3" />
          </button>
        </span>
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

          {/* Issue type */}
          {fields && fields.issueTypes.length > 0 && (
            <FilterSection label="Issue Type">
              {fields.issueTypes.map((t) => (
                <CheckRow
                  key={t}
                  label={t}
                  checked={filters.issueType.includes(t)}
                  onChange={() =>
                    toggleMulti("issueType", filters.issueType, t)
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
                    onUpdate({ dateFrom: e.target.value || null, page: "1" })
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
                    onUpdate({ dateTo: e.target.value || null, page: "1" })
                  }
                />
              </div>
            </div>
          </FilterSection>

          {/* Has comments */}
          <FilterSection label="Other">
            <label className="flex cursor-pointer items-center gap-2.5 text-xs">
              <input
                type="checkbox"
                checked={filters.hasComments}
                onChange={(e) =>
                  onUpdate({
                    hasComments: e.target.checked ? "true" : null,
                    page: "1",
                  })
                }
                className="size-3 rounded accent-blue-500"
              />
              <span className="text-zinc-700 dark:text-zinc-300">
                Has comments
              </span>
            </label>
          </FilterSection>
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
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-3 rounded accent-blue-500"
      />
      <span className="truncate text-zinc-700 dark:text-zinc-300">{label}</span>
    </label>
  );
}

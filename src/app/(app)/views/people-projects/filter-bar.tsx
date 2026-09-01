"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { format, parseISO } from "date-fns";
import type { DateRange as DayPickerRange } from "react-day-picker";
import {
  RiArrowDownSLine,
  RiCalendarLine,
  RiSearchLine,
} from "@remixicon/react";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type QuarterChip = {
  label: string;
  year: number;
  sublabel: string;
  start: string;
  end: string;
};

type Props = {
  quarters: QuarterChip[];
  start: string;
  end: string;
  q: string;
  departments: string[];
  selectedDepartments: string[];
};

export function FilterBar({
  quarters,
  start,
  end,
  q,
  departments,
  selectedDepartments,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [calOpen, setCalOpen] = useState(false);
  const [calRange, setCalRange] = useState<DayPickerRange | undefined>({
    from: parseISO(start),
    to: parseISO(end),
  });
  const [search, setSearch] = useState(q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync the draft calendar selection when the applied range changes
  // (adjust-state-during-render, per react.dev/you-might-not-need-an-effect).
  const [prevRange, setPrevRange] = useState({ start, end });
  if (prevRange.start !== start || prevRange.end !== end) {
    setPrevRange({ start, end });
    setCalRange({ from: parseISO(start), to: parseISO(end) });
  }

  const activeChip = quarters.find((c) => c.start === start && c.end === end);
  const isCustom = !activeChip;

  function navigate(next: {
    start?: string;
    end?: string;
    q?: string;
    departments?: string[];
  }) {
    const params = new URLSearchParams({
      start: next.start ?? start,
      end: next.end ?? end,
    });
    const nextQ = (next.q ?? q).trim();
    if (nextQ) params.set("q", nextQ);
    const nextDepts = next.departments ?? selectedDepartments;
    if (nextDepts.length) params.set("dept", nextDepts.join(","));
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function applyQuarter(c: QuarterChip) {
    navigate({ start: c.start, end: c.end });
  }

  function applyCustom() {
    if (!calRange?.from || !calRange?.to) return;
    setCalOpen(false);
    navigate({
      start: format(calRange.from, "yyyy-MM-dd"),
      end: format(calRange.to, "yyyy-MM-dd"),
    });
  }

  function onSearchChange(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => navigate({ q: value }), 300);
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 flex-wrap",
        isPending && "opacity-60"
      )}
    >
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest hidden sm:inline">
        Quarter
      </span>
      <div className="flex gap-1">
        {quarters.map((c) => {
          const active = activeChip?.start === c.start && activeChip?.end === c.end;
          return (
            <TooltipProvider key={`${c.label}-${c.year}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => applyQuarter(c)}
                    disabled={isPending}
                    className={cn(
                      "h-7 px-2.5 rounded-md border text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50",
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-input bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <span className="font-semibold">{c.label}</span>
                    <span className="opacity-60 text-[10px]">{c.year}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-medium">
                    {c.sublabel} {c.year}
                  </p>
                  <p className="text-zinc-400">
                    Shows people with issues active in this quarter.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>

      <div className="w-px h-4 bg-border mx-1" />

      <Popover open={calOpen} onOpenChange={setCalOpen}>
        <PopoverTrigger asChild>
          <button
            disabled={isPending}
            className={cn(
              "h-7 px-2.5 rounded-md border text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50",
              isCustom
                ? "bg-primary text-primary-foreground border-primary"
                : "border-input bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
            )}
          >
            <RiCalendarLine className="size-3 shrink-0" />
            {isCustom
              ? `${format(parseISO(start), "MMM d")} – ${format(parseISO(end), "MMM d, yyyy")}`
              : "Custom"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <div className="flex flex-col gap-0">
            <Calendar
              mode="range"
              selected={calRange}
              onSelect={setCalRange}
              numberOfMonths={2}
            />
            <div className="flex items-center justify-between border-t border-border px-3 py-2.5 gap-3">
              <span className="text-[11px] text-muted-foreground">
                {calRange?.from && calRange?.to
                  ? `${format(calRange.from, "MMM d")} – ${format(calRange.to, "MMM d, yyyy")}`
                  : "Select a start and end date"}
              </span>
              <Button
                size="sm"
                disabled={!calRange?.from || !calRange?.to || isPending}
                onClick={applyCustom}
              >
                Apply
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <div className="w-px h-4 bg-border mx-1" />

      <DepartmentSelect
        departments={departments}
        selected={selectedDepartments}
        onChange={(values) => navigate({ departments: values })}
      />

      <div className="relative">
        <RiSearchLine className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search people or projects…"
          className="h-7 w-56 rounded-md border border-input bg-background pl-8 pr-2.5 text-xs text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </div>
  );
}

// Compact multiselect matching the My Tasks filter bar's local MultiSelect.
function DepartmentSelect({
  departments,
  selected,
  onChange,
}: {
  departments: string[];
  selected: string[];
  onChange: (values: string[]) => void;
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
  const filtered = query.trim()
    ? departments.filter((d) =>
        d.toLowerCase().includes(query.trim().toLowerCase())
      )
    : departments;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
            hasSelection
              ? "bg-primary text-primary-foreground border-primary"
              : "border-input bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
          )}
        >
          Department
          {hasSelection && (
            <span className="rounded-full bg-primary-foreground/25 px-1.5 py-px text-[10px] font-semibold leading-none">
              {selected.length}
            </span>
          )}
          <RiArrowDownSLine className="size-3.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <div className="relative border-b border-zinc-100 dark:border-zinc-800">
          <RiSearchLine className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search departments…"
            className="w-full bg-transparent py-2 pl-8 pr-2.5 text-xs text-zinc-700 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-300"
          />
        </div>
        {departments.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-zinc-400">
            No departments
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-zinc-400">
            No matches
          </p>
        ) : (
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.map((dept) => (
              <div
                key={dept}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => toggle(dept)}
              >
                <Checkbox
                  checked={selected.includes(dept)}
                  onCheckedChange={() => toggle(dept)}
                />
                <span className="truncate text-zinc-700 dark:text-zinc-300">
                  {dept}
                </span>
              </div>
            ))}
          </div>
        )}
        {hasSelection && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 px-3 py-1.5">
            <button
              onClick={() => onChange([])}
              className="text-xs text-zinc-500 hover:text-foreground"
            >
              Clear selection
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

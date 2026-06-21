"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { RiCalendarLine } from "@remixicon/react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getRangePresets, getQuarterChips } from "@/lib/date-utils";

type Chip = { label: string; sublabel?: string; start: string; end: string };

/**
 * Quick-select chips (Last 7d / Last 30d + fiscal quarters) plus a custom
 * calendar range. Mirrors the shared filter-bar pattern used elsewhere.
 */
export function DateRangeBar({
  start,
  end,
  onChange,
  disabled,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  disabled?: boolean;
}) {
  const presets = getRangePresets();
  const last7 = presets.find((p) => p.label === "Last 7 days");
  const last30 = presets.find((p) => p.label === "Last 30 days");

  const chips: Chip[] = [
    ...(last7 ? [{ label: "Last 7d", start: last7.start, end: last7.end }] : []),
    ...(last30 ? [{ label: "Last 30d", start: last30.start, end: last30.end }] : []),
    ...getQuarterChips().map((q) => ({
      label: q.label,
      start: q.start,
      end: q.end,
    })),
  ];

  const activeChip = chips.find((c) => c.start === start && c.end === end);
  const isCustom = !activeChip;

  const [calOpen, setCalOpen] = useState(false);
  const [calRange, setCalRange] = useState<DayPickerRange | undefined>({
    from: parseISO(start),
    to: parseISO(end),
  });

  useEffect(() => {
    setCalRange({ from: parseISO(start), to: parseISO(end) });
  }, [start, end]);

  function applyCustom() {
    if (!calRange?.from || !calRange?.to) return;
    setCalOpen(false);
    onChange(format(calRange.from, "yyyy-MM-dd"), format(calRange.to, "yyyy-MM-dd"));
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", disabled && "opacity-60")}>
      <span className="mr-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
        Raised
      </span>
      {chips.map((c) => {
        const active = activeChip?.start === c.start && activeChip?.end === c.end;
        return (
          <button
            key={c.label}
            onClick={() => onChange(c.start, c.end)}
            disabled={disabled}
            className={cn(
              "h-7 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:opacity-50",
              active
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"
            )}
          >
            {c.label}
          </button>
        );
      })}

      <div className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

      <Popover open={calOpen} onOpenChange={setCalOpen}>
        <PopoverTrigger asChild>
          <button
            disabled={disabled}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:opacity-50",
              isCustom
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"
            )}
          >
            <RiCalendarLine className="size-3 shrink-0" />
            {isCustom
              ? `${format(parseISO(start), "MMM d")} – ${format(parseISO(end), "MMM d, yyyy")}`
              : "Custom"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="range"
            selected={calRange}
            onSelect={setCalRange}
            numberOfMonths={2}
          />
          <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
            <span className="text-[11px] text-zinc-500">
              {calRange?.from && calRange?.to
                ? `${format(calRange.from, "MMM d")} – ${format(calRange.to, "MMM d, yyyy")}`
                : "Select a start and end date"}
            </span>
            <Button size="sm" disabled={!calRange?.from || !calRange?.to} onClick={applyCustom}>
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { format, parseISO } from "date-fns";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { RiCalendarLine } from "@remixicon/react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  getWeekRangePresets,
  weekStartOf,
  weekEndOf,
  coveredWeekSpan,
} from "@/lib/date-utils";
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
};

export function FilterBar({ quarters, start, end }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [calOpen, setCalOpen] = useState(false);
  const [calRange, setCalRange] = useState<DayPickerRange | undefined>({
    from: parseISO(start),
    to: parseISO(end),
  });

  const presets = getWeekRangePresets();
  const activeChip = quarters.find((q) => q.start === start && q.end === end);
  const activePreset = presets.find((p) => p.start === start && p.end === end);
  const isCustom = !activeChip && !activePreset;

  const customWeeks =
    calRange?.from && calRange?.to
      ? coveredWeekSpan(
          format(calRange.from, "yyyy-MM-dd"),
          format(calRange.to, "yyyy-MM-dd")
        ).weeks
      : 0;

  function navigate(nextStart: string, nextEnd: string) {
    const params = new URLSearchParams({ start: nextStart, end: nextEnd });
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  // Expand whatever the user clicks onto whole Sunday–Saturday weeks, so the
  // calendar can only ever express a selection at the granularity the data has.
  function selectWeeks(range: DayPickerRange | undefined) {
    if (!range?.from) return setCalRange(undefined);
    setCalRange({
      from: parseISO(weekStartOf(format(range.from, "yyyy-MM-dd"))),
      to: range.to ? parseISO(weekEndOf(format(range.to, "yyyy-MM-dd"))) : undefined,
    });
  }

  function applyCustom() {
    if (!calRange?.from || !calRange?.to) return;
    setCalOpen(false);
    navigate(
      weekStartOf(format(calRange.from, "yyyy-MM-dd")),
      weekEndOf(format(calRange.to, "yyyy-MM-dd"))
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 flex-wrap",
        isPending && "opacity-60"
      )}
    >
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest hidden sm:inline">
        Quick
      </span>
      <div className="flex gap-1 flex-wrap">
        {presets.map((p) => {
          const active = activePreset?.start === p.start && activePreset?.end === p.end;
          return (
            <button
              key={p.label}
              onClick={() => navigate(p.start, p.end)}
              disabled={isPending}
              className={cn(
                "h-7 px-2.5 rounded-md border text-xs font-medium transition-colors flex items-center disabled:opacity-50",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="w-px h-4 bg-border mx-1" />

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
                    onClick={() => navigate(c.start, c.end)}
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
                    Net lines delivered in weeks falling in this quarter.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>

      <div className="w-px h-4 bg-border mx-1" />

      <Popover
        open={calOpen}
        onOpenChange={(o) => {
          setCalOpen(o);
          // Reset the picker to the active range each time it opens, snapped to
          // whole weeks so it reflects exactly what's currently applied.
          if (o)
            setCalRange({
              from: parseISO(weekStartOf(start)),
              to: parseISO(weekEndOf(end)),
            });
        }}
      >
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
            <p className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
              Contributions are reported weekly. Any day you pick snaps to its
              full week (Sun–Sat).
            </p>
            <Calendar
              mode="range"
              selected={calRange}
              onSelect={selectWeeks}
              numberOfMonths={2}
              defaultMonth={parseISO(weekStartOf(start))}
              resetOnSelect
            />
            <div className="flex items-center justify-between border-t border-border px-3 py-2.5 gap-3">
              <span className="text-[11px] text-muted-foreground">
                {calRange?.from && calRange?.to ? (
                  <>
                    <span className="font-medium text-foreground">
                      {format(calRange.from, "MMM d")} – {format(calRange.to, "MMM d, yyyy")}
                    </span>{" "}
                    · {customWeeks} {customWeeks === 1 ? "week" : "weeks"}
                  </>
                ) : (
                  "Pick a start and end week"
                )}
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
    </div>
  );
}

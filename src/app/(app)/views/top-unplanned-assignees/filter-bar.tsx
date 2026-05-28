"use client";

import { useEffect, useState, useTransition } from "react";
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

  useEffect(() => {
    setCalRange({ from: parseISO(start), to: parseISO(end) });
  }, [start, end]);

  const activeChip = quarters.find((q) => q.start === start && q.end === end);
  const isCustom = !activeChip;

  function navigate(nextStart: string, nextEnd: string) {
    startTransition(() => {
      router.replace(`${pathname}?start=${nextStart}&end=${nextEnd}`, {
        scroll: false,
      });
    });
  }

  function applyQuarter(q: QuarterChip) {
    navigate(q.start, q.end);
  }

  function applyCustom() {
    if (!calRange?.from || !calRange?.to) return;
    setCalOpen(false);
    navigate(format(calRange.from, "yyyy-MM-dd"), format(calRange.to, "yyyy-MM-dd"));
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 flex-wrap",
        isPending && "opacity-60"
      )}
    >
      <div className="flex items-center gap-2">
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
                      Shows assignees with unplanned jiras created in this
                      quarter.
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
      </div>
    </div>
  );
}

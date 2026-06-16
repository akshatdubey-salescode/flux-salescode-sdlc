"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RiCalendarLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiRefreshLine,
  RiAlertLine,
  RiCheckboxCircleLine,
  RiTimeLine,
  RiFireLine,
  RiQuestionLine,
  RiExternalLinkLine,
  RiFilter3Line,
  RiInboxLine,
  RiSearchLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiInformationLine,
  RiAlarmWarningLine,
  RiCheckLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  TimelineResponse,
  TimelineMember,
  TimelineIssue,
  UnplannedIssue,
  IssueLabel,
} from "@/app/api/observer/boards/[boardId]/timeline/route";
import type { UnplannedResponse, UnplannedPersonGroup, UnplannedIssueItem } from "@/app/api/observer/boards/[boardId]/unplanned/route";
import type { OverdueResponse, OverduePersonGroup, OverdueIssueItem } from "@/app/api/observer/boards/[boardId]/overdue/route";
import type { AtRiskResponse, AtRiskPersonGroup, AtRiskIssueItem } from "@/app/api/observer/boards/[boardId]/at-risk/route";
import type { MeetingEvent, MeetingsResponse } from "@/app/api/observer/boards/[boardId]/meetings/route";
import { statusCategoryStyles, priorityStyles, issueTypeStyles } from "@/components/project-tracking/helpers";
import { TeamGanttClient } from "@/components/observer/team-gantt-client";
import {
  localDateStr,
  quarterBounds,
  currentFyStartYear,
  currentQuarterNum,
  getRelevantQuarters,
} from "@/lib/date-utils";

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayStr() {
  return localDateStr(new Date());
}

function localNowStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatMeetingDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00"); // noon avoids DST edge cases
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / 86400000
  );
}

function formatDisplayDate(dateStr: string): string {
  const today = todayStr();
  const tomorrow = offsetDate(today, 1);
  const yesterday = offsetDate(today, -1);
  if (dateStr === today) return "Today";
  if (dateStr === tomorrow) return "Tomorrow";
  if (dateStr === yesterday) return "Yesterday";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: new Date(dateStr + "T12:00:00").getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

function formatDateRange(startDate: string, dueDate: string): string {
  const fmt = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  return `${fmt(startDate)} → ${fmt(dueDate)}`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function fmtShortDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

function buildAlertMessage(
  data: TimelineResponse,
  name: string | undefined,
  context: "board" | "project",
): string {
  const label = context === "board" ? "Board" : "Project";
  const today = todayStr();
  const dateLabel = new Date(today + "T12:00:00").toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const jiraUrl = (issue: { jiraBaseUrl: string; jiraKey: string }) =>
    `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;

  const overdueLines: string[] = [];
  for (const m of data.members) {
    for (const i of m.overdueIssues ?? []) {
      const days = Math.abs(i.daysRemaining ?? 0);
      overdueLines.push(
        `• ${i.summary} — ${m.name} (${days} day${days !== 1 ? "s" : ""} overdue)\n  ${jiraUrl(i)}`,
      );
    }
  }

  const atRiskLines: string[] = [];
  for (const m of data.members) {
    for (const i of m.issues.filter((x) => x.label === "at_risk")) {
      atRiskLines.push(
        `• ${i.summary} — ${m.name} (due ${fmtShortDate(i.dueDate)})\n  ${jiraUrl(i)}`,
      );
    }
  }

  const sections: string[] = [`📊 Team Health Update — ${dateLabel}`];
  if (name) sections.push(`${label}: ${name}`);
  if (overdueLines.length) {
    sections.push(
      `\n🔴 Overdue — ${overdueLines.length} issue${overdueLines.length !== 1 ? "s" : ""}\n${overdueLines.join("\n")}`,
    );
  }
  if (atRiskLines.length) {
    sections.push(
      `\n🟡 At Risk — ${atRiskLines.length} issue${atRiskLines.length !== 1 ? "s" : ""}\n${atRiskLines.join("\n")}`,
    );
  }
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Label configs
// ---------------------------------------------------------------------------

const LABEL_CONFIG: Record<
  IssueLabel,
  { dot: string; border: string; badge: string; badgeText: string }
> = {
  overdue: {
    dot: "bg-red-500",
    border: "border-l-red-500",
    badge: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
    badgeText: "Overdue",
  },
  at_risk: {
    dot: "bg-amber-400",
    border: "border-l-amber-400",
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    badgeText: "At Risk",
  },
  on_track: {
    dot: "bg-blue-500",
    border: "border-l-blue-500",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
    badgeText: "On Track",
  },
  done: {
    dot: "bg-emerald-500",
    border: "border-l-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
    badgeText: "Done",
  },
};

function priorityColor(priority: string | null): string {
  switch (priority?.toLowerCase()) {
    case "critical":
    case "highest":
      return "text-red-600 dark:text-red-400";
    case "high":
      return "text-orange-600 dark:text-orange-400";
    case "medium":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

function statusChipClass(statusCategory: string | null): string {
  const cat = (statusCategory ?? "").toLowerCase();
  if (cat === "done" || cat.includes("complete"))
    return "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/50";
  if (cat.includes("progress") || cat === "indeterminate")
    return "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900/50";
  return "text-muted-foreground bg-muted border-border";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

export type FilterMode = "single" | "range";
export type DateFilter =
  | { mode: "single"; date: string }
  | { mode: "range"; start: string; end: string };

function startOfWeek(date: string): string {
  const d = new Date(date + "T12:00:00");
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // Mon
  return localDateStr(d);
}

function endOfMonth(date: string): string {
  const d = new Date(date + "T12:00:00");
  d.setMonth(d.getMonth() + 1, 0);
  return localDateStr(d);
}

function startOfMonth(date: string): string {
  return date.slice(0, 8) + "01";
}

function DatePicker({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (d: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  // Controlled month so the calendar navigates to future months correctly
  const [month, setMonth] = useState<Date>(
    () => new Date((value || todayStr()) + "T12:00:00")
  );

  // When value changes externally (chip click), sync the visible month
  useEffect(() => {
    if (value) setMonth(new Date(value + "T12:00:00"));
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-2 font-medium min-w-[120px] justify-start bg-background shadow-sm"
        >
          <RiCalendarLine size={14} className="text-muted-foreground" />
          {value ? formatDisplayDate(value) : (placeholder ?? "Pick date")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          month={month}
          onMonthChange={setMonth}
          selected={value ? new Date(value + "T12:00:00") : undefined}
          onSelect={(date) => {
            if (date) {
              onChange(localDateStr(date));
              setOpen(false);
            }
          }}
          className="[--cell-size:--spacing(8)]"
        />
      </PopoverContent>
    </Popover>
  );
}

function DateFilterBar({
  filter,
  onChange,
  quarterStart,
  quarterEnd,
  onQuarterChange,
}: {
  filter: DateFilter;
  onChange: (f: DateFilter) => void;
  quarterStart: string;
  quarterEnd: string;
  onQuarterChange: (start: string, end: string) => void;
}) {
  const today = todayStr();

  function setMode(mode: FilterMode) {
    if (mode === "single") {
      onChange({ mode: "single", date: today });
    } else {
      onChange({ mode: "range", start: today, end: offsetDate(today, 6) });
    }
  }

  const singleChips = [
    { label: "Yesterday", date: offsetDate(today, -1) },
    { label: "Today", date: today },
    { label: "+7D", date: offsetDate(today, 7) },
    { label: "+30D", date: offsetDate(today, 30) },
  ];

  const rangeChips = [
    {
      label: "This Week",
      start: startOfWeek(today),
      end: offsetDate(startOfWeek(today), 6),
    },
    {
      label: "Next 2 Weeks",
      start: today,
      end: offsetDate(today, 13),
    },
    {
      label: "This Month",
      start: startOfMonth(today),
      end: endOfMonth(today),
    },
    {
      label: "Last 30D",
      start: offsetDate(today, -30),
      end: today,
    },
  ];

  const quarterChips = getRelevantQuarters();

  return (
    <div className="flex flex-col gap-3 mb-6">
      <div className="flex items-center gap-x-6 gap-y-3 flex-wrap">
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted text-muted-foreground shadow-sm">
            <button
              onClick={() => setMode("single")}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                filter.mode === "single"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Single Date
            </button>
            <button
              onClick={() => setMode("range")}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                filter.mode === "range"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Date Range
            </button>
          </div>

          <div className="w-px h-4 bg-border mx-1" />

          <div className="flex items-center gap-2">
            {filter.mode === "single" ? (
              <>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      onChange({ mode: "single", date: offsetDate(filter.date, -1) })
                    }
                    className="size-7 flex items-center justify-center rounded-md border border-input bg-background shadow-sm hover:bg-muted transition-colors text-muted-foreground"
                    title="Previous day"
                  >
                    <RiArrowLeftSLine size={15} />
                  </button>

                  <DatePicker
                    value={filter.date}
                    onChange={(d) => onChange({ mode: "single", date: d })}
                  />

                  <button
                    onClick={() =>
                      onChange({ mode: "single", date: offsetDate(filter.date, 1) })
                    }
                    className="size-7 flex items-center justify-center rounded-md border border-input bg-background shadow-sm hover:bg-muted transition-colors text-muted-foreground"
                    title="Next day"
                  >
                    <RiArrowRightSLine size={15} />
                  </button>
                </div>

                <div className="flex gap-1 ml-1">
                  {singleChips.map((chip) => (
                    <button
                      key={chip.label}
                      onClick={() => onChange({ mode: "single", date: chip.date })}
                      className={`px-2.5 py-1 text-xs rounded-md border font-medium transition-colors ${
                        filter.date === chip.date
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-input bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <DatePicker
                    value={filter.start}
                    onChange={(d) =>
                      onChange({
                        mode: "range",
                        start: d,
                        end: d > filter.end ? d : filter.end,
                      })
                    }
                    placeholder="Start date"
                  />

                  <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest px-1">to</span>

                  <DatePicker
                    value={filter.end}
                    onChange={(d) =>
                      onChange({
                        mode: "range",
                        start: filter.start > d ? d : filter.start,
                        end: d,
                      })
                    }
                    placeholder="End date"
                  />
                </div>

                <div className="flex gap-1 ml-1">
                  {rangeChips.map((chip) => (
                    <button
                      key={chip.label}
                      onClick={() =>
                        onChange({ mode: "range", start: chip.start, end: chip.end })
                      }
                      className={`px-2.5 py-1 text-xs rounded-md border font-medium transition-colors ${
                        filter.mode === "range" &&
                        filter.start === chip.start &&
                        filter.end === chip.end
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-input bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Quarter chips — independent of date filter */}
        <div className="flex items-center gap-2">
          <div className="w-px h-4 bg-border mx-1 hidden lg:block" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest hidden sm:inline">Quarter</span>
            <div className="flex gap-1">
            {quarterChips.map((c) => {
              const active = quarterStart === c.start && quarterEnd === c.end;
              return (
                <TooltipProvider key={`${c.label}-${c.year}`}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onQuarterChange(c.start, c.end)}
                        className={`h-7 px-2.5 rounded-md border text-xs font-medium transition-colors flex items-center gap-1.5 ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-input bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <span className="font-semibold">{c.label}</span>
                        <span className="opacity-60 text-[10px]">{c.year}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <p className="font-medium">{c.sublabel} {c.year}</p>
                      <p className="text-zinc-400">Shows jiras created in this quarter.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })}
            </div>
          </div>
        </div>
      </div>

      {/* Active range label */}
      {filter.mode === "range" && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 border border-border w-fit">
          <RiInformationLine size={14} className="text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground">
            Showing issues active between{" "}
            <span className="font-semibold text-foreground">
              {formatDisplayDate(filter.start)}
            </span>{" "}
            and{" "}
            <span className="font-semibold text-foreground">
              {formatDisplayDate(filter.end)}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCards({
  summary,
  onTabClick,
  quarterLabel,
  unassignedCount,
}: {
  summary: TimelineResponse["summary"];
  onTabClick: (tab: string) => void;
  quarterLabel?: string;
  unassignedCount?: number;
}) {
  const workload = summary.onTrack + summary.atRisk;
  const stats: { label: string; value: number; dot: string | null; tab: string; tip: string }[] = [
    { label: "Workload",  value: workload,          dot: null,                                             tab: "timeline",  tip: "Tasks your team is actively working on today — running on the selected date."         },
    { label: "Active",    value: summary.active,    dot: null,                                             tab: "active",    tip: "All open tasks — On Track + At Risk + Overdue combined."                             },
    { label: "On Track",  value: summary.onTrack,   dot: summary.onTrack > 0 ? "bg-blue-500" : null,      tab: "timeline",  tip: "Scheduled tasks running today with enough time left. No action needed."              },
    { label: "At Risk",   value: summary.atRisk,    dot: summary.atRisk > 0 ? "bg-amber-400" : null,      tab: "at-risk",   tip: "Tasks running out of time — less than 20% of their scheduled hours remain. Check in." },
    { label: "Overdue",   value: summary.overdue,   dot: summary.overdue > 0 ? "bg-red-500" : null,       tab: "overdue",   tip: "Tasks that missed their due date and are still open. Needs follow-up."               },
    { label: "Completed", value: summary.completed, dot: summary.completed > 0 ? "bg-emerald-500" : null, tab: "completed", tip: "Tasks finished within the selected date range."                                       },
  ];

  return (
    <TooltipProvider>
      <div className="flex items-stretch mb-6 rounded-lg border border-border bg-card divide-x divide-border overflow-hidden">
        {stats.map((stat) => (
          <Tooltip key={stat.label}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onTabClick(stat.tab)}
                className="flex items-center gap-2.5 px-5 py-3 flex-1 text-left hover:bg-muted/50 transition-colors group"
              >
                {stat.dot && <span className={`size-1.5 rounded-full shrink-0 ${stat.dot}`} />}
                <span className="text-sm font-semibold tabular-nums text-foreground">{stat.value}</span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                  {stat.label}
                  <RiInformationLine size={11} className="opacity-30 group-hover:opacity-70 transition-opacity shrink-0" />
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-56 text-center">{stat.tip}</TooltipContent>
          </Tooltip>
        ))}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onTabClick("unplanned")}
              className="flex items-center gap-2.5 px-5 py-3 flex-1 text-left hover:bg-muted/50 transition-colors group"
            >
              <span className="text-sm font-semibold tabular-nums text-foreground">{summary.unplanned}</span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                Unplanned
                <RiInformationLine size={11} className="opacity-30 group-hover:opacity-70 transition-opacity shrink-0" />
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56 text-center">
            Tasks with no start or due date — they exist but haven&apos;t been scheduled yet.
          </TooltipContent>
        </Tooltip>

        {unassignedCount !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onTabClick("unassigned")}
                className="flex items-center gap-2.5 px-5 py-3 flex-1 text-left hover:bg-muted/50 transition-colors group"
              >
                <span className="text-sm font-semibold tabular-nums text-foreground">{unassignedCount}</span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                  Unassigned
                  <RiInformationLine size={11} className="opacity-30 group-hover:opacity-70 transition-opacity shrink-0" />
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-56 text-center">
              Tasks no one owns yet. Assign them to keep work moving.
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

function formatEst(estWorkingDays: number | null | undefined): string {
  if (estWorkingDays == null) return "NA";
  if (estWorkingDays < 1) return `${Math.round(estWorkingDays * 9)}h`;
  return `${Math.round(estWorkingDays)}d`;
}

function estColor(estWorkingDays: number | null | undefined, threshold: number): string {
  if (estWorkingDays == null) return "text-muted-foreground/50 italic";
  return estWorkingDays > threshold
    ? "text-red-600 dark:text-red-400 font-semibold"
    : "text-green-600 dark:text-green-400 font-semibold";
}

function TimelineTableRow({ issue, estimateThreshold }: { issue: TimelineIssue; estimateThreshold: number }) {
  const cfg = LABEL_CONFIG[issue.label];
  const tStyles = issueTypeStyles(issue.issueType);
  const sStyles = statusCategoryStyles(issue.statusCategory);
  const pStyles = priorityStyles(issue.priority);
  const jiraUrl = `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;

  // Use working days (Mon–Fri) for the Remaining column so weekends don't
  // artificially inflate the count. Falls back to calendar daysRemaining only
  // when workingDaysRemaining is absent (e.g. legacy API response).
  const wdr = issue.workingDaysRemaining ?? null;

  /** Human-readable label for the Remaining cell. Null means "done / no value". */
  const daysText: string | null =
    issue.label === "done" || wdr === null
      ? null
      : wdr < 0
      ? `Overdue by ${formatEst(Math.abs(wdr))}`  // e.g. "Overdue by 3d"
      : wdr === 0
      ? "Due today"
      : formatEst(wdr);  // e.g. "1d", "5d", "4h"

  /**
   * Color thresholds (working days):
   *   overdue / ≤ 1 → red
   *   2–3            → amber
   *   > 3            → green  (requested: show green for issues with plenty of time)
   */
  const daysColor =
    !daysText ? "" :
    wdr! < 0    ? "text-red-600 dark:text-red-400 font-semibold" :
    wdr! <= 1   ? "text-red-500 dark:text-red-400 font-semibold" :
    wdr! <= 3   ? "text-amber-600 dark:text-amber-400 font-semibold" :
    "text-green-600 dark:text-green-400 font-semibold";

  return (
    <tr className={`transition-colors ${
      issue.label === "done"
        ? "bg-muted/40 hover:bg-muted/60"
        : "bg-card hover:bg-muted/40"
    }`}>
      {/* Label dot */}
      <td className="pl-4 pr-2 py-2.5">
        <span className={`block size-2 rounded-full shrink-0 ${cfg.dot}`} />
      </td>
      {/* Type icon */}
      <td className="px-2 py-2.5">
        <span
          className={`flex size-5 items-center justify-center rounded text-[10px] font-bold ${tStyles.bg} ${tStyles.text}`}
          title={issue.issueType}
        >
          {tStyles.abbr}
        </span>
      </td>
      {/* Key */}
      <td className="px-3 py-2.5">
        <a
          href={jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-mono font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
        >
          {issue.jiraKey}
          <RiExternalLinkLine size={10} className="opacity-60" />
        </a>
      </td>
      {/* Summary */}
      <td className="px-3 py-2.5 max-w-0">
        <a
          href={jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`block truncate font-medium hover:text-foreground ${
            issue.label === "done"
              ? "text-muted-foreground line-through"
              : "text-foreground"
          }`}
          title={issue.summary}
        >
          {issue.summary}
        </a>
      </td>
      {/* Status */}
      <td className="px-3 py-2.5">
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${sStyles.badge}`}>
          {issue.status}
        </span>
      </td>
      {/* Priority */}
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${pStyles.dot}`} />
          <span className={`font-medium ${pStyles.text}`}>{issue.priority ?? "—"}</span>
        </span>
      </td>
      {/* Date range */}
      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
        {formatDateRange(issue.startDate, issue.dueDate)}
      </td>
      {/* Est */}
      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs">
        <span className={estColor(issue.estWorkingDays ?? null, estimateThreshold)}>
          {formatEst(issue.estWorkingDays ?? null)}
        </span>
      </td>
      {/* Days remaining */}
      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs">
        {daysText ? <span className={daysColor}>{daysText}</span> : <span className="text-muted-foreground/30">—</span>}
      </td>
    </tr>
  );
}

function MemberTimelineCard({
  member,
  meetings,
  onSwitchToUnplanned,
  quarterStart,
  quarterEnd,
  estimateThreshold,
}: {
  member: TimelineMember;
  meetings?: { totalMinutes: number; eventCount: number; events: MeetingEvent[] };
  onSwitchToUnplanned?: (name: string) => void;
  quarterStart: string;
  quarterEnd: string;
  estimateThreshold: number;
}) {
  const { counts } = member;
  const [collapsed, setCollapsed] = useState(false);
  const hasNoPlanned = member.issues.length === 0;

  const showingUnplanned = hasNoPlanned && member.unplannedPreview.length > 0;

  const chips = getRelevantQuarters();
  const match = chips.find((c) => c.start === quarterStart && c.end === quarterEnd);
  const qLabel = match ? `${match.label} ${match.year}` : "selected quarter";

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${showingUnplanned ? "border-orange-200 dark:border-orange-800/50 bg-card" : "border-border bg-card"}`}>
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((c) => !c)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setCollapsed((c) => !c); }}
        className={`w-full flex items-center justify-between gap-4 px-4 py-3 border-b text-left transition-colors cursor-pointer select-none ${showingUnplanned ? "border-orange-100 dark:border-orange-900/40 bg-orange-50/40 dark:bg-orange-950/10 hover:bg-orange-50/70 dark:hover:bg-orange-950/20" : "border-border hover:bg-muted/50"}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-8 rounded-full bg-muted border border-border flex items-center justify-center text-[11px] font-bold text-muted-foreground shrink-0">
            {initials(member.name)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{member.name}</p>
            <p className="text-[11px] text-muted-foreground truncate">{member.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 text-[11px] font-medium">
            {counts.overdue > 0 && <span className="text-red-600 dark:text-red-400">{counts.overdue} overdue</span>}
            {counts.atRisk > 0 && <span className="text-amber-600 dark:text-amber-400">{counts.atRisk} at risk</span>}
            {counts.active - counts.atRisk - counts.overdue > 0 && (
              <span className="text-blue-600 dark:text-blue-400">{counts.active - counts.atRisk - counts.overdue} active</span>
            )}
            {counts.done > 0 && <span className="text-muted-foreground">{counts.done} done</span>}
            {counts.active === 0 && counts.done === 0 && (
              <span className="text-muted-foreground">No issues on this date</span>
            )}
            {member.unplannedCount > 0 && (
              <span className="text-orange-500 dark:text-orange-400">{member.unplannedCount} unplanned</span>
            )}
            {meetings && meetings.eventCount > 0 && (
              <span
                title={`${meetings.eventCount} meeting${meetings.eventCount === 1 ? "" : "s"} in this range`}
                className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/30 px-1.5 py-0.5 text-violet-700 dark:text-violet-400"
              >
                <RiCalendarLine size={10} />
                {formatMeetingDuration(meetings.totalMinutes)}
              </span>
            )}
          </div>
          <Link
            href={`/observer/developer/${encodeURIComponent(member.email)}`}
            prefetch={false}
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
          >
            Full profile →
          </Link>
          <RiArrowLeftSLine
            size={14}
            className={`text-muted-foreground transition-transform duration-200 ${collapsed ? "-rotate-90" : "rotate-90"}`}
          />
        </div>
      </div>

      {/* Issues table */}
      {!collapsed && (
        hasNoPlanned ? (
          member.unplannedPreview.length > 0 ? (
            <div className="bg-orange-50/30 dark:bg-orange-950/10">
              {/* Unplanned banner */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-orange-100 dark:border-orange-900/30">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 dark:bg-orange-900/40 border border-orange-200 dark:border-orange-800/50 px-2.5 py-0.5 text-[11px] font-semibold text-orange-700 dark:text-orange-400">
                  <RiInboxLine size={11} />
                  Unplanned backlog
                </span>
                <span className="text-[11px] text-orange-600/70 dark:text-orange-500/60">No tasks with dates fall on this day — showing latest unplanned tasks</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-orange-100 dark:border-orange-900/30 bg-orange-50/60 dark:bg-orange-950/20">
                      <th className="w-7 px-3 py-2.5" />
                      <th className="px-3 py-2.5 text-left font-medium text-orange-700/60 dark:text-orange-400/60 w-28">Key</th>
                      <th className="px-3 py-2.5 text-left font-medium text-orange-700/60 dark:text-orange-400/60">Summary</th>
                      <th className="px-3 py-2.5 text-left font-medium text-orange-700/60 dark:text-orange-400/60 w-36">Status</th>
                      <th className="px-3 py-2.5 text-left font-medium text-orange-700/60 dark:text-orange-400/60 w-28">Priority</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-orange-100/60 dark:divide-orange-900/20">
                    {member.unplannedPreview.map((issue) => (
                      <UnplannedTableRow key={issue.id} issue={issue} preview />
                    ))}
                  </tbody>
                </table>
              </div>
              {member.unplannedCount > 5 && (
                <div className="border-t border-orange-100 dark:border-orange-900/30 px-4 py-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onSwitchToUnplanned?.(member.name); }}
                    className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
                  >
                    +{member.unplannedCount - 5} more unplanned in {qLabel} →
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 px-4 text-center">
              <p className="text-xs text-muted-foreground italic">No planned or unplanned jiras that were created in the {qLabel}</p>
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="w-6 pl-4 pr-2 py-2.5" />
                  <th className="w-7 px-2 py-2.5" />
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-28">Key</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Summary</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-36">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-28">Priority</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-36">Dates</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground w-20">Est</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground w-32">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {member.issues.map((issue) => (
                  <TimelineTableRow key={issue.id} issue={issue} estimateThreshold={estimateThreshold} />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {!collapsed && meetings && meetings.events.length > 0 && (
        <MeetingsSection
          events={meetings.events}
          totalMinutes={meetings.totalMinutes}
        />
      )}
    </div>
  );
}

function MeetingsSection({
  events,
  totalMinutes,
}: {
  events: MeetingEvent[];
  totalMinutes: number;
}) {
  return (
    <div className="border-t-2 border-violet-200/60 dark:border-violet-900/40">
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-violet-50/40 dark:bg-violet-950/10 border-b border-violet-100 dark:border-violet-900/30">
        <div className="flex items-center gap-2">
          <RiCalendarLine size={12} className="text-violet-600 dark:text-violet-400" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-400">
            Meetings
          </span>
          <span className="text-[11px] text-muted-foreground">
            {events.length} {events.length === 1 ? "meeting" : "meetings"} ·
            {" "}
            {formatMeetingDuration(totalMinutes)} total
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-6 pl-4 pr-2 py-2.5" />
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-36">When</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Title</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-48">Organizer</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-28">Attendees</th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground w-24">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.map((ev) => (
              <MeetingTableRow key={ev.id} event={ev} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MeetingTableRow({ event }: { event: MeetingEvent }) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const dateLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timeLabel = `${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  const isPrivate = event.visibility === "private" || event.visibility === "confidential";
  const summary = event.summary ?? (isPrivate ? "(private)" : "(no title)");
  const attendeeCount = event.attendeeEmails.length;
  const attendeeTitle = event.attendeeEmails.join(", ");

  return (
    <tr className="bg-violet-50/20 dark:bg-violet-950/[0.04] hover:bg-violet-50/40 dark:hover:bg-violet-950/10 transition-colors">
      <td className="pl-4 pr-2 py-2">
        <span
          className="flex size-5 items-center justify-center rounded bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
          title="Meeting"
        >
          <RiCalendarLine size={11} />
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{dateLabel}</span>
          <span className="text-[10px] text-muted-foreground">{timeLabel}</span>
        </div>
      </td>
      <td className="px-3 py-2 max-w-0">
        {event.htmlLink ? (
          <a
            href={event.htmlLink}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground hover:text-foreground/80 inline-flex items-center gap-1 max-w-full"
            title={summary}
          >
            <span className="truncate">{summary}</span>
            <RiExternalLinkLine size={10} className="opacity-60 shrink-0" />
          </a>
        ) : (
          <span className="block truncate font-medium text-foreground" title={summary}>
            {summary}
          </span>
        )}
      </td>
      <td className="px-3 py-2 max-w-0">
        <span className="block truncate text-muted-foreground" title={event.organizerEmail ?? ""}>
          {event.organizerEmail ?? "—"}
        </span>
      </td>
      <td className="px-3 py-2" title={attendeeTitle}>
        <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          {attendeeCount > 0 ? `${attendeeCount}` : "Solo"}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        <span className="font-medium text-violet-700 dark:text-violet-400 whitespace-nowrap">
          {formatMeetingDuration(event.durationMinutes)}
        </span>
      </td>
    </tr>
  );
}

type UnplannedFilter = "all" | "missing_start" | "missing_due" | "missing_both";

const UNPLANNED_PAGE_SIZE = 10;

function UnplannedTableRow({ issue, preview }: { issue: UnplannedIssue; preview?: boolean }) {
  const jiraUrl = `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;
  const tStyles = issueTypeStyles(issue.issueType);
  const sStyles = statusCategoryStyles(issue.statusCategory);
  const pStyles = priorityStyles(issue.priority);

  return (
    <tr className="bg-card hover:bg-muted/40 transition-colors">
      <td className="px-3 py-2">
        <span
          className={`flex size-5 items-center justify-center rounded text-[10px] font-bold ${tStyles.bg} ${tStyles.text}`}
          title={issue.issueType}
        >
          {tStyles.abbr}
        </span>
      </td>
      <td className="px-3 py-2">
        <a
          href={jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
        >
          {issue.jiraKey}
          <RiExternalLinkLine size={10} className="opacity-60" />
        </a>
      </td>
      <td className="px-3 py-2 max-w-0">
        <a
          href={jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate font-medium text-foreground hover:text-foreground/80"
          title={issue.summary}
        >
          {issue.summary}
        </a>
      </td>
      <td className="px-3 py-2">
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${sStyles.badge}`}>
          {issue.status}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${pStyles.dot}`} />
          <span className={`font-medium ${pStyles.text}`}>{issue.priority ?? "—"}</span>
        </span>
      </td>
      {!preview && (
        <>
          <td className="px-3 py-2">
            {issue.missingStart ? (
              <span className="text-[10px] font-bold uppercase tracking-tight px-1.5 py-0.5 rounded-md border bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-900/50 whitespace-nowrap">
                Missing
              </span>
            ) : (
              <span className="text-muted-foreground/30">—</span>
            )}
          </td>
          <td className="px-3 py-2">
            {issue.missingDue ? (
              <span className="text-[10px] font-bold uppercase tracking-tight px-1.5 py-0.5 rounded-md border bg-red-50 text-red-700 border-red-100 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/50 whitespace-nowrap">
                Missing
              </span>
            ) : (
              <span className="text-muted-foreground/30">—</span>
            )}
          </td>
        </>
      )}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Unplanned tab with creation-date filter (uses its own API)
// ---------------------------------------------------------------------------

function TableMultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (vals: string[]) => void;
}) {
  function toggle(val: string) {
    onChange(selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val]);
  }
  const active = selected.length > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors ${
            active
              ? "border-primary/40 bg-primary/5 text-primary dark:bg-primary/10"
              : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {label}
          {active && (
            <span className="rounded-full bg-primary px-1 py-px text-[9px] font-bold text-primary-foreground leading-none">
              {selected.length}
            </span>
          )}
          <RiArrowDownSLine size={11} className="opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-0">
        {options.length === 0 ? (
          <p className="px-3 py-3 text-center text-xs text-muted-foreground">No options</p>
        ) : (
          <div className="max-h-52 overflow-y-auto py-1">
            {options.map((opt) => (
              <div
                key={opt}
                onClick={() => toggle(opt)}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
              >
                <span
                  className={`flex size-3.5 shrink-0 items-center justify-center rounded border ${
                    selected.includes(opt)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input"
                  }`}
                >
                  {selected.includes(opt) && (
                    <svg viewBox="0 0 10 10" className="size-2.5" fill="none">
                      <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="truncate text-foreground">{opt}</span>
              </div>
            ))}
          </div>
        )}
        {selected.length > 0 && (
          <div className="border-t border-border px-3 py-1.5">
            <button onClick={() => onChange([])} className="text-xs text-muted-foreground hover:text-foreground">
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TableSortControl({
  sortBy,
  sortDir,
  onChange,
}: {
  sortBy: TableLocalFilter["sortBy"];
  sortDir: "asc" | "desc";
  onChange: (sortBy: TableLocalFilter["sortBy"], sortDir: "asc" | "desc") => void;
}) {
  const current = TABLE_SORT_OPTS.find((o) => o.value === sortBy) ?? TABLE_SORT_OPTS[0];
  return (
    <div className="flex items-center gap-0.5">
      <Popover>
        <PopoverTrigger asChild>
          <button className="inline-flex h-6 items-center gap-1 rounded-l-md border border-input bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            Sort: {current.label}
            <RiArrowDownSLine size={11} className="opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-36 p-0">
          <div className="py-1">
            {TABLE_SORT_OPTS.map((opt) => (
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
        className="inline-flex h-6 items-center rounded-r-md border border-l-0 border-input bg-background px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        title={sortDir === "asc" ? "Ascending" : "Descending"}
      >
        {sortDir === "asc" ? <RiArrowUpSLine size={12} /> : <RiArrowDownSLine size={12} />}
      </button>
    </div>
  );
}

type TableLocalFilter = {
  issueType: string[];
  priority: string[];
  status: string[];
  sortBy: "createdAt" | "jiraKey" | "summary" | "status" | "priority";
  sortDir: "asc" | "desc";
};

const DEFAULT_TABLE_FILTER: TableLocalFilter = {
  issueType: [],
  priority: [],
  status: [],
  sortBy: "createdAt",
  sortDir: "desc",
};

const TABLE_SORT_OPTS = [
  { value: "createdAt", label: "Created" },
  { value: "jiraKey", label: "Key" },
  { value: "summary", label: "Summary" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
] as const;

function UnplannedPersonTable({
  person,
  filtered,
  typeSummary,
}: {
  person: UnplannedPersonGroup;
  filtered: UnplannedIssueItem[];
  typeSummary: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [localFilter, setLocalFilter] = useState<TableLocalFilter>(DEFAULT_TABLE_FILTER);
  const [page, setPage] = useState(1);

  const availableTypes = useMemo(() => [...new Set(filtered.map((i) => i.issueType))].sort(), [filtered]);
  const availablePriorities = useMemo(() => [...new Set(filtered.map((i) => i.priority).filter((p): p is string => p != null))].sort(), [filtered]);
  const availableStatuses = useMemo(() => [...new Set(filtered.map((i) => i.status))].sort(), [filtered]);

  const activeFilterCount = localFilter.issueType.length + localFilter.priority.length + localFilter.status.length;

  useEffect(() => { setPage(1); }, [filtered, query, localFilter]);

  const needle = query.trim().toLowerCase();
  let visible = needle
    ? filtered.filter((i) => i.summary.toLowerCase().includes(needle) || i.jiraKey.toLowerCase().includes(needle))
    : filtered;

  if (localFilter.issueType.length) visible = visible.filter((i) => localFilter.issueType.includes(i.issueType));
  if (localFilter.priority.length) visible = visible.filter((i) => i.priority != null && localFilter.priority.includes(i.priority));
  if (localFilter.status.length) visible = visible.filter((i) => localFilter.status.includes(i.status));

  visible = [...visible].sort((a, b) => {
    let cmp = 0;
    switch (localFilter.sortBy) {
      case "createdAt": cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? ""); break;
      case "summary": cmp = a.summary.localeCompare(b.summary); break;
      case "status":  cmp = a.status.localeCompare(b.status); break;
      case "priority": cmp = (a.priority ?? "zzz").localeCompare(b.priority ?? "zzz"); break;
      default: cmp = a.jiraKey.localeCompare(b.jiraKey);
    }
    return localFilter.sortDir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.ceil(visible.length / UNPLANNED_PAGE_SIZE);
  const pageItems = visible.slice((page - 1) * UNPLANNED_PAGE_SIZE, page * UNPLANNED_PAGE_SIZE);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((c) => !c)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setCollapsed((c) => !c); }}
        className="w-full flex items-center gap-3 px-4 py-3 border-b border-border text-left hover:bg-muted/50 transition-colors cursor-pointer select-none"
      >
        <div className="size-7 rounded-full bg-muted flex items-center justify-center text-[11px] font-bold text-muted-foreground shrink-0">
          {initials(person.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{person.name}</p>
            {person.isManager && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">Manager</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">{typeSummary}</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setFilterOpen((f) => {
              if (f) setLocalFilter(DEFAULT_TABLE_FILTER);
              return !f;
            });
          }}
          className={`relative p-1 rounded transition-colors shrink-0 ${filterOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          title="Filter &amp; sort"
        >
          <RiFilter3Line size={13} />
          {activeFilterCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground leading-none">
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSearchOpen((s) => {
              if (s) setQuery("");
              return !s;
            });
          }}
          className={`p-1 rounded transition-colors shrink-0 ${searchOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          title="Search"
        >
          <RiSearchLine size={13} />
        </button>
        <RiArrowLeftSLine
          size={14}
          className={`text-muted-foreground shrink-0 transition-transform duration-200 ${collapsed ? "-rotate-90" : "rotate-90"}`}
        />
      </div>
      {!collapsed && (
        <>
          {searchOpen && (
            <div className="px-3 py-2 border-b border-border">
              <div className="relative">
                <RiSearchLine size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by key or title…"
                  className="w-full pl-7 pr-3 py-1.5 text-xs rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </div>
            </div>
          )}
          {filterOpen && (
            <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-wrap">
              <TableMultiSelect
                label="Type"
                options={availableTypes}
                selected={localFilter.issueType}
                onChange={(vals) => setLocalFilter((f) => ({ ...f, issueType: vals }))}
              />
              <TableMultiSelect
                label="Priority"
                options={availablePriorities}
                selected={localFilter.priority}
                onChange={(vals) => setLocalFilter((f) => ({ ...f, priority: vals }))}
              />
              <TableMultiSelect
                label="Status"
                options={availableStatuses}
                selected={localFilter.status}
                onChange={(vals) => setLocalFilter((f) => ({ ...f, status: vals }))}
              />
              <div className="h-4 w-px bg-border mx-0.5" />
              <TableSortControl
                sortBy={localFilter.sortBy}
                sortDir={localFilter.sortDir}
                onChange={(sortBy, sortDir) => setLocalFilter((f) => ({ ...f, sortBy, sortDir }))}
              />
              {activeFilterCount > 0 && (
                <button
                  onClick={() => setLocalFilter(DEFAULT_TABLE_FILTER)}
                  className="ml-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="w-8 px-3 py-2.5" />
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-28">Key</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Summary</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-36">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-28">Priority</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-24">Start</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-24">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-xs text-muted-foreground">
                      No issues match your search.
                    </td>
                  </tr>
                ) : (
                  pageItems.map((issue) => (
                    <UnplannedTableRow key={issue.id} issue={issue} />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
              <span>
                Showing {(page - 1) * UNPLANNED_PAGE_SIZE + 1}–{Math.min(page * UNPLANNED_PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page <= 1}
                  className="rounded border border-input px-2.5 py-1 font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="px-2">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages}
                  className="rounded border border-input px-2.5 py-1 font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function UnplannedWithDateFilter({ apiBase, start, end }: { apiBase: string; start: string; end: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const typeFilter = (searchParams.get("utype") ?? "all") as UnplannedFilter;

  const [uqInput, setUqInput] = useState(() => searchParams.get("uq") ?? "");
  const debouncedUq = useDebounce(uqInput, 350);
  const uMounted = useRef(false);

  // Sync when uq is set externally (e.g. clicking "+N more unplanned" from a member card)
  const urlUq = searchParams.get("uq") ?? "";
  useEffect(() => { setUqInput(urlUq); }, [urlUq]);

  const [data, setData] = useState<UnplannedResponse | null>(null);
  const [loading, setLoading] = useState(true);

  function updateUnplannedParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  const load = useCallback(async (s: string, e: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `${apiBase}/unplanned?start=${s}&end=${e}`
      );
      if (res.ok) setData(await res.json());
    } catch {
      // network-level failure — just stop loading
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { load(start, end); }, [start, end, load]);

  // Sync debounced search to URL (skip first mount)
  useEffect(() => {
    if (!uMounted.current) { uMounted.current = true; return; }
    const params = new URLSearchParams(searchParams.toString());
    if (debouncedUq) params.set("uq", debouncedUq);
    else params.delete("uq");
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [debouncedUq]); // eslint-disable-line react-hooks/exhaustive-deps

  function filterIssues(issues: UnplannedPersonGroup["issues"]) {
    if (typeFilter === "missing_start") return issues.filter((i) => i.missingStart);
    if (typeFilter === "missing_due")   return issues.filter((i) => i.missingDue);
    if (typeFilter === "missing_both")  return issues.filter((i) => i.missingStart && i.missingDue);
    return issues;
  }

  return (
    <div>
      {/* Filter bar: type filter left, quarter + date pickers right */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        {/* Left: issue type filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <RiFilter3Line size={13} className="text-muted-foreground mr-0.5" />
          {(["all","missing_start","missing_due","missing_both"] as UnplannedFilter[]).map((id) => (
            <button
              key={id}
              onClick={() => updateUnplannedParams({ utype: id === "all" ? null : id })}
              className={`px-2.5 py-1 text-xs rounded-md border font-medium transition-colors ${
                typeFilter === id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
              }`}
            >
              {{ all: "All", missing_start: "Missing Start", missing_due: "Missing Due", missing_both: "Missing Both" }[id]}
            </button>
          ))}
        </div>

        {/* Right: active date range label */}
        <span className="text-xs text-muted-foreground">
          {formatDisplayDate(start)} → {formatDisplayDate(end)}
        </span>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <RiSearchLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={uqInput}
          onChange={(e) => setUqInput(e.target.value)}
          placeholder="Search by name, email or Jira title…"
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </div>

      {loading && <div className="h-40 bg-muted rounded-xl animate-pulse" />}

      {!loading && data && (() => {
        const uNeedle = uqInput.trim().toLowerCase();
        const visiblePeople = uNeedle
          ? data.byPerson.filter(
              (p) =>
                p.name.toLowerCase().includes(uNeedle) ||
                p.email.toLowerCase().includes(uNeedle) ||
                p.issues.some((i) => i.summary.toLowerCase().includes(uNeedle))
            )
          : data.byPerson;

        // Compute filtered total across visible people
        const filteredTotal = visiblePeople.reduce(
          (sum, p) => sum + filterIssues(p.issues).length, 0
        );

        if (filteredTotal === 0) {
          const chips = getRelevantQuarters();
          const match = chips.find(c => c.start === start && c.end === end);
          const qLabel = match ? `${match.label} ${match.year}` : "selected quarter";

          return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="size-12 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center mb-3">
                <RiCheckboxCircleLine size={22} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">All issues are planned</p>
              <p className="text-xs text-muted-foreground">No planned or unplanned jiras that were created in the {qLabel}</p>
            </div>
          );
        }

        return (
          <>
            {/* Total count summary */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm font-semibold text-foreground">
                {filteredTotal} unplanned
              </span>
              <span className="text-xs text-muted-foreground">
                created between {formatDisplayDate(start)} – {formatDisplayDate(end)}
              </span>
            </div>

            <div className="space-y-4">
              {visiblePeople.map((person) => {
                const filtered = filterIssues(person.issues);
                if (filtered.length === 0) return null;

                // Build type summary: "2 Bugs · 3 Tasks"
                const typeCounts: Record<string, number> = {};
                for (const issue of filtered) {
                  const t = issue.issueType || "Issue";
                  typeCounts[t] = (typeCounts[t] ?? 0) + 1;
                }
                const typeSummary = Object.entries(typeCounts)
                  .map(([t, n]) => `${n} ${n === 1 ? t : t.endsWith("s") ? t : t + "s"}`)
                  .join(" · ");

                return (
                  <UnplannedPersonTable
                    key={person.email}
                    person={person}
                    filtered={filtered}
                    typeSummary={typeSummary}
                  />
                );
              })}
            </div>
          </>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// At Risk tab
// ---------------------------------------------------------------------------

function formatHoursRemaining(hours: number): string {
  if (hours <= 0) return "0h left";
  if (hours < 1) return `${Math.round(hours * 60)}m left`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
}

function AtRiskIssueRow({ issue, estimateThreshold }: { issue: AtRiskIssueItem; estimateThreshold: number }) {
  const jiraUrl = `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;
  const tStyles = issueTypeStyles(issue.issueType);
  const sStyles = statusCategoryStyles(issue.statusCategory);
  const pStyles = priorityStyles(issue.priority);

  const urgencyColor =
    issue.percentRemaining <= 5
      ? "text-red-600 dark:text-red-400 font-bold"
      : issue.percentRemaining <= 10
      ? "text-orange-600 dark:text-orange-400 font-semibold"
      : "text-amber-600 dark:text-amber-400 font-semibold";

  return (
    <tr className="bg-card hover:bg-muted/40 transition-colors">
      <td className="px-3 py-2.5">
        <span
          className={`flex size-5 items-center justify-center rounded text-[10px] font-bold ${tStyles.bg} ${tStyles.text}`}
          title={issue.issueType}
        >
          {tStyles.abbr}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <a
          href={jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
        >
          {issue.jiraKey}
          <RiExternalLinkLine size={10} className="opacity-60" />
        </a>
      </td>
      <td className="px-3 py-2.5 max-w-0">
        <a
          href={jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate font-medium text-foreground hover:underline"
          title={issue.summary}
        >
          {issue.summary}
        </a>
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${sStyles.badge}`}>
          {issue.status}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${pStyles.dot}`} />
          <span className={`font-medium ${pStyles.text}`}>{issue.priority ?? "—"}</span>
        </span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
        {formatDateRange(issue.startDate, issue.dueDate)}
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs">
        <span className={estColor(issue.estWorkingDays, estimateThreshold)}>
          {formatEst(issue.estWorkingDays)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs">
        <span className={urgencyColor}>{formatHoursRemaining(issue.remainingWorkingHours)}</span>
        <span className="ml-1 text-muted-foreground">({Math.round(issue.percentRemaining)}%)</span>
      </td>
    </tr>
  );
}

function AtRiskPersonCard({ person, estimateThreshold }: { person: AtRiskPersonGroup; estimateThreshold: number }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-card overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-4 py-3 border-b border-amber-100 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10 hover:bg-amber-50/70 dark:hover:bg-amber-950/20 text-left transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <RiTimeLine size={14} className="text-amber-500 shrink-0" />
          <span className="font-semibold text-sm text-foreground truncate">{person.name}</span>
          <span className="text-xs text-muted-foreground truncate">{person.email}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-xs font-semibold px-2 py-0.5">
            {person.issues.length} at risk
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 text-white text-xs font-bold px-2 py-0.5">
            {formatHoursRemaining(person.issues[0].remainingWorkingHours)}
          </span>
          {open ? <RiArrowUpSLine size={16} className="text-muted-foreground" /> : <RiArrowDownSLine size={16} className="text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Key</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Summary</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Priority</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date Range</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-20">Est</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Time Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {person.issues.map((issue) => (
                <AtRiskIssueRow key={issue.id} issue={issue} estimateThreshold={estimateThreshold} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AtRiskTab({
  apiBase,
  quarterStart,
  quarterEnd,
  estimateThreshold,
}: {
  apiBase: string;
  quarterStart: string;
  quarterEnd: string;
  estimateThreshold: number;
}) {
  const [data, setData] = useState<AtRiskResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const load = useCallback(async (qs: string, qe: string) => {
    setLoading(true);
    try {
      const now = encodeURIComponent(localNowStr());
      const res = await fetch(
        `${apiBase}/at-risk?now=${now}&qstart=${qs}&qend=${qe}`
      );
      if (res.ok) setData(await res.json());
    } catch {
      // network failure
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { load(quarterStart, quarterEnd); }, [quarterStart, quarterEnd, load]);

  const filteredPersons = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return data.byPerson;
    return data.byPerson
      .map((p) => {
        const matchesPerson =
          p.name.toLowerCase().includes(needle) ||
          p.email.toLowerCase().includes(needle);
        const filteredIssues = p.issues.filter(
          (i) =>
            i.summary.toLowerCase().includes(needle) ||
            i.jiraKey.toLowerCase().includes(needle)
        );
        // Person-name match → show all their issues; issue match → show only matching issues
        return { ...p, issues: matchesPerson ? p.issues : filteredIssues };
      })
      .filter((p) => p.issues.length > 0);
  }, [data, search]);

  if (loading) return <div className="h-40 bg-muted rounded-xl animate-pulse" />;

  if (!data || data.totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <RiCheckboxCircleLine size={28} className="text-green-500 mb-3" />
        <p className="text-sm font-medium text-foreground">No at-risk tasks</p>
        <p className="text-xs text-muted-foreground mt-1">All planned work has more than 20% of its working time remaining.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <RiTimeLine size={14} className="text-amber-500" />
          <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
            {data.totalCount} at-risk {data.totalCount === 1 ? "task" : "tasks"}
          </span>
          <span className="text-xs text-muted-foreground">
            — tasks in their last 20% of working time
          </span>
        </div>
      </div>

      <div className="relative mb-5">
        <RiSearchLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or Jira title…"
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </div>

      {filteredPersons.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-muted-foreground">No results for &ldquo;{search}&rdquo;.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPersons.map((person) => (
            <AtRiskPersonCard key={person.email} person={person} estimateThreshold={estimateThreshold} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active tab — per-person view of all tasks (overdue + on-track + at-risk + done)
// ---------------------------------------------------------------------------

function ActivePersonCard({ member, estimateThreshold }: { member: TimelineMember; estimateThreshold: number }) {
  const [open, setOpen] = useState(true);
  const allIssues = [...(member.overdueIssues ?? []), ...member.issues];
  if (allIssues.length === 0) return null;

  const overdueCount = (member.overdueIssues ?? []).length;
  const atRiskCount = member.issues.filter((i) => i.label === "at_risk").length;
  const doneCount = member.issues.filter((i) => i.label === "done").length;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-4 py-3 border-b border-border bg-muted/20 hover:bg-muted/40 text-left transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm text-foreground truncate">{member.name}</span>
          <span className="text-xs text-muted-foreground truncate">{member.email}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {overdueCount > 0 && (
            <span className="rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 text-[10px] font-semibold px-2 py-0.5">
              {overdueCount} overdue
            </span>
          )}
          {atRiskCount > 0 && (
            <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-[10px] font-semibold px-2 py-0.5">
              {atRiskCount} at risk
            </span>
          )}
          {doneCount > 0 && (
            <span className="rounded-full bg-muted text-muted-foreground text-[10px] font-semibold px-2 py-0.5">
              {doneCount} done
            </span>
          )}
          {open ? <RiArrowUpSLine size={16} className="text-muted-foreground ml-1" /> : <RiArrowDownSLine size={16} className="text-muted-foreground ml-1" />}
        </div>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="pl-4 pr-2 py-2 w-2" />
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Key</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Summary</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Priority</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date Range</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-20">Est</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allIssues.map((issue) => (
                <TimelineTableRow key={issue.id} issue={issue} estimateThreshold={estimateThreshold} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ActiveTab({
  members,
  estimateThreshold,
}: {
  members: TimelineMember[];
  filterStart: string;
  filterEnd: string;
  estimateThreshold: number;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return members.filter((m) => m.issues.length + (m.overdueIssues ?? []).length > 0);
    return members
      .map((m) => {
        const matchesMember = m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle);
        const filterIssues = (issues: TimelineIssue[]) =>
          matchesMember ? issues : issues.filter(
            (i) => i.summary.toLowerCase().includes(needle) || i.jiraKey.toLowerCase().includes(needle)
          );
        return { ...m, issues: filterIssues(m.issues), overdueIssues: filterIssues(m.overdueIssues ?? []) };
      })
      .filter((m) => m.issues.length + (m.overdueIssues ?? []).length > 0);
  }, [members, search]);

  if (members.every((m) => m.issues.length + (m.overdueIssues ?? []).length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <RiInboxLine size={28} className="text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">No active tasks.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="relative mb-5">
        <RiSearchLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or Jira title…"
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </div>
      {filtered.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-muted-foreground">No results for &ldquo;{search}&rdquo;.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((member) => (
            <ActivePersonCard key={member.memberId} member={member} estimateThreshold={estimateThreshold} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Completed tab
// ---------------------------------------------------------------------------

function CompletedTab({
  members,
  filterStart,
  filterEnd,
  estimateThreshold,
}: {
  members: TimelineMember[];
  filterStart: string;
  filterEnd: string;
  estimateThreshold: number;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return members
      .map((m) => {
        const matchesMember =
          m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle);
        return {
          ...m,
          issues: m.issues.filter(
            (i) =>
              i.label === "done" &&
              (!needle ||
                matchesMember ||
                i.summary.toLowerCase().includes(needle) ||
                i.jiraKey.toLowerCase().includes(needle))
          ),
        };
      })
      .filter((m) => m.issues.length > 0);
  }, [members, search]);

  const total = filtered.reduce((s, m) => s + m.issues.length, 0);

  if (members.every((m) => m.issues.filter((i) => i.label === "done").length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <RiInboxLine size={28} className="text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-foreground">No completed tasks</p>
        <p className="text-xs text-muted-foreground mt-1">
          No tasks were completed during {formatDisplayDate(filterStart)}{filterStart !== filterEnd ? ` → ${formatDisplayDate(filterEnd)}` : ""}.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <RiCheckboxCircleLine size={14} className="text-green-500" />
        <span className="text-sm font-semibold text-foreground">{total} completed {total === 1 ? "task" : "tasks"}</span>
        <span className="text-xs text-muted-foreground">
          — {formatDisplayDate(filterStart)}{filterStart !== filterEnd ? ` → ${formatDisplayDate(filterEnd)}` : ""}
        </span>
      </div>

      <div className="relative mb-5">
        <RiSearchLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or Jira title…"
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-muted-foreground">No results for &ldquo;{search}&rdquo;.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((member) => (
            <CompletedPersonCard key={member.memberId} member={member} estimateThreshold={estimateThreshold} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompletedPersonCard({ member, estimateThreshold }: { member: TimelineMember; estimateThreshold: number }) {
  const [open, setOpen] = useState(true);
  const done = member.issues.filter((i) => i.label === "done");

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-4 py-3 border-b border-border bg-muted/20 hover:bg-muted/40 text-left transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <RiCheckboxCircleLine size={14} className="text-green-500 shrink-0" />
          <span className="font-semibold text-sm text-foreground truncate">{member.name}</span>
          <span className="text-xs text-muted-foreground truncate">{member.email}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 text-xs font-semibold px-2 py-0.5">
            {done.length} done
          </span>
          {open ? <RiArrowUpSLine size={16} className="text-muted-foreground" /> : <RiArrowDownSLine size={16} className="text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Key</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Summary</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Priority</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date Range</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-20">Est</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {done.map((issue) => (
                <TimelineTableRow key={issue.id} issue={issue} estimateThreshold={estimateThreshold} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overdue tab
// ---------------------------------------------------------------------------

function OverdueIssueRow({ issue, estimateThreshold }: { issue: OverdueIssueItem; estimateThreshold: number }) {
  const jiraUrl = `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;
  const tStyles = issueTypeStyles(issue.issueType);
  const sStyles = statusCategoryStyles(issue.statusCategory);
  const pStyles = priorityStyles(issue.priority);

  return (
    <tr className="bg-card hover:bg-muted/40 transition-colors">
      <td className="px-3 py-2.5">
        <span
          className={`flex size-5 items-center justify-center rounded text-[10px] font-bold ${tStyles.bg} ${tStyles.text}`}
          title={issue.issueType}
        >
          {tStyles.abbr}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <a
          href={jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
        >
          {issue.jiraKey}
          <RiExternalLinkLine size={10} className="opacity-60" />
        </a>
      </td>
      <td className="px-3 py-2.5 max-w-0">
        <a
          href={jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate font-medium text-foreground hover:underline"
          title={issue.summary}
        >
          {issue.summary}
        </a>
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${sStyles.badge}`}>
          {issue.status}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${pStyles.dot}`} />
          <span className={`font-medium ${pStyles.text}`}>{issue.priority ?? "—"}</span>
        </span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
        {issue.dueDate}
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs">
        <span className={estColor(issue.estWorkingDays, estimateThreshold)}>
          {formatEst(issue.estWorkingDays)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs font-semibold text-red-600 dark:text-red-400">
        {issue.daysOverdue}d overdue
      </td>
    </tr>
  );
}

function OverduePersonCard({ person, estimateThreshold }: { person: OverduePersonGroup; estimateThreshold: number }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800/50 bg-card overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-4 py-3 border-b border-red-100 dark:border-red-900/40 bg-red-50/40 dark:bg-red-950/10 hover:bg-red-50/70 dark:hover:bg-red-950/20 text-left transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <RiAlertLine size={14} className="text-red-500 shrink-0" />
          <span className="font-semibold text-sm text-foreground truncate">{person.name}</span>
          <span className="text-xs text-muted-foreground truncate">{person.email}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 text-xs font-semibold px-2 py-0.5">
            {person.issues.length} overdue
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-red-600 text-white text-xs font-bold px-2 py-0.5">
            up to {person.maxDaysOverdue}d late
          </span>
          {open ? <RiArrowUpSLine size={16} className="text-muted-foreground" /> : <RiArrowDownSLine size={16} className="text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Key</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Summary</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Priority</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Due Date</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-20">Est</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Overdue By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {person.issues.map((issue) => (
                <OverdueIssueRow key={issue.id} issue={issue} estimateThreshold={estimateThreshold} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OverdueTab({
  apiBase,
  quarterStart,
  quarterEnd,
  estimateThreshold,
}: {
  apiBase: string;
  quarterStart: string;
  quarterEnd: string;
  estimateThreshold: number;
}) {
  const [data, setData] = useState<OverdueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async (qs: string, qe: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `${apiBase}/overdue?qstart=${qs}&qend=${qe}&today=${todayStr()}`
      );
      if (res.ok) setData(await res.json());
    } catch {
      // network failure
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { load(quarterStart, quarterEnd); }, [quarterStart, quarterEnd, load]);

  const filteredPersons = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return data.byPerson;
    return data.byPerson
      .map((p) => {
        const matchesPerson =
          p.name.toLowerCase().includes(needle) ||
          p.email.toLowerCase().includes(needle);
        const filteredIssues = p.issues.filter(
          (i) =>
            i.summary.toLowerCase().includes(needle) ||
            i.jiraKey.toLowerCase().includes(needle)
        );
        return { ...p, issues: matchesPerson ? p.issues : filteredIssues };
      })
      .filter((p) => p.issues.length > 0);
  }, [data, search]);

  if (loading) return <div className="h-40 bg-muted rounded-xl animate-pulse" />;

  if (!data || data.totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <RiCheckboxCircleLine size={28} className="text-green-500 mb-3" />
        <p className="text-sm font-medium text-foreground">No overdue tasks</p>
        <p className="text-xs text-muted-foreground mt-1">All planned work for this quarter is on track.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <RiAlertLine size={14} className="text-red-500" />
          <span className="text-sm font-semibold text-red-600 dark:text-red-400">
            {data.totalCount} overdue {data.totalCount === 1 ? "task" : "tasks"}
          </span>
          <span className="text-xs text-muted-foreground">
            — scoped to {formatDisplayDate(data.quarterStart)} → {formatDisplayDate(data.quarterEnd)}
          </span>
        </div>
      </div>

      <div className="relative mb-5">
        <RiSearchLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or Jira title…"
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </div>

      {filteredPersons.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-muted-foreground">No results for &ldquo;{search}&rdquo;.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPersons.map((person) => (
            <OverduePersonCard key={person.email} person={person} estimateThreshold={estimateThreshold} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

type Props = {
  boardId: string;
  name?: string;
  onRemoveMember?: (email: string) => void;
};

const VALID_TABS = ["timeline", "active", "at-risk", "overdue", "completed", "unplanned", "gantt"] as const;
type TabValue = (typeof VALID_TABS)[number];

export function TeamTimelineClient({ boardId, name, onRemoveMember }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // --- derive filter from URL params ---
  const mode = (searchParams.get("mode") ?? "single") as FilterMode;
  const spDate = searchParams.get("date") ?? todayStr();
  const spTstart = searchParams.get("tstart") ?? todayStr();
  const spTend = searchParams.get("tend") ?? offsetDate(todayStr(), 6);

  // Quarter filter — independent of date filter, controls unplanned Jiras by creation date
  const defaultQBounds = quarterBounds(currentFyStartYear(), currentQuarterNum());
  const ustart = searchParams.get("ustart") ?? defaultQBounds.start;
  const uend = searchParams.get("uend") ?? defaultQBounds.end;

  // Local state for search so every keystroke doesn't trigger router.replace
  const [qInput, setQInput] = useState(() => searchParams.get("q") ?? "");
  const debouncedQ = useDebounce(qInput, 350);
  const isMounted = useRef(false);

  const filter: DateFilter = useMemo(
    () =>
      mode === "range"
        ? { mode: "range", start: spTstart, end: spTend }
        : { mode: "single", date: spDate },
    [mode, spDate, spTstart, spTend]
  );

  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alertCopied, setAlertCopied] = useState(false);

  // Map of memberEmail → { totalMinutes, eventCount, events } for the active
  // date range. Pulled from /api/observer/boards/:id/meetings; powers both the
  // header chip and the inline meeting rows in each member's table.
  const [meetingsByEmail, setMeetingsByEmail] = useState<
    Record<string, { totalMinutes: number; eventCount: number; events: MeetingEvent[] }>
  >({});

  const rawTab = searchParams.get("tab") ?? "timeline";
  const activeTab: TabValue = VALID_TABS.includes(rawTab as TabValue) ? (rawTab as TabValue) : "timeline";

  function handleCopyAlert() {
    if (!data) return;
    navigator.clipboard.writeText(buildAlertMessage(data, name, "board"));
    setAlertCopied(true);
    setTimeout(() => setAlertCopied(false), 2000);
  }

  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function setActiveTab(tab: string) {
    updateParams({ tab });
  }

  function setFilter(f: DateFilter) {
    if (f.mode === "single") {
      updateParams({ mode: "single", date: f.date, tstart: null, tend: null });
    } else {
      updateParams({ mode: "range", tstart: f.start, tend: f.end, date: null });
    }
  }

  function setQuarter(start: string, end: string) {
    updateParams({ ustart: start, uend: end });
  }

  // Sync debounced search to URL (skip first mount to avoid redundant replace)
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    const params = new URLSearchParams(searchParams.toString());
    if (debouncedQ) params.set("q", debouncedQ);
    else params.delete("q");
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildUrl(f: DateFilter, qs: string, qe: string): string {
    const base = `/api/observer/boards/${boardId}/timeline`;
    const qPart = `ustart=${qs}&uend=${qe}&now=${encodeURIComponent(localNowStr())}`;
    if (f.mode === "single") return `${base}?date=${f.date}&${qPart}`;
    return `${base}?start=${f.start}&end=${f.end}&${qPart}`;
  }

  const load = useCallback(
    async (f: DateFilter, qs: string, qe: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(buildUrl(f, qs, qe));
        if (res.ok) {
          setData(await res.json());
        } else {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `Server error (${res.status})`);
        }
      } catch {
        setError("Failed to load timeline data.");
      } finally {
        setLoading(false);
      }
    },
    [boardId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    load(filter, ustart, uend);
  }, [filter, ustart, uend, load]);

  useEffect(() => {
    const start = filter.mode === "single" ? filter.date : filter.start;
    const end = filter.mode === "single" ? filter.date : filter.end;
    let cancelled = false;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch(
      `/api/observer/boards/${boardId}/meetings?start=${start}&end=${end}&tz=${encodeURIComponent(tz)}`
    )
      .then((r) => (r.ok ? (r.json() as Promise<MeetingsResponse>) : null))
      .then((body) => {
        if (cancelled || !body?.byMember) return;
        const map: Record<string, { totalMinutes: number; eventCount: number; events: MeetingEvent[] }> = {};
        for (const m of body.byMember) {
          map[m.email.toLowerCase()] = {
            totalMinutes: m.totalMinutes,
            eventCount: m.eventCount,
            events: m.events,
          };
        }
        setMeetingsByEmail(map);
      })
      .catch(() => { /* meetings are non-critical; silently skip */ });
    return () => { cancelled = true; };
  }, [boardId, filter]);

  // Gantt dates derived from the top-level filter (single date → 7-day window)
  const ganttStart = filter.mode === "single" ? filter.date : filter.start;
  const ganttEnd = filter.mode === "single"
    ? offsetDate(filter.date, 6)
    : daysBetween(filter.start, filter.end) > 9
      ? offsetDate(filter.start, 9)
      : filter.end;

  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-destructive mb-2">{error}</p>
        <button
          onClick={() => load(filter, ustart, uend)}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div>
      <DateFilterBar
        filter={filter}
        onChange={setFilter}
        quarterStart={ustart}
        quarterEnd={uend}
        onQuarterChange={setQuarter}
      />

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-11 bg-muted rounded-lg mb-6" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 bg-muted rounded-xl" />
          ))}
        </div>
      ) : data ? (
        <>
          <SummaryCards
            summary={data.summary}
            onTabClick={setActiveTab}
            quarterLabel={(() => {
              const chips = getRelevantQuarters();
              const match = chips.find(c => c.start === ustart && c.end === uend);
              return match ? `${match.label} ${match.year}` : undefined;
            })()}
          />

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex items-center justify-between mb-4">
              <TabsList>
                <TabsTrigger value="timeline">Workload</TabsTrigger>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="at-risk">At Risk</TabsTrigger>
                <TabsTrigger value="overdue">Overdue</TabsTrigger>
                <TabsTrigger value="completed">Completed</TabsTrigger>
                <TabsTrigger value="unplanned">Unplanned</TabsTrigger>
                <TabsTrigger value="gantt">Gantt</TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-3">
                {(data.summary.overdue > 0 || data.summary.atRisk > 0) && (
                  <button
                    onClick={handleCopyAlert}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/60 transition-colors border border-red-200 dark:border-red-800"
                  >
                    {alertCopied
                      ? <><RiCheckLine size={12} /> Copied!</>
                      : <><RiAlarmWarningLine size={12} /> Copy Alert</>
                    }
                  </button>
                )}
                <button
                  onClick={() => load(filter, ustart, uend)}
                  disabled={loading}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RiRefreshLine size={12} className={loading ? "animate-spin" : ""} />
                  Refresh
                </button>
              </div>
            </div>

            <TabsContent value="timeline">
              {data.members.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <RiInboxLine size={28} className="text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No members on this board yet.
                  </p>
                </div>
              ) : (() => {
                const needle = qInput.trim().toLowerCase();
                const filteredMembers = needle
                  ? data.members.filter(
                      (m) =>
                        m.name.toLowerCase().includes(needle) ||
                        m.email.toLowerCase().includes(needle) ||
                        m.issues.some((i) => i.summary.toLowerCase().includes(needle))
                    )
                  : data.members;
                return (
                  <>
                    <div className="relative mb-4">
                      <RiSearchLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <input
                        type="text"
                        value={qInput}
                        onChange={(e) => setQInput(e.target.value)}
                        placeholder="Search by name, email or Jira title…"
                        className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
                      />
                    </div>
                    {filteredMembers.length === 0 ? (
                      <div className="py-10 text-center">
                        <p className="text-sm text-muted-foreground">No members match &ldquo;{qInput}&rdquo;.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {filteredMembers.map((member) => (
                          <MemberTimelineCard
                            key={member.memberId}
                            member={member}
                            meetings={meetingsByEmail[member.email.toLowerCase()]}
                            onSwitchToUnplanned={(name) => updateParams({ tab: "unplanned", uq: name })}
                            quarterStart={ustart}
                            quarterEnd={uend}
                            estimateThreshold={data.estimateThresholdDays}
                          />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </TabsContent>

            <TabsContent value="active">
              <ActiveTab members={data.members} filterStart={data.filterStart} filterEnd={data.filterEnd} estimateThreshold={data.estimateThresholdDays} />
            </TabsContent>

            <TabsContent value="at-risk">
              <AtRiskTab apiBase={`/api/observer/boards/${boardId}`} quarterStart={ustart} quarterEnd={uend} estimateThreshold={data.estimateThresholdDays} />
            </TabsContent>

            <TabsContent value="overdue">
              <OverdueTab apiBase={`/api/observer/boards/${boardId}`} quarterStart={ustart} quarterEnd={uend} estimateThreshold={data.estimateThresholdDays} />
            </TabsContent>

            <TabsContent value="completed">
              <CompletedTab members={data.members} filterStart={data.filterStart} filterEnd={data.filterEnd} estimateThreshold={data.estimateThresholdDays} />
            </TabsContent>

            <TabsContent value="unplanned">
              <UnplannedWithDateFilter apiBase={`/api/observer/boards/${boardId}`} start={ustart} end={uend} />
            </TabsContent>

            <TabsContent value="gantt">
              <TeamGanttClient boardId={boardId} start={ganttStart} end={ganttEnd} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unassigned tab (project-only)
// ---------------------------------------------------------------------------

import type { UnassignedResponse, UnassignedIssueItem } from "@/app/api/projects/[id]/team/unassigned/route";

function UnassignedTab({ projectId, quarterStart, quarterEnd }: { projectId: string; quarterStart: string; quarterEnd: string }) {
  const [data, setData] = useState<UnassignedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async (qs: string, qe: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/team/unassigned?qstart=${qs}&qend=${qe}`);
      if (res.ok) setData(await res.json());
    } catch { /* network failure */ }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(quarterStart, quarterEnd); }, [quarterStart, quarterEnd, load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return data.issues;
    return data.issues.filter(
      (i) => i.summary.toLowerCase().includes(needle) || i.jiraKey.toLowerCase().includes(needle)
    );
  }, [data, search]);

  if (loading) return <div className="h-40 bg-muted rounded-xl animate-pulse" />;

  if (!data || data.totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <RiCheckboxCircleLine size={28} className="text-green-500 mb-3" />
        <p className="text-sm font-medium text-foreground">No unassigned tasks</p>
        <p className="text-xs text-muted-foreground mt-1">All open tasks in this project have an assignee.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-semibold text-foreground">{data.totalCount} unassigned {data.totalCount === 1 ? "task" : "tasks"}</span>
        <span className="text-xs text-muted-foreground">
          — scoped to {formatDisplayDate(quarterStart)} → {formatDisplayDate(quarterEnd)}
        </span>
      </div>

      <div className="relative mb-5">
        <RiSearchLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by key or title…"
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </div>

      {rows.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-muted-foreground">No results for &ldquo;{search}&rdquo;.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Type</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Key</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Summary</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Priority</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((issue) => {
                  const jiraUrl = `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;
                  const tStyles = issueTypeStyles(issue.issueType);
                  const sStyles = statusCategoryStyles(issue.statusCategory);
                  const pStyles = priorityStyles(issue.priority);
                  return (
                    <tr key={issue.id} className="bg-card hover:bg-muted/40 transition-colors">
                      <td className="px-3 py-2.5">
                        <span className={`flex size-5 items-center justify-center rounded text-[10px] font-bold ${tStyles.bg} ${tStyles.text}`} title={issue.issueType}>
                          {tStyles.abbr}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <a href={jiraUrl} target="_blank" rel="noopener noreferrer" className="font-mono font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
                          {issue.jiraKey}
                          <RiExternalLinkLine size={10} className="opacity-60" />
                        </a>
                      </td>
                      <td className="px-3 py-2.5 max-w-0">
                        <a href={jiraUrl} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-foreground hover:underline" title={issue.summary}>
                          {issue.summary}
                        </a>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${sStyles.badge}`}>{issue.status}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`size-1.5 rounded-full ${pStyles.dot}`} />
                          <span className={`font-medium ${pStyles.text}`}>{issue.priority ?? "—"}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                        {issue.createdAt ? formatDisplayDate(issue.createdAt.slice(0, 10)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project Team Client — same view as TeamTimelineClient but scoped to a
// single project, with members derived from ticket assignees.
// No Gantt, no member management UI.
// ---------------------------------------------------------------------------

const PROJECT_VALID_TABS = ["timeline", "active", "at-risk", "overdue", "completed", "unplanned", "unassigned"] as const;
type ProjectTabValue = (typeof PROJECT_VALID_TABS)[number];

export function ProjectTeamClient({ projectId, name }: { projectId: string; name?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiBase = `/api/projects/${projectId}/team`;

  const mode = (searchParams.get("ptmode") ?? "single") as FilterMode;
  const spDate = searchParams.get("ptdate") ?? todayStr();
  const spTstart = searchParams.get("pttstart") ?? todayStr();
  const spTend = searchParams.get("pttend") ?? offsetDate(todayStr(), 6);
  const defaultQBounds = quarterBounds(currentFyStartYear(), currentQuarterNum());
  const ustart = searchParams.get("ptustart") ?? defaultQBounds.start;
  const uend = searchParams.get("ptuend") ?? defaultQBounds.end;

  const [qInput, setQInput] = useState(() => searchParams.get("ptq") ?? "");
  const debouncedQ = useDebounce(qInput, 350);
  const isMounted = useRef(false);

  const filter: DateFilter = useMemo(
    () => mode === "range" ? { mode: "range", start: spTstart, end: spTend } : { mode: "single", date: spDate },
    [mode, spDate, spTstart, spTend]
  );

  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unassignedCount, setUnassignedCount] = useState<number | undefined>(undefined);
  const [alertCopied, setAlertCopied] = useState(false);

  const rawTab = searchParams.get("pttab") ?? "timeline";
  const activeTab: ProjectTabValue = PROJECT_VALID_TABS.includes(rawTab as ProjectTabValue) ? (rawTab as ProjectTabValue) : "timeline";

  function handleCopyAlert() {
    if (!data) return;
    navigator.clipboard.writeText(buildAlertMessage(data, name, "project"));
    setAlertCopied(true);
    setTimeout(() => setAlertCopied(false), 2000);
  }

  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) params.delete(k); else params.set(k, v);
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function setActiveTab(tab: string) { updateParams({ pttab: tab }); }

  function setFilter(f: DateFilter) {
    if (f.mode === "single") updateParams({ ptmode: "single", ptdate: f.date, pttstart: null, pttend: null });
    else updateParams({ ptmode: "range", pttstart: f.start, pttend: f.end, ptdate: null });
  }

  function setQuarter(start: string, end: string) { updateParams({ ptustart: start, ptuend: end }); }

  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    const params = new URLSearchParams(searchParams.toString());
    if (debouncedQ) params.set("ptq", debouncedQ); else params.delete("ptq");
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildUrl(f: DateFilter, qs: string, qe: string): string {
    const qPart = `ustart=${qs}&uend=${qe}&now=${encodeURIComponent(localNowStr())}`;
    if (f.mode === "single") return `${apiBase}/timeline?date=${f.date}&${qPart}`;
    return `${apiBase}/timeline?start=${f.start}&end=${f.end}&${qPart}`;
  }

  const load = useCallback(async (f: DateFilter, qs: string, qe: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(buildUrl(f, qs, qe));
      if (res.ok) setData(await res.json());
      else { const body = await res.json().catch(() => ({})); setError(body.error ?? `Server error (${res.status})`); }
    } catch { setError("Failed to load team data."); }
    finally { setLoading(false); }
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(filter, ustart, uend); }, [filter, ustart, uend, load]);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/team/unassigned?qstart=${ustart}&qend=${uend}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setUnassignedCount(d.totalCount); })
      .catch(() => {});
  }, [projectId, ustart, uend]);

  if (error) return (
    <div className="py-12 text-center">
      <p className="text-sm text-destructive mb-2">{error}</p>
      <button onClick={() => load(filter, ustart, uend)} className="text-xs text-muted-foreground hover:text-foreground underline">Try again</button>
    </div>
  );

  return (
    <div>
      <DateFilterBar filter={filter} onChange={setFilter} quarterStart={ustart} quarterEnd={uend} onQuarterChange={setQuarter} />

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-11 bg-muted rounded-lg mb-6" />
          {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-muted rounded-xl" />)}
        </div>
      ) : data ? (
        <>
          <SummaryCards
            summary={data.summary}
            onTabClick={setActiveTab}
            unassignedCount={unassignedCount}
            quarterLabel={(() => {
              const chips = getRelevantQuarters();
              const match = chips.find(c => c.start === ustart && c.end === uend);
              return match ? `${match.label} ${match.year}` : undefined;
            })()}
          />

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex items-center justify-between mb-4">
              <TabsList>
                <TabsTrigger value="timeline">Workload</TabsTrigger>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="at-risk">At Risk</TabsTrigger>
                <TabsTrigger value="overdue">Overdue</TabsTrigger>
                <TabsTrigger value="completed">Completed</TabsTrigger>
                <TabsTrigger value="unplanned">Unplanned</TabsTrigger>
                <TabsTrigger value="unassigned">Unassigned</TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-3">
                {(data.summary.overdue > 0 || data.summary.atRisk > 0) && (
                  <button
                    onClick={handleCopyAlert}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/60 transition-colors border border-red-200 dark:border-red-800"
                  >
                    {alertCopied
                      ? <><RiCheckLine size={12} /> Copied!</>
                      : <><RiAlarmWarningLine size={12} /> Copy Alert</>
                    }
                  </button>
                )}
                <button onClick={() => load(filter, ustart, uend)} disabled={loading} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <RiRefreshLine size={12} className={loading ? "animate-spin" : ""} />
                  Refresh
                </button>
              </div>
            </div>

            <TabsContent value="timeline">
              {data.members.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <RiInboxLine size={28} className="text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No assignees found in this project.</p>
                </div>
              ) : (() => {
                const needle = qInput.trim().toLowerCase();
                const filteredMembers = needle
                  ? data.members.filter(m => m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle) || m.issues.some(i => i.summary.toLowerCase().includes(needle)))
                  : data.members;
                return (
                  <>
                    <div className="relative mb-4">
                      <RiSearchLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <input type="text" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search by name, email or Jira title…" className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30" />
                    </div>
                    {filteredMembers.length === 0 ? (
                      <div className="py-10 text-center"><p className="text-sm text-muted-foreground">No members match &ldquo;{qInput}&rdquo;.</p></div>
                    ) : (
                      <div className="space-y-4">
                        {filteredMembers.map((member) => (
                          <MemberTimelineCard key={member.memberId} member={member} quarterStart={ustart} quarterEnd={uend} onSwitchToUnplanned={(name) => updateParams({ pttab: "unplanned", ptuq: name })} estimateThreshold={data.estimateThresholdDays} />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </TabsContent>

            <TabsContent value="active">
              <ActiveTab members={data.members} filterStart={data.filterStart} filterEnd={data.filterEnd} estimateThreshold={data.estimateThresholdDays} />
            </TabsContent>

            <TabsContent value="at-risk">
              <AtRiskTab apiBase={apiBase} quarterStart={ustart} quarterEnd={uend} estimateThreshold={data.estimateThresholdDays} />
            </TabsContent>

            <TabsContent value="overdue">
              <OverdueTab apiBase={apiBase} quarterStart={ustart} quarterEnd={uend} estimateThreshold={data.estimateThresholdDays} />
            </TabsContent>

            <TabsContent value="completed">
              <CompletedTab members={data.members} filterStart={data.filterStart} filterEnd={data.filterEnd} estimateThreshold={data.estimateThresholdDays} />
            </TabsContent>

            <TabsContent value="unplanned">
              <UnplannedWithDateFilter apiBase={apiBase} start={ustart} end={uend} />
            </TabsContent>

            <TabsContent value="unassigned">
              <UnassignedTab projectId={projectId} quarterStart={ustart} quarterEnd={uend} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

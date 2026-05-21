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
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type {
  TimelineResponse,
  TimelineMember,
  TimelineIssue,
  UnplannedIssue,
  IssueLabel,
} from "@/app/api/observer/boards/[boardId]/timeline/route";
import type { UnplannedResponse, UnplannedPersonGroup, UnplannedIssueItem } from "@/app/api/observer/boards/[boardId]/unplanned/route";
import { statusCategoryStyles, priorityStyles, issueTypeStyles } from "@/components/project-tracking/helpers";
import { TeamGanttClient } from "@/components/observer/team-gantt-client";

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

// Always use local-timezone date arithmetic — toISOString() converts to UTC
// which shifts dates for users in IST (+5:30) and other non-UTC timezones.
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return localDateStr(new Date());
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
    dot: "bg-emerald-500",
    border: "border-l-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
    badgeText: "On Track",
  },
  done: {
    dot: "bg-zinc-400",
    border: "border-l-zinc-300 dark:border-l-zinc-700",
    badge: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
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
      return "text-zinc-400 dark:text-zinc-500";
  }
}

function statusChipClass(statusCategory: string | null): string {
  const cat = (statusCategory ?? "").toLowerCase();
  if (cat === "done" || cat.includes("complete"))
    return "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/50";
  if (cat.includes("progress") || cat === "indeterminate")
    return "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900/50";
  return "text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700";
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
          className="h-7 gap-2 font-medium min-w-[120px] justify-start bg-white dark:bg-zinc-900 shadow-sm"
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
}: {
  filter: DateFilter;
  onChange: (f: DateFilter) => void;
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

  return (
    <div className="flex flex-col gap-3 mb-6">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Mode toggle */}
        <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 bg-zinc-100 dark:bg-zinc-800 shadow-sm">
          <button
            onClick={() => setMode("single")}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              filter.mode === "single"
                ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Single Date
          </button>
          <button
            onClick={() => setMode("range")}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              filter.mode === "range"
                ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Date Range
          </button>
        </div>

        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700" />

        {filter.mode === "single" ? (
          <>
            <button
              onClick={() =>
                onChange({ mode: "single", date: offsetDate(filter.date, -1) })
              }
              className="size-7 flex items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-zinc-500"
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
              className="size-7 flex items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-zinc-500"
              title="Next day"
            >
              <RiArrowRightSLine size={15} />
            </button>

            <div className="flex gap-1 ml-1">
              {singleChips.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => onChange({ mode: "single", date: chip.date })}
                  className={`px-2.5 py-1 text-xs rounded-md border font-medium transition-colors ${
                    filter.date === chip.date
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
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

            <span className="text-xs text-muted-foreground font-medium">to</span>

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
                      : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Active range label */}
      {filter.mode === "range" && (
        <p className="text-xs text-muted-foreground">
          Showing issues active between{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {formatDisplayDate(filter.start)}
          </span>{" "}
          and{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {formatDisplayDate(filter.end)}
          </span>
        </p>
      )}
    </div>
  );
}

function SummaryCards({
  summary,
  onUnplannedClick,
}: {
  summary: TimelineResponse["summary"];
  onUnplannedClick: () => void;
}) {
  const stats: { label: string; value: number; dot: string | null }[] = [
    { label: "Active", value: summary.active, dot: null },
    { label: "At Risk", value: summary.atRisk, dot: summary.atRisk > 0 ? "bg-amber-400" : null },
    { label: "Overdue", value: summary.overdue, dot: summary.overdue > 0 ? "bg-red-500" : null },
    { label: "Completed", value: summary.completed, dot: null },
  ];

  return (
    <div className="flex items-stretch mb-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 divide-x divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
      {stats.map((stat) => (
        <div key={stat.label} className="flex items-center gap-2.5 px-5 py-3 flex-1">
          {stat.dot && <span className={`size-1.5 rounded-full shrink-0 ${stat.dot}`} />}
          <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {stat.value}
          </span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">{stat.label}</span>
        </div>
      ))}

      <button
        onClick={onUnplannedClick}
        className="flex items-center gap-2.5 px-5 py-3 flex-1 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors group"
      >
        <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {summary.unplanned}
        </span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
          Unplanned →
        </span>
      </button>
    </div>
  );
}

function TimelineTableRow({ issue }: { issue: TimelineIssue }) {
  const cfg = LABEL_CONFIG[issue.label];
  const tStyles = issueTypeStyles(issue.issueType);
  const sStyles = statusCategoryStyles(issue.statusCategory);
  const pStyles = priorityStyles(issue.priority);
  const jiraUrl = `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;

  const daysText =
    issue.label === "done" || issue.daysRemaining === null
      ? null
      : issue.daysRemaining < 0
      ? `Overdue by ${Math.abs(issue.daysRemaining)}d`
      : issue.daysRemaining === 0
      ? "Due today"
      : issue.daysRemaining === 1
      ? "Due tomorrow"
      : `${issue.daysRemaining}d left`;

  const daysColor =
    !daysText ? "" :
    issue.daysRemaining! < 0  ? "text-red-600 dark:text-red-400 font-semibold" :
    issue.daysRemaining! <= 1 ? "text-red-500 dark:text-red-400 font-semibold" :
    issue.daysRemaining! <= 3 ? "text-amber-600 dark:text-amber-400 font-semibold" :
    "text-muted-foreground";

  return (
    <tr className={`transition-colors ${
      issue.label === "done"
        ? "bg-zinc-50/50 dark:bg-zinc-900/20 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
        : "bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
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
          className="font-mono font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 inline-flex items-center gap-0.5"
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
          className={`block truncate font-medium hover:text-zinc-950 dark:hover:text-zinc-50 ${
            issue.label === "done"
              ? "text-zinc-400 dark:text-zinc-500 line-through"
              : "text-zinc-800 dark:text-zinc-200"
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
      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-zinc-400 dark:text-zinc-500">
        {formatDateRange(issue.startDate, issue.dueDate)}
      </td>
      {/* Days remaining */}
      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs">
        {daysText ? <span className={daysColor}>{daysText}</span> : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
      </td>
    </tr>
  );
}

function MemberTimelineCard({
  member,
  onSwitchToUnplanned,
}: {
  member: TimelineMember;
  onSwitchToUnplanned?: (name: string) => void;
}) {
  const { counts } = member;
  const [collapsed, setCollapsed] = useState(false);
  const hasNoPlanned = member.issues.length === 0;

  return (
    <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/50 shadow-sm overflow-hidden">
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((c) => !c)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setCollapsed((c) => !c); }}
        className="w-full flex items-center justify-between gap-4 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/80 text-left hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-8 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-[11px] font-bold text-zinc-500 shrink-0">
            {initials(member.name)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50 truncate">{member.name}</p>
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
            {counts.done > 0 && <span className="text-zinc-400 dark:text-zinc-500">{counts.done} done</span>}
            {counts.active === 0 && counts.done === 0 && (
              <span className="text-zinc-400 dark:text-zinc-500">No issues on this date</span>
            )}
            {member.unplannedCount > 0 && (
              <span className="text-orange-500 dark:text-orange-400">{member.unplannedCount} unplanned</span>
            )}
          </div>
          <Link
            href={`/observer/developer/${encodeURIComponent(member.email)}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
          >
            Full profile →
          </Link>
          <RiArrowLeftSLine
            size={14}
            className={`text-zinc-400 transition-transform duration-200 ${collapsed ? "-rotate-90" : "rotate-90"}`}
          />
        </div>
      </div>

      {/* Issues table */}
      {!collapsed && (
        hasNoPlanned ? (
          member.unplannedPreview.length > 0 ? (
            <div>
              <div className="px-4 pt-3 pb-1">
                <p className="text-[11px] text-muted-foreground italic">No issues with start &amp; due dates for this date. Showing latest unplanned tasks:</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/80">
                      <th className="w-7 px-3 py-2.5" />
                      <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-28">Key</th>
                      <th className="px-3 py-2.5 text-left font-medium text-zinc-500">Summary</th>
                      <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-36">Status</th>
                      <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-28">Priority</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                    {member.unplannedPreview.map((issue) => (
                      <UnplannedTableRow key={issue.id} issue={issue} preview />
                    ))}
                  </tbody>
                </table>
              </div>
              {member.unplannedCount > 3 && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onSwitchToUnplanned?.(member.name); }}
                    className="text-xs font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
                  >
                    +{member.unplannedCount - 3} more unplanned →
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 px-4 text-center">
              <p className="text-xs text-muted-foreground italic">No Jira issues with start &amp; due dates for this date</p>
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/80">
                  <th className="w-6 pl-4 pr-2 py-2.5" />
                  <th className="w-7 px-2 py-2.5" />
                  <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-28">Key</th>
                  <th className="px-3 py-2.5 text-left font-medium text-zinc-500">Summary</th>
                  <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-36">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-28">Priority</th>
                  <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-36">Dates</th>
                  <th className="px-3 py-2.5 text-right font-medium text-zinc-500 w-32">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {member.issues.map((issue) => (
                  <TimelineTableRow key={issue.id} issue={issue} />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

type UnplannedFilter = "all" | "missing_start" | "missing_due" | "missing_both";

function quarterBounds(year: number, q: number): { start: string; end: string } {
  const starts = [`${year}-01-01`, `${year}-04-01`, `${year}-07-01`, `${year}-10-01`];
  const ends   = [`${year}-03-31`, `${year}-06-30`, `${year}-09-30`, `${year}-12-31`];
  return { start: starts[q - 1], end: ends[q - 1] };
}

function currentQuarterNum(): number {
  return Math.ceil((new Date().getMonth() + 1) / 3);
}

const UNPLANNED_PAGE_SIZE = 10;

function UnplannedTableRow({ issue, preview }: { issue: UnplannedIssue; preview?: boolean }) {
  const jiraUrl = `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;
  const tStyles = issueTypeStyles(issue.issueType);
  const sStyles = statusCategoryStyles(issue.statusCategory);
  const pStyles = priorityStyles(issue.priority);

  return (
    <tr className="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900/60 transition-colors">
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
          className="font-mono font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 inline-flex items-center gap-0.5"
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
          className="block truncate font-medium text-zinc-800 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50"
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
              <span className="text-zinc-300 dark:text-zinc-600">—</span>
            )}
          </td>
          <td className="px-3 py-2">
            {issue.missingDue ? (
              <span className="text-[10px] font-bold uppercase tracking-tight px-1.5 py-0.5 rounded-md border bg-red-50 text-red-700 border-red-100 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/50 whitespace-nowrap">
                Missing
              </span>
            ) : (
              <span className="text-zinc-300 dark:text-zinc-600">—</span>
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

function getRelevantQuarters(pastCount: number) {
  const now = new Date();
  const curYear = now.getFullYear();
  const curQ = Math.ceil((now.getMonth() + 1) / 3);
  const monthRanges = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];
  const result = [];
  for (let i = pastCount; i >= 0; i--) {
    let q = curQ - i;
    let y = curYear;
    while (q <= 0) { q += 4; y--; }
    result.push({ label: `Q${q}`, year: y, sublabel: monthRanges[q - 1], ...quarterBounds(y, q) });
  }
  return result;
}

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
              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
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
          <p className="px-3 py-3 text-center text-xs text-zinc-400">No options</p>
        ) : (
          <div className="max-h-52 overflow-y-auto py-1">
            {options.map((opt) => (
              <div
                key={opt}
                onClick={() => toggle(opt)}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span
                  className={`flex size-3.5 shrink-0 items-center justify-center rounded border ${
                    selected.includes(opt)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-zinc-300 dark:border-zinc-600"
                  }`}
                >
                  {selected.includes(opt) && (
                    <svg viewBox="0 0 10 10" className="size-2.5" fill="none">
                      <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="truncate text-zinc-700 dark:text-zinc-300">{opt}</span>
              </div>
            ))}
          </div>
        )}
        {selected.length > 0 && (
          <div className="border-t border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
            <button onClick={() => onChange([])} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
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
          <button className="inline-flex h-6 items-center gap-1 rounded-l-md border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800">
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
                className={`flex w-full items-center px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                  sortBy === opt.value ? "font-semibold text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
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
        className="inline-flex h-6 items-center rounded-r-md border border-l-0 border-zinc-200 bg-white px-1.5 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
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
    <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/50 shadow-sm overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((c) => !c)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setCollapsed((c) => !c); }}
        className="w-full flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/80 text-left hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors cursor-pointer select-none"
      >
        <div className="size-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[11px] font-bold text-zinc-500 shrink-0">
          {initials(person.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{person.name}</p>
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
          className={`relative p-1 rounded transition-colors shrink-0 ${filterOpen ? "text-primary" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}
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
          className={`p-1 rounded transition-colors shrink-0 ${searchOpen ? "text-primary" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}
          title="Search"
        >
          <RiSearchLine size={13} />
        </button>
        <RiArrowLeftSLine
          size={14}
          className={`text-zinc-400 shrink-0 transition-transform duration-200 ${collapsed ? "-rotate-90" : "rotate-90"}`}
        />
      </div>
      {!collapsed && (
        <>
          {searchOpen && (
            <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800/80">
              <div className="relative">
                <RiSearchLine size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by key or title…"
                  className="w-full pl-7 pr-3 py-1.5 text-xs rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          )}
          {filterOpen && (
            <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800/80 flex items-center gap-2 flex-wrap">
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
              <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
              <TableSortControl
                sortBy={localFilter.sortBy}
                sortDir={localFilter.sortDir}
                onChange={(sortBy, sortDir) => setLocalFilter((f) => ({ ...f, sortBy, sortDir }))}
              />
              {activeFilterCount > 0 && (
                <button
                  onClick={() => setLocalFilter(DEFAULT_TABLE_FILTER)}
                  className="ml-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline underline-offset-2"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/80">
                  <th className="w-8 px-3 py-2.5" />
                  <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-28">Key</th>
                  <th className="px-3 py-2.5 text-left font-medium text-zinc-500">Summary</th>
                  <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-36">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-28">Priority</th>
                  <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-24">Start</th>
                  <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-24">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-xs text-zinc-400">
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
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-800/80 text-xs text-zinc-500">
              <span>
                Showing {(page - 1) * UNPLANNED_PAGE_SIZE + 1}–{Math.min(page * UNPLANNED_PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page <= 1}
                  className="rounded border border-zinc-200 px-2.5 py-1 font-medium hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Previous
                </button>
                <span className="px-2">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages}
                  className="rounded border border-zinc-200 px-2.5 py-1 font-medium hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
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

function UnplannedWithDateFilter({ boardId }: { boardId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const thisQ = currentQuarterNum();
  const thisYear = new Date().getFullYear();
  const defaultBounds = quarterBounds(thisYear, thisQ);

  const start = searchParams.get("ustart") ?? defaultBounds.start;
  const end = searchParams.get("uend") ?? defaultBounds.end;
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
        `/api/observer/boards/${boardId}/unplanned?start=${s}&end=${e}`
      );
      if (res.ok) setData(await res.json());
    } catch {
      // network-level failure — just stop loading
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => { load(start, end); }, [start, end, load]);

  // Sync debounced search to URL (skip first mount)
  useEffect(() => {
    if (!uMounted.current) { uMounted.current = true; return; }
    const params = new URLSearchParams(searchParams.toString());
    if (debouncedUq) params.set("uq", debouncedUq);
    else params.delete("uq");
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [debouncedUq]); // eslint-disable-line react-hooks/exhaustive-deps

  // Past 2 quarters + current quarter (no future)
  const quarterChips = getRelevantQuarters(2);

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
                  : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              {{ all: "All", missing_start: "Missing Start", missing_due: "Missing Due", missing_both: "Missing Both" }[id]}
            </button>
          ))}
        </div>

        {/* Right: quarter chips + custom date pickers */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            {quarterChips.map((c) => {
              const active = start === c.start && end === c.end;
              return (
                <button
                  key={`${c.label}-${c.year}`}
                  onClick={() => updateUnplannedParams({ ustart: c.start, uend: c.end })}
                  className={`flex flex-col items-center px-3 py-1 rounded-lg border text-xs font-semibold transition-colors leading-tight ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  }`}
                >
                  <span>{c.label} <span className="font-normal opacity-60 text-[10px]">{c.year}</span></span>
                  <span className={`text-[10px] font-normal ${active ? "opacity-75" : "text-muted-foreground"}`}>{c.sublabel}</span>
                </button>
              );
            })}
          </div>
          <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
          <DatePicker
            value={start}
            onChange={(d) => updateUnplannedParams({ ustart: d > end ? end : d })}
            placeholder="From"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <DatePicker
            value={end}
            onChange={(d) => updateUnplannedParams({ uend: d < start ? start : d })}
            placeholder="To"
          />
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <RiSearchLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={uqInput}
          onChange={(e) => setUqInput(e.target.value)}
          placeholder="Search by name, email or Jira title…"
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {loading && <div className="h-40 bg-zinc-100 dark:bg-zinc-800/50 rounded-xl animate-pulse" />}

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
          return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="size-12 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center mb-3">
                <RiCheckboxCircleLine size={22} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">All issues are planned</p>
              <p className="text-xs text-muted-foreground">No unplanned issues found for this date range.</p>
            </div>
          );
        }

        return (
          <>
            {/* Total count summary */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
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
// Main export
// ---------------------------------------------------------------------------

type Props = {
  boardId: string;
  onRemoveMember?: (email: string) => void;
};

const VALID_TABS = ["timeline", "gantt", "unplanned"] as const;
type TabValue = (typeof VALID_TABS)[number];

export function TeamTimelineClient({ boardId, onRemoveMember }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // --- derive filter from URL params ---
  const mode = (searchParams.get("mode") ?? "single") as FilterMode;
  const spDate = searchParams.get("date") ?? todayStr();
  const spTstart = searchParams.get("tstart") ?? todayStr();
  const spTend = searchParams.get("tend") ?? offsetDate(todayStr(), 6);

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

  const rawTab = searchParams.get("tab") ?? "timeline";
  const activeTab: TabValue = VALID_TABS.includes(rawTab as TabValue) ? (rawTab as TabValue) : "timeline";

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

  // Sync debounced search to URL (skip first mount to avoid redundant replace)
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    const params = new URLSearchParams(searchParams.toString());
    if (debouncedQ) params.set("q", debouncedQ);
    else params.delete("q");
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildUrl(f: DateFilter): string {
    const base = `/api/observer/boards/${boardId}/timeline`;
    if (f.mode === "single") return `${base}?date=${f.date}`;
    return `${base}?start=${f.start}&end=${f.end}`;
  }

  const load = useCallback(
    async (f: DateFilter) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(buildUrl(f));
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
    [boardId]
  );

  useEffect(() => {
    load(filter);
  }, [filter, load]);

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
          onClick={() => load(filter)}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div>
      <DateFilterBar filter={filter} onChange={setFilter} />

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-11 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg mb-6" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 bg-zinc-100 dark:bg-zinc-800/50 rounded-xl" />
          ))}
        </div>
      ) : data ? (
        <>
          <SummaryCards
            summary={data.summary}
            onUnplannedClick={() => setActiveTab("unplanned")}
          />

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex items-center justify-between mb-4">
              <TabsList>
                <TabsTrigger value="timeline">Timeline View</TabsTrigger>
                <TabsTrigger value="gantt">Gantt View</TabsTrigger>
                <TabsTrigger value="unplanned">Unplanned</TabsTrigger>
              </TabsList>

              <button
                onClick={() => load(filter)}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RiRefreshLine size={12} className={loading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>

            <TabsContent value="timeline">
              {data.members.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <RiInboxLine size={28} className="text-zinc-300 dark:text-zinc-700 mb-3" />
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
                        className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    {filteredMembers.length === 0 ? (
                      <div className="py-10 text-center">
                        <p className="text-sm text-muted-foreground">No members match &ldquo;{qInput}&rdquo;.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {filteredMembers.map((member) => (
                          <MemberTimelineCard key={member.memberId} member={member} onSwitchToUnplanned={(name) => updateParams({ tab: "unplanned", uq: name })} />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </TabsContent>

            <TabsContent value="gantt">
              <TeamGanttClient boardId={boardId} start={ganttStart} end={ganttEnd} />
            </TabsContent>

            <TabsContent value="unplanned">
              <UnplannedWithDateFilter boardId={boardId} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

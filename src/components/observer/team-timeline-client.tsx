"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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
import type { UnplannedResponse, UnplannedPersonGroup } from "@/app/api/observer/boards/[boardId]/unplanned/route";
import { TeamGanttClient } from "@/components/observer/team-gantt-client";

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
          className="gap-2 font-medium min-w-[120px] justify-start"
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
        <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-800 p-0.5 bg-zinc-50 dark:bg-zinc-900">
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
              className="size-7 flex items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors text-zinc-500"
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
              className="size-7 flex items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors text-zinc-500"
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
                      : "border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
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
                      : "border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
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
  const cards = [
    {
      label: "Active",
      value: summary.active,
      icon: <RiTimeLine size={16} />,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/30",
    },
    {
      label: "At Risk",
      value: summary.atRisk,
      icon: <RiAlertLine size={16} />,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/30",
    },
    {
      label: "Overdue",
      value: summary.overdue,
      icon: <RiFireLine size={16} />,
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-950/30",
    },
    {
      label: "Completed",
      value: summary.completed,
      icon: <RiCheckboxCircleLine size={16} />,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white dark:bg-zinc-900/50 px-4 py-3 shadow-sm"
        >
          <div className={`inline-flex size-7 items-center justify-center rounded-lg ${card.bg} ${card.color} mb-2`}>
            {card.icon}
          </div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 leading-none mb-1">
            {card.value}
          </p>
          <p className="text-xs text-muted-foreground font-medium">{card.label}</p>
        </div>
      ))}

      {/* Unplanned — clickable */}
      <button
        onClick={onUnplannedClick}
        className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900/50 px-4 py-3 shadow-sm text-left hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors group"
      >
        <div className="inline-flex size-7 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 mb-2 group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700 transition-colors">
          <RiQuestionLine size={16} />
        </div>
        <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 leading-none mb-1">
          {summary.unplanned}
        </p>
        <p className="text-xs text-muted-foreground font-medium">Unplanned →</p>
      </button>
    </div>
  );
}

function IssueRow({ issue }: { issue: TimelineIssue }) {
  const cfg = LABEL_CONFIG[issue.label];
  const jiraUrl = `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;

  const daysText = () => {
    if (issue.label === "done") return null;
    if (issue.daysRemaining === null) return null;
    if (issue.daysRemaining < 0)
      return `Overdue by ${Math.abs(issue.daysRemaining)}d`;
    if (issue.daysRemaining === 0) return "Due today";
    if (issue.daysRemaining === 1) return "Due tomorrow";
    return `${issue.daysRemaining}d left`;
  };

  const daysBadgeColor = () => {
    if (!issue.daysRemaining && issue.daysRemaining !== 0) return "";
    if (issue.daysRemaining < 0) return "text-red-600 dark:text-red-400 font-semibold";
    if (issue.daysRemaining <= 1) return "text-red-500 dark:text-red-400 font-semibold";
    if (issue.daysRemaining <= 3) return "text-amber-600 dark:text-amber-400 font-semibold";
    return "text-muted-foreground";
  };

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 border-l-2 ${cfg.border} bg-white dark:bg-zinc-900/30 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30 transition-colors rounded-r-lg`}
    >
      <span className={`mt-1.5 size-2 rounded-full shrink-0 ${cfg.dot}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p
            className={`text-sm font-medium leading-snug ${
              issue.label === "done"
                ? "text-zinc-400 dark:text-zinc-500 line-through"
                : "text-zinc-800 dark:text-zinc-200"
            }`}
          >
            {issue.summary}
          </p>

          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            {daysText() && (
              <span className={`text-[11px] ${daysBadgeColor()}`}>
                {daysText()}
              </span>
            )}
            <span
              className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-tight uppercase whitespace-nowrap ${statusChipClass(issue.statusCategory)}`}
            >
              {issue.status}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground/80">
          <a
            href={jiraUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono font-semibold hover:text-primary transition-colors flex items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            {issue.jiraKey}
            <RiExternalLinkLine size={10} className="opacity-60" />
          </a>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span className="truncate max-w-[140px]">{issue.projectName}</span>
          {issue.priority && (
            <>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span className={`font-medium ${priorityColor(issue.priority)}`}>
                {issue.priority}
              </span>
            </>
          )}
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span className="font-medium text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
            {formatDateRange(issue.startDate, issue.dueDate)}
          </span>
        </div>
      </div>
    </div>
  );
}

function MemberTimelineCard({ member }: { member: TimelineMember }) {
  const { counts } = member;

  const headerBg =
    counts.overdue > 0
      ? "border-l-4 border-l-red-500"
      : counts.atRisk > 0
      ? "border-l-4 border-l-amber-400"
      : "border-l-4 border-l-zinc-200 dark:border-l-zinc-700";

  return (
    <div
      className={`rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/50 shadow-sm overflow-hidden ${headerBg}`}
    >
      {/* Member header */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/80">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-8 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-[11px] font-bold text-zinc-500 shrink-0">
            {initials(member.name)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50 truncate">
              {member.name}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {member.email}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Count summary */}
          <div className="flex items-center gap-2 text-[11px] font-medium">
            {counts.overdue > 0 && (
              <span className="text-red-600 dark:text-red-400">
                {counts.overdue} overdue
              </span>
            )}
            {counts.atRisk > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {counts.atRisk} at risk
              </span>
            )}
            {counts.active - counts.atRisk - counts.overdue > 0 && (
              <span className="text-blue-600 dark:text-blue-400">
                {counts.active - counts.atRisk - counts.overdue} active
              </span>
            )}
            {counts.done > 0 && (
              <span className="text-zinc-400 dark:text-zinc-500">
                {counts.done} done
              </span>
            )}
            {counts.active === 0 && counts.done === 0 && (
              <span className="text-zinc-400 dark:text-zinc-500">
                No issues on this date
              </span>
            )}
          </div>

          <Link
            href={`/observer/developer/${encodeURIComponent(member.email)}`}
            className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
          >
            Full profile →
          </Link>
        </div>
      </div>

      {/* Issues */}
      <div className="p-3 space-y-1.5">
        {member.issues.length === 0 ? (
          <div className="py-4 px-3 text-center">
            <p className="text-xs text-muted-foreground italic">
              No Jira issues with start & due dates for this date
            </p>
          </div>
        ) : (
          member.issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))
        )}
      </div>
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

function UnplannedIssueRow({ issue }: { issue: UnplannedIssue }) {
  const jiraUrl = `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;

  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/20 transition-colors">
      <span className="mt-1.5 size-2 rounded-full bg-zinc-300 dark:bg-zinc-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 leading-snug">
            {issue.summary}
          </p>
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            {issue.missingStart && (
              <span className="text-[10px] font-bold uppercase tracking-tight px-1.5 py-0.5 rounded-md border bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-900/50 whitespace-nowrap">
                No Start
              </span>
            )}
            {issue.missingDue && (
              <span className="text-[10px] font-bold uppercase tracking-tight px-1.5 py-0.5 rounded-md border bg-red-50 text-red-700 border-red-100 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/50 whitespace-nowrap">
                No Due Date
              </span>
            )}
            <span
              className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-tight uppercase whitespace-nowrap ${statusChipClass(issue.statusCategory)}`}
            >
              {issue.status}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground/80">
          <a
            href={jiraUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono font-semibold hover:text-primary transition-colors flex items-center gap-0.5"
          >
            {issue.jiraKey}
            <RiExternalLinkLine size={10} className="opacity-60" />
          </a>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span className="truncate max-w-[160px]">{issue.projectName}</span>
          {issue.priority && (
            <>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span className={`font-medium ${priorityColor(issue.priority)}`}>
                {issue.priority}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
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

function UnplannedWithDateFilter({ boardId }: { boardId: string }) {
  const thisQ = currentQuarterNum();
  const thisYear = new Date().getFullYear();
  const defaultBounds = quarterBounds(thisYear, thisQ);

  const [start, setStart] = useState(defaultBounds.start);
  const [end, setEnd] = useState(defaultBounds.end);
  const [data, setData] = useState<UnplannedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<UnplannedFilter>("all");

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
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        {/* Left: issue type filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <RiFilter3Line size={13} className="text-muted-foreground mr-0.5" />
          {(["all","missing_start","missing_due","missing_both"] as UnplannedFilter[]).map((id) => (
            <button
              key={id}
              onClick={() => setTypeFilter(id)}
              className={`px-2.5 py-1 text-xs rounded-md border font-medium transition-colors ${
                typeFilter === id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
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
                  onClick={() => { setStart(c.start); setEnd(c.end); }}
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
          <DatePicker value={start} onChange={(d) => setStart(d > end ? end : d)} placeholder="From" />
          <span className="text-xs text-muted-foreground">→</span>
          <DatePicker value={end} onChange={(d) => setEnd(d < start ? start : d)} placeholder="To" />
        </div>
      </div>

      {loading && <div className="h-40 bg-zinc-100 dark:bg-zinc-800/50 rounded-xl animate-pulse" />}

      {!loading && data && (() => {
        // Compute filtered total across all people
        const filteredTotal = data.byPerson.reduce(
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
              {data.byPerson.map((person) => {
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
                  <div key={person.email} className="rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/50 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/80">
                      <div className="size-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[11px] font-bold text-zinc-500 shrink-0">
                        {initials(person.name)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{person.name}</p>
                          {person.isManager && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">Manager</span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">{typeSummary}</p>
                      </div>
                    </div>
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                      {filtered.map((issue) => (
                        <UnplannedIssueRow key={issue.id} issue={issue} />
                      ))}
                    </div>
                  </div>
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
};

export function TeamTimelineClient({ boardId }: Props) {
  const [filter, setFilter] = useState<DateFilter>({
    mode: "single",
    date: todayStr(),
  });
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("timeline");

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
          <div className="grid grid-cols-5 gap-3 mb-6">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-zinc-100 dark:bg-zinc-800/50 rounded-xl" />
            ))}
          </div>
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
              ) : (
                <div className="space-y-4">
                  {data.members.map((member) => (
                    <MemberTimelineCard
                      key={member.memberId}
                      member={member}
                    />
                  ))}
                </div>
              )}
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

"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiInboxLine, RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import type { ProjectSummary } from "@/app/api/analytics/dashboard/route";
import type { BoardSummary } from "@/app/api/analytics/workload/boards/route";
import {
  getRelevantQuarters,
  quarterBounds,
  currentFyStartYear,
  currentQuarterNum,
} from "@/lib/date-utils";

// ── Quarter helpers ───────────────────────────────────────────────────────────

type Quarter = { label: string; start: string; end: string };

// Fiscal-year quarters (Apr–Mar), shared with the Team Tracking view so the
// same "Q1 2026" chip resolves to the same date range on both dashboards.
// (Previously this page used calendar quarters, which made Overdue — and hence
// Active — diverge from Team Tracking because the quarter start dates differed.)
function getQuarterChips(): Quarter[] {
  return getRelevantQuarters().map((q) => ({
    label: `${q.label} ${q.year}`,
    start: q.start,
    end: q.end,
  }));
}

function currentFiscalQuarter(): Quarter {
  const { start } = quarterBounds(currentFyStartYear(), currentQuarterNum());
  const chips = getQuarterChips();
  return chips.find((q) => q.start === start) ?? chips[0];
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return "Today";
  if (dateStr === offsetDate(todayStr, -1)) return "Yesterday";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Shared column headers ─────────────────────────────────────────────────────

const STAT_HEADERS = ["Workload", "Active", "On Track", "At Risk", "Overdue", "Completed", "Unplanned"];

// ── Main Component ────────────────────────────────────────────────────────────

export function WorkloadPage() {
  const [todayStr, setTodayStr] = useState("");
  const [nowStr, setNowStr] = useState("");

  const [mode, setMode] = useState<"single" | "range">("single");
  const [date, setDate] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [quarter, setQuarter] = useState<Quarter | null>(null);

  const [activeTab, setActiveTab] = useState<"project" | "board">("project");
  const [projectData, setProjectData] = useState<{ projects: ProjectSummary[] } | null>(null);
  const [boardData, setBoardData] = useState<{ boards: BoardSummary[] } | null>(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(false);

  useEffect(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const localNow = `${today}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    setTodayStr(today);
    setNowStr(localNow);
    setDate(today);
    setRangeStart(today);
    setRangeEnd(offsetDate(today, 7));
    setQuarter(currentFiscalQuarter());
  }, []);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams({ now: nowStr });
    if (mode === "single") {
      params.set("date", date);
    } else {
      params.set("start", rangeStart);
      params.set("end", rangeEnd);
    }
    if (quarter) {
      params.set("ustart", quarter.start);
      params.set("uend", quarter.end);
    }
    return params;
  }, [nowStr, mode, date, rangeStart, rangeEnd, quarter]);

  const fetchProjectData = useCallback(() => {
    if (!nowStr) return;
    setProjectLoading(true);
    const params = buildParams();
    fetch(`/api/analytics/dashboard?${params}`)
      .then((r) => r.json())
      .then((d) => { setProjectData(d); setProjectLoading(false); });
  }, [nowStr, buildParams]);

  const fetchBoardData = useCallback(() => {
    if (!nowStr) return;
    setBoardLoading(true);
    const params = buildParams();
    fetch(`/api/analytics/workload/boards?${params}`)
      .then((r) => r.json())
      .then((d) => { setBoardData(d); setBoardLoading(false); });
  }, [nowStr, buildParams]);

  // Fetch project data whenever filters change
  useEffect(() => {
    if (!nowStr) return;
    fetchProjectData();
  }, [fetchProjectData]);

  // Fetch board data when: tab is "board" AND (first visit OR filter changed)
  useEffect(() => {
    if (!nowStr || activeTab !== "board") return;
    fetchBoardData();
  }, [activeTab, fetchBoardData]);

  if (!todayStr) return null;

  const quarters = getQuarterChips();

  return (
    <div className="space-y-4 pb-8">
      {/* ── Filter bar ── */}
      <Card>
        <CardContent className="py-3 px-4 flex flex-wrap items-center gap-3">
          {/* Tab switcher */}
          <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5 text-[11px] font-medium shrink-0">
            {(["project", "board"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={cn(
                  "h-6 rounded-md px-3 transition-all duration-150 capitalize",
                  activeTab === t
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t === "project" ? "By Project" : "By Team"}
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-border/50 shrink-0" />

          {/* Date mode toggle */}
          <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5 text-[11px] font-medium shrink-0">
            {(["single", "range"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "h-6 rounded-md px-3 transition-all duration-150 capitalize",
                  mode === m
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "single" ? "Single Date" : "Date Range"}
              </button>
            ))}
          </div>

          {/* Single date controls */}
          {mode === "single" && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setDate((d) => offsetDate(d, -1))}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                <RiArrowLeftSLine className="size-4" />
              </button>
              <span className="min-w-[60px] text-center text-[11px] font-semibold tabular-nums">
                {formatDateLabel(date, todayStr)}
              </span>
              <button
                onClick={() => setDate((d) => offsetDate(d, 1))}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                <RiArrowRightSLine className="size-4" />
              </button>
            </div>
          )}

          {/* Quick chips */}
          <div className="flex items-center gap-1 shrink-0">
            {mode === "single" ? (
              <>
                <QuickChip label="Yesterday" active={date === offsetDate(todayStr, -1)} onClick={() => setDate(offsetDate(todayStr, -1))} />
                <QuickChip label="Today" active={date === todayStr} onClick={() => setDate(todayStr)} />
                <QuickChip label="+7D" active={false} onClick={() => { setMode("range"); setRangeStart(todayStr); setRangeEnd(offsetDate(todayStr, 7)); }} />
                <QuickChip label="+30D" active={false} onClick={() => { setMode("range"); setRangeStart(todayStr); setRangeEnd(offsetDate(todayStr, 30)); }} />
              </>
            ) : (
              <>
                <QuickChip label="Today–7D" active={rangeStart === todayStr && rangeEnd === offsetDate(todayStr, 7)} onClick={() => { setRangeStart(todayStr); setRangeEnd(offsetDate(todayStr, 7)); }} />
                <QuickChip label="Today–30D" active={rangeStart === todayStr && rangeEnd === offsetDate(todayStr, 30)} onClick={() => { setRangeStart(todayStr); setRangeEnd(offsetDate(todayStr, 30)); }} />
              </>
            )}
          </div>

          {/* Quarter filter */}
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Quarter
            </span>
            <div className="flex items-center gap-0.5">
              {quarters.map((q) => (
                <button
                  key={q.label}
                  onClick={() => setQuarter(quarter?.label === q.label ? null : q)}
                  className={cn(
                    "h-6 rounded-md px-2.5 text-[11px] font-medium transition-all duration-150",
                    quarter?.label === q.label
                      ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Table ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>
            {activeTab === "project" ? "Project Workload" : "Team Workload"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          {activeTab === "project" ? (
            projectLoading ? (
              <WorkloadSkeleton />
            ) : !projectData || projectData.projects.length === 0 ? (
              <div className="px-5 pb-5"><EmptyState /></div>
            ) : (
              <WorkloadTable>
                {projectData.projects.map((p) => (
                  <tr
                    key={p.projectId}
                    className="transition-colors hover:bg-muted/30 cursor-pointer"
                    onClick={() => { window.location.href = "/observer"; }}
                  >
                    <td className="px-5 py-3.5 font-semibold text-foreground max-w-[220px]">
                      <span className="block truncate">{p.projectName}</span>
                    </td>
                    <StatTd value={p.workload} color="default" />
                    <StatTd value={p.active} color="default" />
                    <StatTd value={p.onTrack} dot="blue" color={p.onTrack > 0 ? "blue" : "muted"} />
                    <StatTd value={p.atRisk} dot={p.atRisk > 0 ? "amber" : undefined} color={p.atRisk > 0 ? "amber" : "muted"} />
                    <StatTd value={p.overdue} dot={p.overdue > 0 ? "red" : undefined} color={p.overdue > 0 ? "red" : "muted"} />
                    <StatTd value={p.completed} dot={p.completed > 0 ? "green" : undefined} color={p.completed > 0 ? "green" : "muted"} />
                    <StatTd value={p.unplanned} color={p.unplanned > 0 ? "default" : "muted"} />
                    <StatTd value={p.unassigned} color={p.unassigned > 0 ? "default" : "muted"} />
                  </tr>
                ))}
              </WorkloadTable>
            )
          ) : boardLoading || !boardData ? (
            <WorkloadSkeleton />
          ) : boardData.boards.length === 0 ? (
            <div className="px-5 pb-5"><EmptyState /></div>
          ) : (
            <WorkloadTable boardTab>
              {boardData.boards.map((b) => (
                <tr
                  key={b.boardId}
                  className="transition-colors hover:bg-muted/30 cursor-pointer"
                  onClick={() => { window.location.href = `/observer/${b.boardId}`; }}
                >
                  <td className="px-5 py-3.5 max-w-[220px]">
                    <span className="block truncate font-semibold text-foreground">{b.boardName}</span>
                    <span className="text-[11px] text-muted-foreground">{b.memberCount} member{b.memberCount !== 1 ? "s" : ""}</span>
                  </td>
                  <StatTd value={b.workload} color="default" />
                  <StatTd value={b.active} color="default" />
                  <StatTd value={b.onTrack} dot="blue" color={b.onTrack > 0 ? "blue" : "muted"} />
                  <StatTd value={b.atRisk} dot={b.atRisk > 0 ? "amber" : undefined} color={b.atRisk > 0 ? "amber" : "muted"} />
                  <StatTd value={b.overdue} dot={b.overdue > 0 ? "red" : undefined} color={b.overdue > 0 ? "red" : "muted"} />
                  <StatTd value={b.completed} dot={b.completed > 0 ? "green" : undefined} color={b.completed > 0 ? "green" : "muted"} />
                  <StatTd value={b.unplanned} color={b.unplanned > 0 ? "default" : "muted"} />
                </tr>
              ))}
            </WorkloadTable>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Shared table wrapper ──────────────────────────────────────────────────────

function WorkloadTable({ children, boardTab }: { children: React.ReactNode; boardTab?: boolean }) {
  const headers = boardTab
    ? ["Team", ...STAT_HEADERS]
    : ["Project", ...STAT_HEADERS, "Unassigned"];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {headers.map((h, i) => (
              <th
                key={h}
                className={cn(
                  "py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap",
                  i === 0 ? "px-5 text-left" : "px-4 text-right"
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">{children}</tbody>
      </table>
    </div>
  );
}

// ── Stat cell ─────────────────────────────────────────────────────────────────

function StatTd({
  value,
  dot,
  color,
}: {
  value: number;
  dot?: "blue" | "red" | "green" | "amber";
  color: "default" | "blue" | "red" | "green" | "amber" | "muted";
}) {
  const dotClass: Record<string, string> = {
    blue:  "bg-blue-500",
    red:   "bg-red-500",
    green: "bg-emerald-500",
    amber: "bg-amber-500",
  };
  const textClass = {
    default: "text-foreground font-semibold",
    blue:    "text-blue-600 dark:text-blue-400 font-semibold",
    red:     "text-red-600 dark:text-red-400 font-semibold",
    green:   "text-emerald-600 dark:text-emerald-400 font-semibold",
    amber:   "text-amber-600 dark:text-amber-400 font-semibold",
    muted:   "text-muted-foreground/30",
  }[color];

  return (
    <td className="px-4 py-3.5 text-right tabular-nums">
      <span className={cn("inline-flex items-center justify-end gap-1", textClass)}>
        {dot && value > 0 && <span className={cn("size-1.5 rounded-full shrink-0", dotClass[dot])} />}
        {value === 0 && color === "muted" ? <span className="text-muted-foreground/30">0</span> : value}
      </span>
    </td>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function QuickChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-6 rounded-md px-2.5 text-[11px] font-medium transition-all duration-150",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground border border-transparent hover:border-border"
      )}
    >
      {label}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10">
      <RiInboxLine className="size-5 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">No active issues found for this filter</p>
    </div>
  );
}

function WorkloadSkeleton() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <tbody className="divide-y divide-border/50">
          {[...Array(6)].map((_, i) => (
            <tr key={i}>
              <td className="px-5 py-3.5"><Skeleton className="h-4 w-36 rounded" /></td>
              {[...Array(7)].map((_, j) => (
                <td key={j} className="px-4 py-3.5 text-right">
                  <Skeleton className="h-4 w-8 rounded ml-auto" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

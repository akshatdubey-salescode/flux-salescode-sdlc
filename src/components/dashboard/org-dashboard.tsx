"use client";

import { useEffect, useState } from "react";
import { format, subDays } from "date-fns";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartInfo } from "@/components/ui/chart-info";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import {
  RiErrorWarningLine,
  RiTimeLine,
  RiArrowUpLine,
  RiArrowDownLine,
  RiCalendarLine,
  RiInboxLine,
  RiTeamLine,
  RiFlowChart,
} from "@remixicon/react";

// ---------- Types ----------

type OrgDashboardData = {
  orgHealth: {
    activeIssues: number;
    completedThisWeek: number;
    completedDelta: number;
    slaViolations: number;
    unmappedWarnings: number;
    projectsSyncedToday: number;
  };
  throughput: { week: string; project_id: string; project_name: string; completed: number }[];
  wipHeatmap: { project_id: string; name: string; canonical_status: string; issue_count: number }[];
  cycleTime: { project_id: string; project_name: string; p50_hours: number; p75_hours: number; p90_hours: number }[];
  staleIssues: { project_id: string; name: string; stale_count: number }[];
  flowEfficiency: { project_id: string; project_name: string; flow_efficiency_pct: number }[];
  slaTopRules: { rule_name: string; project_name: string; trigger_count: number }[];
  devWorkload: {
    assignee_name: string;
    active_total: number;
    p1: number;
    p2: number;
    p3: number;
    in_progress: number;
    in_review: number;
    in_qa: number;
    p50_cycle_hours: number;
  }[];
  devVelocity: { assignee_name: string; this_week: number; last_week: number; delta: number }[];
  issueTypeMix: { issue_type: string; count: number; pct: number }[];
};

type Preset = "7d" | "14d" | "30d" | "90d" | "custom";

type DateRange = { from: Date; to: Date };

// ---------- Constants ----------

const PRESETS: { label: string; value: Preset; days?: number }[] = [
  { label: "7d", value: "7d", days: 7 },
  { label: "14d", value: "14d", days: 14 },
  { label: "30d", value: "30d", days: 30 },
  { label: "90d", value: "90d", days: 90 },
];

const CHART_COLORS = [
  "var(--chart-1)",  "var(--chart-2)",  "var(--chart-3)",  "var(--chart-4)",  "var(--chart-5)",
  "var(--chart-6)",  "var(--chart-7)",  "var(--chart-8)",  "var(--chart-9)",  "var(--chart-10)",
  "var(--chart-11)", "var(--chart-12)", "var(--chart-13)", "var(--chart-14)", "var(--chart-15)",
  "var(--chart-16)", "var(--chart-17)", "var(--chart-18)", "var(--chart-19)", "var(--chart-20)",
  "var(--chart-21)", "var(--chart-22)", "var(--chart-23)", "var(--chart-24)", "var(--chart-25)",
  "var(--chart-26)", "var(--chart-27)", "var(--chart-28)", "var(--chart-29)", "var(--chart-30)",
];

const ISSUE_TYPE_COLORS: Record<string, string> = {
  Bug: "var(--destructive)",
  Story: "var(--chart-2)",
  Task: "var(--chart-1)",
  "Sub-task": "var(--chart-3)",
  Subtask: "var(--chart-3)",
  Epic: "var(--chart-4)",
};

const sanitize = (s: string) =>
  `k_${s.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

function presetRange(p: Preset): DateRange {
  const to = new Date();
  const days = PRESETS.find((x) => x.value === p)?.days ?? 30;
  return { from: subDays(to, days), to };
}

// ---------- Main Component ----------

export function OrgDashboard() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [range, setRange] = useState<DateRange>(() => presetRange("30d"));
  const [data, setData] = useState<OrgDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [calOpen, setCalOpen] = useState(false);
  const [calRange, setCalRange] = useState<DayPickerRange | undefined>();

  useEffect(() => {
    setLoading(true);
    fetch(
      `/api/analytics/dashboard?from=${range.from.toISOString()}&to=${range.to.toISOString()}`
    )
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [range]);

  function applyPreset(p: Preset) {
    setPreset(p);
    setRange(presetRange(p));
  }

  function applyCustomRange() {
    if (calRange?.from && calRange?.to) {
      setPreset("custom");
      setRange({ from: calRange.from, to: calRange.to });
      setCalOpen(false);
    }
  }

  const rangeLabel =
    preset === "custom"
      ? `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`
      : `Last ${PRESETS.find((x) => x.value === preset)?.days} days`;

  return (
    <div className="space-y-4 pb-8">
      {/* ── Date Range Bar ── */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {!loading && data ? rangeLabel : <span className="opacity-0">placeholder</span>}
        </p>

        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => applyPreset(p.value)}
                className={cn(
                  "h-6 rounded-md px-3 text-[11px] font-medium transition-all duration-150",
                  preset === p.value
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 text-[11px] font-medium transition-all duration-150",
                  preset === "custom"
                    ? "text-foreground ring-1 ring-border/60 bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <RiCalendarLine className="size-3 shrink-0" />
                {preset === "custom"
                  ? `${format(range.from, "MMM d")} – ${format(range.to, "MMM d")}`
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
                  disabled={{ after: new Date() }}
                />
                <div className="flex items-center justify-between border-t border-border px-3 py-2.5">
                  <span className="text-[11px] text-muted-foreground">
                    {calRange?.from && calRange?.to
                      ? `${format(calRange.from, "MMM d")} – ${format(calRange.to, "MMM d, yyyy")}`
                      : "Select a start and end date"}
                  </span>
                  <Button
                    size="sm"
                    disabled={!calRange?.from || !calRange?.to}
                    onClick={applyCustomRange}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {loading || !data ? (
        <DashboardSkeleton />
      ) : (
        <div className="space-y-4">
          {/* ── Row 1: KPI strip ── */}
          <OrgHealthStrip health={data.orgHealth} preset={preset} />

          {/* ── Row 2: Throughput + Issue Mix ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <ThroughputChart throughput={data.throughput} />
            </div>
            <IssueTypeMix issueTypeMix={data.issueTypeMix} />
          </div>

          {/* ── Row 3: WIP · Flow · Stale ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <WipHeatmap wipHeatmap={data.wipHeatmap} />
            <FlowEfficiencyBars flowEfficiency={data.flowEfficiency} />
            <StaleIssuesRadar staleIssues={data.staleIssues} />
          </div>

          {/* ── Row 4: Cycle Time + SLA ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <CycleTimeTable cycleTime={data.cycleTime} />
            </div>
            <SlaViolationCard
              totalViolations={data.orgHealth.slaViolations}
              topRules={data.slaTopRules}
            />
          </div>

          {/* ── Row 5: Dev Workload (full width) ── */}
          <DevWorkloadTable devWorkload={data.devWorkload} />

          {/* ── Row 6: Dev Velocity + Period Summary ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <DevVelocityTable devVelocity={data.devVelocity} preset={preset} />
            </div>
            <PeriodSummary data={data} preset={preset} range={range} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- KPI Strip ----------

function OrgHealthStrip({
  health,
  preset,
}: {
  health: OrgDashboardData["orgHealth"];
  preset: Preset;
}) {
  const periodLabel = preset === "custom" ? "in period" : `${PRESETS.find((x) => x.value === preset)?.days}d`;
  const delta = health.completedDelta;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <StatCard
        label="Active Issues"
        value={health.activeIssues}
        accent="blue"
      />
      <StatCard
        label={`Completed — ${periodLabel}`}
        value={health.completedThisWeek}
        trend={delta}
        trendLabel="vs prior"
        accent="green"
      />
      <StatCard
        label="SLA Violations"
        value={health.slaViolations}
        alert={health.slaViolations > 0}
        accent={health.slaViolations > 0 ? "red" : "default"}
      />
      <StatCard
        label="Unmapped Statuses"
        value={health.unmappedWarnings}
        alert={health.unmappedWarnings > 0}
        accent={health.unmappedWarnings > 0 ? "amber" : "default"}
      />
      <StatCard
        label="Projects Synced (24h)"
        value={health.projectsSyncedToday}
        accent="default"
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  trend,
  trendLabel,
  alert,
  accent = "default",
}: {
  label: string;
  value: number;
  trend?: number;
  trendLabel?: string;
  alert?: boolean;
  accent?: "default" | "blue" | "green" | "red" | "amber";
}) {
  const accentClass = {
    default: "from-border/60 to-transparent",
    blue: "from-[var(--chart-1)]/50 to-[var(--chart-2)]/20",
    green: "from-emerald-500/50 to-emerald-400/20",
    red: "from-destructive/60 to-destructive/20",
    amber: "from-amber-500/60 to-amber-400/20",
  }[accent];

  return (
    <Card
      className={cn(
        "relative gap-1.5 overflow-hidden p-5",
        alert && "ring-destructive/20 bg-destructive/5 dark:bg-destructive/10"
      )}
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r",
          accentClass
        )}
      />
      <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {alert && <RiErrorWarningLine className="size-3 shrink-0 text-destructive" />}
        {label}
      </p>
      <p
        className={cn(
          "text-3xl font-semibold tabular-nums leading-none",
          alert ? "text-destructive" : "text-foreground"
        )}
      >
        {value}
      </p>
      {trend !== undefined && (
        <p
          className={cn(
            "flex items-center gap-0.5 text-xs",
            trend > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : trend < 0
              ? "text-destructive"
              : "text-muted-foreground"
          )}
        >
          {trend > 0 ? (
            <RiArrowUpLine className="size-3" />
          ) : trend < 0 ? (
            <RiArrowDownLine className="size-3" />
          ) : null}
          {trend > 0 ? "+" : ""}{trend}%
          {trendLabel && (
            <span className="ml-0.5 text-muted-foreground">{trendLabel}</span>
          )}
        </p>
      )}
    </Card>
  );
}

// ---------- Throughput Chart ----------

function ThroughputChart({ throughput }: { throughput: OrgDashboardData["throughput"] }) {
  const chartDataMap = new Map<string, Record<string, number | string>>();
  const projects = new Set<string>();

  throughput.forEach((row) => {
    const weekStr = format(new Date(row.week), "MMM d");
    if (!chartDataMap.has(weekStr)) chartDataMap.set(weekStr, { name: weekStr });
    const entry = chartDataMap.get(weekStr)!;
    const key = sanitize(row.project_name);
    entry[key] = ((entry[key] as number) ?? 0) + row.completed;
    projects.add(row.project_name);
  });

  const projectList = Array.from(projects);
  const chartConfig: ChartConfig = Object.fromEntries(
    projectList.map((proj, i) => [
      sanitize(proj),
      { label: proj, color: CHART_COLORS[i % CHART_COLORS.length] },
    ])
  );
  const chartData = Array.from(chartDataMap.values());

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>Weekly Throughput</CardTitle>
        <CardAction>
          <ChartInfo description="Issues completed per week, stacked by project. Rising bars mean faster delivery. A sudden drop can signal a blocker, sprint boundary, or resourcing gap." />
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col pb-3">
        {chartData.length > 0 ? (
          <ChartContainer config={chartConfig} className="h-[230px] w-full">
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11 }}
                allowDecimals={false}
              />
              <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
              {projectList.map((proj, i) => (
                <Bar
                  key={proj}
                  dataKey={sanitize(proj)}
                  stackId="a"
                  fill={`var(--color-${sanitize(proj)})`}
                  radius={i === projectList.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ChartContainer>
        ) : (
          <EmptyState message="No throughput data for this period" />
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Issue Type Mix ----------

function IssueTypeMix({ issueTypeMix }: { issueTypeMix: OrgDashboardData["issueTypeMix"] }) {
  const merged = issueTypeMix.reduce<
    { issue_type: string; count: number; pct: number }[]
  >((acc, row) => {
    const key = row.issue_type === "Subtask" ? "Sub-task" : row.issue_type;
    const existing = acc.find((r) => r.issue_type === key);
    if (existing) {
      existing.count += row.count;
      existing.pct += row.pct;
    } else {
      acc.push({ issue_type: key, count: row.count, pct: row.pct });
    }
    return acc;
  }, []);

  const total = merged.reduce((s, r) => s + r.count, 0);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>Active Issue Mix</CardTitle>
        <CardAction>
          <ChartInfo description="Breakdown of active issues by type. A high Bug share signals fire-fighting mode. Healthy teams stay below 20% bugs." />
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col items-center justify-between gap-4 pb-3">
        {merged.length === 0 ? (
          <EmptyState message="No active issues" />
        ) : (
          <>
            <PieChart width={156} height={156}>
              <Pie
                data={merged}
                dataKey="count"
                nameKey="issue_type"
                cx="50%"
                cy="50%"
                innerRadius={44}
                outerRadius={70}
                strokeWidth={0}
              >
                {merged.map((entry) => (
                  <Cell
                    key={entry.issue_type}
                    fill={ISSUE_TYPE_COLORS[entry.issue_type] ?? "var(--chart-5)"}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => {
                  const n = Number(value);
                  return [`${n} (${((n / total) * 100).toFixed(1)}%)`, ""] as [string, string];
                }}
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  color: "var(--foreground)",
                }}
              />
            </PieChart>

            <div className="w-full space-y-1.5">
              {merged.map((row) => (
                <div
                  key={row.issue_type}
                  className="flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-2 shrink-0 rounded-full"
                      style={{
                        background:
                          ISSUE_TYPE_COLORS[row.issue_type] ?? "var(--chart-5)",
                      }}
                    />
                    <span
                      className={cn(
                        "font-medium",
                        row.issue_type === "Bug" ? "text-destructive" : "text-foreground"
                      )}
                    >
                      {row.issue_type}
                    </span>
                  </div>
                  <span className="tabular-nums text-muted-foreground">
                    {row.count}{" "}
                    <span className="text-[10px]">
                      ({((row.count / total) * 100).toFixed(0)}%)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- WIP Heatmap ----------

function WipHeatmap({ wipHeatmap }: { wipHeatmap: OrgDashboardData["wipHeatmap"] }) {
  const statuses = ["TODO", "IN_PROGRESS", "IN_REVIEW", "IN_QA"] as const;
  const statusLabels: Record<string, string> = {
    TODO: "Todo",
    IN_PROGRESS: "In Prog",
    IN_REVIEW: "Review",
    IN_QA: "QA",
  };

  const dataByProject = new Map<string, Record<string, number>>();
  wipHeatmap.forEach((row) => {
    if (!statuses.includes(row.canonical_status as (typeof statuses)[number])) return;
    if (!dataByProject.has(row.name)) {
      dataByProject.set(row.name, { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, IN_QA: 0 });
    }
    dataByProject.get(row.name)![row.canonical_status] = row.issue_count;
  });

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>WIP Heatmap</CardTitle>
        <CardAction>
          <ChartInfo description="Work-in-progress counts per project across workflow stages. Large numbers in 'In Progress' or 'In Review' often indicate a bottleneck forming upstream." />
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0 pb-1">
        {dataByProject.size === 0 ? (
          <div className="flex-1 flex items-center justify-center px-5 pb-4">
            <EmptyState message="No active WIP found" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Project
                  </th>
                  {statuses.map((s) => (
                    <th
                      key={s}
                      className="px-2 py-2.5 text-center font-medium text-muted-foreground"
                    >
                      {statusLabels[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {Array.from(dataByProject.entries()).map(([project, counts]) => (
                  <tr key={project}>
                    <td className="max-w-[100px] truncate px-4 py-2.5 font-medium text-foreground">
                      {project}
                    </td>
                    {statuses.map((s) => {
                      const val = counts[s];
                      const intensity = Math.min(val / 15, 1);
                      return (
                        <td key={s} className="px-2 py-1.5 text-center">
                          <span
                            className={cn(
                              "inline-flex h-6 w-9 items-center justify-center rounded font-mono text-[11px] font-semibold tabular-nums",
                              val === 0
                                ? "text-muted-foreground/30"
                                : intensity > 0.5
                                ? "text-white"
                                : "text-foreground"
                            )}
                            style={{
                              background:
                                val > 0
                                  ? `color-mix(in oklch, var(--chart-1) ${Math.round(
                                      Math.max(intensity, 0.15) * 65 + 12
                                    )}%, transparent)`
                                  : undefined,
                            }}
                          >
                            {val === 0 ? "—" : val}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Flow Efficiency ----------

function FlowEfficiencyBars({
  flowEfficiency,
}: {
  flowEfficiency: OrgDashboardData["flowEfficiency"];
}) {
  const sorted = [...flowEfficiency].sort(
    (a, b) => b.flow_efficiency_pct - a.flow_efficiency_pct
  );

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>Flow Efficiency</CardTitle>
        <CardAction>
          <ChartInfo description="Percentage of total time an issue was actively being worked on rather than waiting. Below 20% means most time is spent queued." />
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 space-y-3.5 pb-4">
        {sorted.length === 0 && (
          <EmptyState message="No flow data for this period" />
        )}
        {sorted.map((row) => {
          const pct = row.flow_efficiency_pct;
          const barColor =
            pct > 40
              ? "bg-emerald-500 dark:bg-emerald-400"
              : pct < 20
              ? "bg-destructive"
              : "bg-amber-400 dark:bg-amber-300";

          return (
            <div key={row.project_id} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="max-w-[120px] truncate font-medium text-foreground">
                  {row.project_name}
                </span>
                <span
                  className={cn(
                    "tabular-nums font-semibold",
                    pct > 40
                      ? "text-emerald-600 dark:text-emerald-400"
                      : pct < 20
                      ? "text-destructive"
                      : "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {pct}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all duration-500", barColor)}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------- Stale Issues Radar ----------

function StaleIssuesRadar({
  staleIssues,
}: {
  staleIssues: OrgDashboardData["staleIssues"];
}) {
  const sorted = [...staleIssues].sort((a, b) => b.stale_count - a.stale_count);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>Stale Issues — &gt;7d</CardTitle>
        <CardAction>
          <ChartInfo description="Projects with issues that have had no status change in over 7 days. These are likely blocked, forgotten, or silently deprioritised." />
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 pb-3">
        {sorted.length === 0 ? (
          <EmptyState message="No stale issues" icon="clean" />
        ) : (
          <div className="divide-y divide-border/50">
            {sorted.map((row) => (
              <div
                key={row.project_id}
                className="flex items-center justify-between py-2.5 first:pt-0"
              >
                <span className="text-xs font-medium text-foreground">{row.name}</span>
                <Badge variant="outline" className="gap-1 font-mono tabular-nums">
                  <RiTimeLine className="size-2.5 text-amber-500" />
                  {row.stale_count}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Cycle Time Table ----------

function CycleTimeTable({ cycleTime }: { cycleTime: OrgDashboardData["cycleTime"] }) {
  const sorted = [...cycleTime].sort((a, b) => b.p90_hours - a.p90_hours);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>Cycle Time — Hours</CardTitle>
        <CardAction>
          <ChartInfo description="How long issues take from first active work to completion. P50 is your typical delivery time; P90 reveals worst-case delays." />
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0 pb-1">
        {sorted.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-5 pb-4">
            <EmptyState message="No cycle time data for this period" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Project
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                    P50 Median
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                    P75
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-destructive/80">
                    P90 Worst
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {sorted.map((row) => (
                  <tr
                    key={row.project_id}
                    className="transition-colors hover:bg-muted/20"
                  >
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      {row.project_name}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {row.p50_hours}h
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {row.p75_hours}h
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-destructive">
                      {row.p90_hours}h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- SLA Violations ----------

function SlaViolationCard({
  totalViolations,
  topRules,
}: {
  totalViolations: number;
  topRules: OrgDashboardData["slaTopRules"];
}) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>SLA Violations</CardTitle>
        <CardAction>
          <ChartInfo description="Issues that breached a defined SLA rule. The most-triggered rules show which policies are hardest to meet across your organisation." />
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col space-y-5 pb-4">
        <div className="flex items-end gap-2">
          <span
            className={cn(
              "text-5xl font-semibold tabular-nums leading-none",
              totalViolations > 0 ? "text-destructive" : "text-foreground"
            )}
          >
            {totalViolations}
          </span>
          <span className="mb-1 text-xs text-muted-foreground">active across org</span>
        </div>

        <div className="flex-1">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Most Triggered
          </p>
          {topRules.length === 0 ? (
            <p className="text-xs text-muted-foreground">No rules triggered in this period.</p>
          ) : (
            <div className="space-y-2.5">
              {topRules.map((rule, idx) => (
                <div key={idx} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">
                      {rule.rule_name}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {rule.project_name}
                    </p>
                  </div>
                  <Badge variant="destructive" className="shrink-0 tabular-nums">
                    {rule.trigger_count}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Developer Workload ----------

function DevWorkloadTable({
  devWorkload,
}: {
  devWorkload: OrgDashboardData["devWorkload"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Developer Workload</CardTitle>
        <CardAction>
          <ChartInfo description="Active issues per developer, broken down by priority (P1–P3) and current workflow stage. Median cycle time shows how fast each developer typically moves through active work." />
        </CardAction>
      </CardHeader>
      <CardContent className="p-0 pb-1">
        {devWorkload.length === 0 ? (
          <div className="px-5 pb-4">
            <EmptyState message="No active workload data" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Developer
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">
                    Active
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-destructive/80">
                    P1
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-amber-600 dark:text-amber-400">
                    P2
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">
                    P3
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">
                    In Progress
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">
                    In Review
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">
                    In QA
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    Median Cycle
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {devWorkload.map((row) => (
                  <tr
                    key={row.assignee_name}
                    className="transition-colors hover:bg-muted/20"
                  >
                    <td className="max-w-[160px] truncate px-4 py-2.5 font-medium text-foreground">
                      {row.assignee_name}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums font-semibold text-foreground">
                      {row.active_total}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums">
                      {row.p1 > 0 ? (
                        <span className="inline-flex h-5 w-6 items-center justify-center rounded bg-destructive/10 text-[11px] font-bold text-destructive">
                          {row.p1}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums">
                      {row.p2 > 0 ? (
                        <span className="inline-flex h-5 w-6 items-center justify-center rounded bg-amber-100 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          {row.p2}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
                      {row.p3 > 0 ? row.p3 : <span className="text-muted-foreground/30">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
                      {row.in_progress > 0 ? row.in_progress : <span className="text-muted-foreground/30">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
                      {row.in_review > 0 ? row.in_review : <span className="text-muted-foreground/30">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
                      {row.in_qa > 0 ? row.in_qa : <span className="text-muted-foreground/30">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {Number(row.p50_cycle_hours) > 0 ? (
                        `${row.p50_cycle_hours}h`
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Developer Velocity ----------

function DevVelocityTable({
  devVelocity,
  preset,
}: {
  devVelocity: OrgDashboardData["devVelocity"];
  preset: Preset;
}) {
  const maxThisWeek = Math.max(...devVelocity.map((d) => d.this_week), 1);
  const priorLabel = preset === "custom" ? "prior" : "last";

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>Developer Velocity — Current vs Prior Period</CardTitle>
        <CardAction>
          <ChartInfo description="Issues completed by each developer in the current period vs the prior period of equal length. Arrows indicate velocity trend." />
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 space-y-2.5 pb-4">
        {devVelocity.length === 0 ? (
          <EmptyState message="No completions in this period" />
        ) : (
          devVelocity.map((row) => (
            <div key={row.assignee_name} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="max-w-[160px] truncate font-medium text-foreground">
                  {row.assignee_name}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {row.last_week} {priorLabel}
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-0.5 font-semibold tabular-nums",
                      row.delta > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : row.delta < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                    )}
                  >
                    {row.delta > 0 ? (
                      <RiArrowUpLine className="size-3" />
                    ) : row.delta < 0 ? (
                      <RiArrowDownLine className="size-3" />
                    ) : null}
                    {row.this_week}
                  </span>
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[var(--chart-1)] transition-all duration-500"
                  style={{ width: `${(row.this_week / maxThisWeek) * 100}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Period Summary ----------

function PeriodSummary({
  data,
  preset,
  range,
}: {
  data: OrgDashboardData;
  preset: Preset;
  range: DateRange;
}) {
  const days = preset === "custom"
    ? Math.round((range.to.getTime() - range.from.getTime()) / 86400000)
    : PRESETS.find((x) => x.value === preset)?.days ?? 30;

  const avgP50 =
    data.cycleTime.length > 0
      ? Math.round(
          (data.cycleTime.reduce((s, r) => s + Number(r.p50_hours), 0) /
            data.cycleTime.length) *
            10
        ) / 10
      : null;

  const avgFlowEff =
    data.flowEfficiency.length > 0
      ? Math.round(
          data.flowEfficiency.reduce((s, r) => s + r.flow_efficiency_pct, 0) /
            data.flowEfficiency.length
        )
      : null;

  const contributors = data.devWorkload.length;

  const stats: { label: string; value: string | number | null; icon: React.ReactNode }[] = [
    {
      label: "Closed in period",
      value: data.orgHealth.completedThisWeek,
      icon: <RiInboxLine className="size-3.5 text-muted-foreground" />,
    },
    {
      label: "Org P50 cycle time",
      value: avgP50 !== null ? `${avgP50}h` : null,
      icon: <RiTimeLine className="size-3.5 text-muted-foreground" />,
    },
    {
      label: "Avg flow efficiency",
      value: avgFlowEff !== null ? `${avgFlowEff}%` : null,
      icon: <RiFlowChart className="size-3.5 text-muted-foreground" />,
    },
    {
      label: "Active contributors",
      value: contributors,
      icon: <RiTeamLine className="size-3.5 text-muted-foreground" />,
    },
  ];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>Period Summary</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between gap-1 pb-4">
        <div className="space-y-4">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {stat.icon}
                <span className="text-[11px] text-muted-foreground truncate">
                  {stat.label}
                </span>
              </div>
              <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                {stat.value !== null ? stat.value : (
                  <span className="text-muted-foreground/30 text-xs font-normal">—</span>
                )}
              </span>
            </div>
          ))}
        </div>

        {data.orgHealth.completedDelta !== 0 && (
          <div
            className={cn(
              "mt-2 flex items-center gap-1.5 rounded-md px-2.5 py-2 text-[11px] font-medium",
              data.orgHealth.completedDelta > 0
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-destructive/10 text-destructive"
            )}
          >
            {data.orgHealth.completedDelta > 0 ? (
              <RiArrowUpLine className="size-3 shrink-0" />
            ) : (
              <RiArrowDownLine className="size-3 shrink-0" />
            )}
            {data.orgHealth.completedDelta > 0 ? "+" : ""}
            {data.orgHealth.completedDelta}% vs prior period
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/50 tabular-nums">
          {days}d window · {format(range.from, "MMM d")} – {format(range.to, "MMM d, yy")}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------- Shared ----------

function EmptyState({
  message,
  icon = "default",
}: {
  message: string;
  icon?: "default" | "clean";
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8">
      <RiInboxLine className="size-5 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      {/* Row 1 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-lg" />
        ))}
      </div>
      {/* Row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="md:col-span-2 h-[300px] rounded-lg" />
        <Skeleton className="h-[300px] rounded-lg" />
      </div>
      {/* Row 3 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-[260px] rounded-lg" />
        <Skeleton className="h-[260px] rounded-lg" />
        <Skeleton className="h-[260px] rounded-lg" />
      </div>
      {/* Row 4 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="md:col-span-2 h-[240px] rounded-lg" />
        <Skeleton className="h-[240px] rounded-lg" />
      </div>
      {/* Row 5 */}
      <Skeleton className="h-[320px] rounded-lg" />
      {/* Row 6 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="md:col-span-2 h-[260px] rounded-lg" />
        <Skeleton className="h-[260px] rounded-lg" />
      </div>
    </div>
  );
}

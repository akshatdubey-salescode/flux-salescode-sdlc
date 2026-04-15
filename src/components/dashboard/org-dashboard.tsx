"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartInfo } from "@/components/ui/chart-info";
import { Badge } from "@/components/ui/badge";
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
} from "@remixicon/react";

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

const sanitize = (s: string) =>
  `k_${s.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

export function OrgDashboard() {
  const [data, setData] = useState<OrgDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics/dashboard")
      .then((res) => res.json())
      .then((data) => {
        setData(data);
        setLoading(false);
      });
  }, []);

  if (loading || !data) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-5 pb-8">
      <OrgHealthStrip health={data.orgHealth} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2">
          <ThroughputChart throughput={data.throughput} />
        </div>
        <WipHeatmap wipHeatmap={data.wipHeatmap} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2">
          <CycleTimeTable cycleTime={data.cycleTime} />
        </div>
        <FlowEfficiencyBars flowEfficiency={data.flowEfficiency} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SlaViolationCard
          totalViolations={data.orgHealth.slaViolations}
          topRules={data.slaTopRules}
        />
        <StaleIssuesRadar staleIssues={data.staleIssues} />
      </div>

      <DevWorkloadTable devWorkload={data.devWorkload} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2">
          <DevVelocityTable devVelocity={data.devVelocity} />
        </div>
        <IssueTypeMix issueTypeMix={data.issueTypeMix} />
      </div>
    </div>
  );
}

function OrgHealthStrip({ health }: { health: OrgDashboardData["orgHealth"] }) {
  const delta = health.completedDelta;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <StatCard label="Active Issues" value={health.activeIssues} />
      <StatCard
        label="Completed This Week"
        value={health.completedThisWeek}
        trend={delta}
        trendLabel="vs last wk"
      />
      <StatCard
        label="SLA Violations"
        value={health.slaViolations}
        alert={health.slaViolations > 0}
      />
      <StatCard
        label="Unmapped Statuses"
        value={health.unmappedWarnings}
        alert={health.unmappedWarnings > 0}
      />
      <StatCard label="Projects Synced (24h)" value={health.projectsSyncedToday} />
    </div>
  );
}

function StatCard({
  label,
  value,
  trend,
  trendLabel,
  alert,
}: {
  label: string;
  value: number;
  trend?: number;
  trendLabel?: string;
  alert?: boolean;
}) {
  return (
    <Card
      className={cn(
        "gap-1.5 p-5",
        alert && "ring-destructive/30 bg-destructive/5 dark:bg-destructive/10"
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {alert && <RiErrorWarningLine className="size-3 shrink-0 text-destructive" />}
        {label}
      </p>
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums",
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
          {trend > 0 ? "+" : ""}{trend}%{trendLabel ? ` ${trendLabel}` : ""}
        </p>
      )}
    </Card>
  );
}

function ThroughputChart({ throughput }: { throughput: OrgDashboardData["throughput"] }) {
  const chartDataMap = new Map<string, Record<string, number | string>>();
  const projects = new Set<string>();

  throughput.forEach((row) => {
    const weekStr = format(new Date(row.week), "MMM d");
    if (!chartDataMap.has(weekStr)) {
      chartDataMap.set(weekStr, { name: weekStr });
    }
    const entry = chartDataMap.get(weekStr)!;
    const key = sanitize(row.project_name);
    entry[key] = ((entry[key] as number) ?? 0) + row.completed;
    projects.add(row.project_name);
  });

  const projectList = Array.from(projects);
  const chartColors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ];

  const chartConfig: ChartConfig = Object.fromEntries(
    projectList.map((proj, i) => [
      sanitize(proj),
      { label: proj, color: chartColors[i % chartColors.length] },
    ])
  );

  const chartData = Array.from(chartDataMap.values());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly Throughput</CardTitle>
        <CardAction>
          <ChartInfo description="Issues completed per week, stacked by project. Rising bars mean faster delivery. A sudden drop can signal a blocker, sprint boundary, or resourcing gap." />
        </CardAction>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
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
          <EmptyState message="No throughput data yet" />
        )}
      </CardContent>
    </Card>
  );
}

function WipHeatmap({ wipHeatmap }: { wipHeatmap: OrgDashboardData["wipHeatmap"] }) {
  const statuses = ["TODO", "IN_PROGRESS", "IN_REVIEW", "IN_QA"] as const;
  const statusLabels: Record<string, string> = {
    TODO: "Todo",
    IN_PROGRESS: "In Progress",
    IN_REVIEW: "In Review",
    IN_QA: "In QA",
  };

  const dataByProject = new Map<string, Record<string, number>>();
  wipHeatmap.forEach((row) => {
    if (!statuses.includes(row.canonical_status as typeof statuses[number])) return;
    if (!dataByProject.has(row.name)) {
      dataByProject.set(row.name, { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, IN_QA: 0 });
    }
    dataByProject.get(row.name)![row.canonical_status] = row.issue_count;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>WIP Heatmap</CardTitle>
        <CardAction>
          <ChartInfo description="Work-in-progress counts per project across workflow stages. Large numbers in 'In Progress' or 'In Review' often indicate a bottleneck forming upstream." />
        </CardAction>
      </CardHeader>
      <CardContent className="p-0 pb-1">
        {dataByProject.size === 0 ? (
          <div className="px-5 pb-4">
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
                  <tr key={project} className="group">
                    <td className="px-4 py-2.5 font-medium text-foreground max-w-[120px] truncate">
                      {project}
                    </td>
                    {statuses.map((s) => {
                      const val = counts[s];
                      const intensity = Math.min(val / 15, 1);
                      return (
                        <td key={s} className="px-2 py-1.5 text-center">
                          <span
                            className={cn(
                              "inline-flex items-center justify-center w-9 h-6 rounded font-mono tabular-nums font-semibold",
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

function CycleTimeTable({ cycleTime }: { cycleTime: OrgDashboardData["cycleTime"] }) {
  const sorted = [...cycleTime].sort((a, b) => b.p90_hours - a.p90_hours);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cycle Time — Hours</CardTitle>
        <CardAction>
          <ChartInfo description="How long issues take from first active work to completion. P50 is your typical delivery time; P90 reveals worst-case delays. Sort by P90 to find the slowest projects." />
        </CardAction>
      </CardHeader>
      <CardContent className="p-0 pb-1">
        {sorted.length === 0 ? (
          <div className="px-5 pb-4">
            <EmptyState message="No cycle time data available" />
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
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-destructive/80">
                    P90 Worst
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {sorted.map((row) => (
                  <tr
                    key={row.project_id}
                    className="hover:bg-muted/20 transition-colors"
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

function FlowEfficiencyBars({
  flowEfficiency,
}: {
  flowEfficiency: OrgDashboardData["flowEfficiency"];
}) {
  const sorted = [...flowEfficiency].sort(
    (a, b) => b.flow_efficiency_pct - a.flow_efficiency_pct
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Flow Efficiency</CardTitle>
        <CardAction>
          <ChartInfo description="Percentage of total time an issue was actively being worked on rather than waiting. Below 20% means most time is spent queued — a sign of too much WIP or blocked work." />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {sorted.length === 0 && <EmptyState message="No data" />}
        {sorted.map((row) => {
          const pct = row.flow_efficiency_pct;
          const color =
            pct > 40
              ? "bg-emerald-500 dark:bg-emerald-400"
              : pct < 20
              ? "bg-destructive"
              : "bg-amber-400 dark:bg-amber-300";

          return (
            <div key={row.project_id} className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="font-medium text-foreground truncate max-w-[120px]">
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
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all duration-500", color)}
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

function SlaViolationCard({
  totalViolations,
  topRules,
}: {
  totalViolations: number;
  topRules: OrgDashboardData["slaTopRules"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>SLA Violations</CardTitle>
        <CardAction>
          <ChartInfo description="Issues that breached a defined SLA rule. The most-triggered rules show which policies are hardest to meet across your organisation." />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-end gap-2">
          <span
            className={cn(
              "text-4xl font-semibold tabular-nums",
              totalViolations > 0 ? "text-destructive" : "text-foreground"
            )}
          >
            {totalViolations}
          </span>
          <span className="text-xs text-muted-foreground mb-1.5">
            active across org
          </span>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3">
            Most Triggered — 30d
          </p>
          {topRules.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No rules triggered recently.
            </p>
          ) : (
            <div className="space-y-2.5">
              {topRules.map((rule, idx) => (
                <div
                  key={idx}
                  className="flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {rule.rule_name}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
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

function StaleIssuesRadar({
  staleIssues,
}: {
  staleIssues: OrgDashboardData["staleIssues"];
}) {
  const sorted = [...staleIssues].sort((a, b) => b.stale_count - a.stale_count);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stale Issues Radar — &gt;7 Days</CardTitle>
        <CardAction>
          <ChartInfo description="Projects with issues that have had no status change in over 7 days. These are likely blocked, forgotten, or silently deprioritised and need triage." />
        </CardAction>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <EmptyState message="No stale issues" />
        ) : (
          <div className="divide-y divide-border/50">
            {sorted.map((row) => (
              <div
                key={row.project_id}
                className="flex items-center justify-between py-2.5 first:pt-0"
              >
                <span className="text-xs font-medium text-foreground">{row.name}</span>
                <Badge variant="outline" className="gap-1 tabular-nums font-mono">
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
          <ChartInfo description="Active issues per developer, broken down by priority (P1–P3) and current workflow stage. P1s in red signal high-urgency items. Median cycle time shows how fast each developer typically moves through active work." />
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
                  <tr key={row.assignee_name} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-foreground max-w-[160px] truncate">
                      {row.assignee_name}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums font-semibold text-foreground">
                      {row.active_total}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums">
                      {row.p1 > 0 ? (
                        <span className="inline-flex items-center justify-center w-6 h-5 rounded text-[11px] font-bold bg-destructive/10 text-destructive">
                          {row.p1}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums">
                      {row.p2 > 0 ? (
                        <span className="inline-flex items-center justify-center w-6 h-5 rounded text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
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
                      {Number(row.p50_cycle_hours) > 0 ? `${row.p50_cycle_hours}h` : <span className="text-muted-foreground/30">—</span>}
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

function DevVelocityTable({
  devVelocity,
}: {
  devVelocity: OrgDashboardData["devVelocity"];
}) {
  const maxThisWeek = Math.max(...devVelocity.map((d) => d.this_week), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Developer Velocity — This Week vs Last</CardTitle>
        <CardAction>
          <ChartInfo description="Issues completed by each developer this week vs the prior week. The bar shows this week's output relative to the top performer. Arrows indicate whether velocity improved or declined." />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {devVelocity.length === 0 ? (
          <EmptyState message="No completions in the last 2 weeks" />
        ) : (
          devVelocity.map((row) => (
            <div key={row.assignee_name} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-foreground truncate max-w-[160px]">
                  {row.assignee_name}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-muted-foreground text-[11px]">
                    {row.last_week} last wk
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
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
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

const ISSUE_TYPE_COLORS: Record<string, string> = {
  Bug: "var(--destructive)",
  Story: "var(--chart-2)",
  Task: "var(--chart-1)",
  "Sub-task": "var(--chart-3)",
  Subtask: "var(--chart-3)",
  Epic: "var(--chart-4)",
};

function IssueTypeMix({
  issueTypeMix,
}: {
  issueTypeMix: OrgDashboardData["issueTypeMix"];
}) {
  // Merge "Sub-task" and "Subtask" into one bucket
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
    <Card>
      <CardHeader>
        <CardTitle>Active Issue Mix</CardTitle>
        <CardAction>
          <ChartInfo description="Breakdown of active issues by type. A high Bug share signals the team is in fire-fighting mode rather than building features. Healthy teams typically stay below 20% bugs." />
        </CardAction>
      </CardHeader>
      <CardContent>
        {merged.length === 0 ? (
          <EmptyState message="No data" />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <PieChart width={160} height={160}>
              <Pie
                data={merged}
                dataKey="count"
                nameKey="issue_type"
                cx="50%"
                cy="50%"
                innerRadius={46}
                outerRadius={72}
                strokeWidth={0}
              >
                {merged.map((entry) => (
                  <Cell
                    key={entry.issue_type}
                    fill={
                      ISSUE_TYPE_COLORS[entry.issue_type] ?? "var(--chart-5)"
                    }
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
                      className="inline-block size-2 rounded-full shrink-0"
                      style={{
                        background:
                          ISSUE_TYPE_COLORS[row.issue_type] ??
                          "var(--chart-5)",
                      }}
                    />
                    <span
                      className={cn(
                        "font-medium",
                        row.issue_type === "Bug"
                          ? "text-destructive"
                          : "text-foreground"
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5 pb-8">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Skeleton className="md:col-span-2 h-[300px] rounded-lg" />
        <Skeleton className="h-[300px] rounded-lg" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Skeleton className="md:col-span-2 h-[220px] rounded-lg" />
        <Skeleton className="h-[220px] rounded-lg" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Skeleton className="h-[200px] rounded-lg" />
        <Skeleton className="h-[200px] rounded-lg" />
      </div>
      <Skeleton className="h-[340px] rounded-lg" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Skeleton className="md:col-span-2 h-[280px] rounded-lg" />
        <Skeleton className="h-[280px] rounded-lg" />
      </div>
    </div>
  );
}

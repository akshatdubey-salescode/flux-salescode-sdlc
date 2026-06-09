"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartInfo } from "@/components/ui/chart-info";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  RiArrowUpLine,
  RiArrowDownLine,
  RiErrorWarningLine,
  RiInboxLine,
  RiExternalLinkLine,
} from "@remixicon/react";
import type { OverviewResponse, ProjectHealth } from "@/app/api/analytics/overview/route";

const flowConfig: ChartConfig = {
  completed: { label: "Completed", color: "var(--chart-1)" },
  created: { label: "Created", color: "var(--chart-3)" },
};

const cycleConfig: ChartConfig = {
  p50Hours: { label: "Median hours", color: "var(--chart-2)" },
};

export function ExecutiveDashboard() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    fetch(`/api/analytics/overview?now=${encodeURIComponent(nowStr)}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  if (loading || !data) return <DashboardSkeleton />;

  const { kpis } = data;

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Active Work" value={kpis.totalActive} sub={`${kpis.activeWip} in progress`} />
        <KpiCard
          label="Completed · 30d"
          value={kpis.completed30d}
          trend={kpis.completedDeltaPct}
          trendLabel="vs prior 30d"
        />
        <KpiCard label="At Risk" value={kpis.atRisk} tone={kpis.atRisk > 0 ? "amber" : undefined} />
        <KpiCard label="Overdue" value={kpis.overdue} alert={kpis.overdue > 0} />
        <KpiCard
          label="On-Time Rate"
          value={kpis.onTimeRatePct}
          suffix="%"
          tone={
            kpis.onTimeRatePct == null
              ? undefined
              : kpis.onTimeRatePct >= 80
              ? "green"
              : kpis.onTimeRatePct >= 60
              ? "amber"
              : "red"
          }
          sub="last 90d delivered"
        />
        <KpiCard
          label="Unplanned"
          value={kpis.unplannedPct}
          suffix="%"
          tone={kpis.unplannedPct >= 30 ? "amber" : undefined}
          sub={`${kpis.unplanned} without dates`}
        />
      </div>

      {/* ── Flow + Cycle time ── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DeliveryFlow flow={data.flow} />
        </div>
        <CycleTime cycle={data.cycleTimeByType} />
      </div>

      {/* ── Project health + Aging WIP ── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ProjectHealthTable projects={data.projectHealth} />
        </div>
        <AgingWip stale={data.staleWip} />
      </div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  trend,
  trendLabel,
  suffix,
  alert,
  tone,
}: {
  label: string;
  value: number | null;
  sub?: string;
  trend?: number | null;
  trendLabel?: string;
  suffix?: string;
  alert?: boolean;
  tone?: "green" | "amber" | "red";
}) {
  const toneClass =
    tone === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "red"
      ? "text-destructive"
      : alert
      ? "text-destructive"
      : "text-foreground";

  return (
    <Card
      className={cn(
        "gap-1.5 p-4",
        alert && "ring-destructive/30 bg-destructive/5 dark:bg-destructive/10"
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {alert && <RiErrorWarningLine className="size-3 shrink-0 text-destructive" />}
        {label}
      </p>
      <p className={cn("text-3xl font-semibold tabular-nums", toneClass)}>
        {value == null ? "—" : value}
        {value != null && suffix ? (
          <span className="text-lg font-medium text-muted-foreground">{suffix}</span>
        ) : null}
      </p>
      {trend !== undefined && trend !== null ? (
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
          {trend > 0 ? "+" : ""}
          {trend}%{trendLabel ? ` ${trendLabel}` : ""}
        </p>
      ) : sub ? (
        <p className="text-xs text-muted-foreground">{sub}</p>
      ) : null}
    </Card>
  );
}

// ── Delivery Flow (created vs completed) ────────────────────────────────────────

function DeliveryFlow({ flow }: { flow: OverviewResponse["flow"] }) {
  const chartData = flow.map((row) => ({
    name: format(new Date(row.week + "T00:00:00"), "MMM d"),
    completed: row.completed,
    created: row.created,
  }));

  const totalCreated = flow.reduce((s, r) => s + r.created, 0);
  const totalCompleted = flow.reduce((s, r) => s + r.completed, 0);
  const net = totalCompleted - totalCreated;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery Flow</CardTitle>
        <CardAction>
          <ChartInfo description="Issues created vs completed each week across all projects. When completed stays above created, the backlog is shrinking. When created runs ahead, work is piling up faster than the org can clear it." />
        </CardAction>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <>
            <div className="mb-3 flex items-center gap-4 text-xs">
              <span className="text-muted-foreground">
                Last 12 wks:{" "}
                <span className="font-semibold text-foreground tabular-nums">{totalCompleted}</span> completed
                {" · "}
                <span className="font-semibold text-foreground tabular-nums">{totalCreated}</span> created
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 font-semibold tabular-nums",
                  net >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive"
                )}
              >
                {net >= 0 ? <RiArrowDownLine className="size-3" /> : <RiArrowUpLine className="size-3" />}
                {net >= 0 ? "Backlog ↓ " : "Backlog ↑ "}
                {Math.abs(net)}
              </span>
            </div>
            <ChartContainer config={flowConfig} className="h-[240px] w-full">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="completed" fill="var(--color-completed)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="created" fill="var(--color-created)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </>
        ) : (
          <EmptyState message="Not enough delivery history yet" />
        )}
      </CardContent>
    </Card>
  );
}

// ── Cycle time by type ──────────────────────────────────────────────────────────

function CycleTime({ cycle }: { cycle: OverviewResponse["cycleTimeByType"] }) {
  const chartData = cycle.map((row) => ({
    name: row.issueType,
    p50Hours: row.p50Hours,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cycle Time</CardTitle>
        <CardAction>
          <ChartInfo description="Median active working hours (in-progress, review, QA) from start to completion, by issue type, over the last 90 days. Longer bars are slower-moving work types worth investigating." />
        </CardAction>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <ChartContainer config={cycleConfig} className="h-[240px] w-full">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11 }}
                width={80}
              />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <Bar dataKey="p50Hours" fill="var(--color-p50Hours)" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ChartContainer>
        ) : (
          <EmptyState message="Not enough completed work to measure" />
        )}
      </CardContent>
    </Card>
  );
}

// ── Project health leaderboard ───────────────────────────────────────────────────

const HEALTH_BADGE: Record<ProjectHealth["health"], { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
  critical: { label: "Critical", variant: "destructive", className: "" },
  watch: { label: "Watch", variant: "secondary", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  healthy: { label: "Healthy", variant: "secondary", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
};

function ProjectHealthTable({ projects }: { projects: ProjectHealth[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Health</CardTitle>
        <CardAction>
          <ChartInfo description="Projects ranked by delivery risk (overdue counts double, plus at-risk). Critical projects have mounting overdue work and need attention first." />
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        {projects.length === 0 ? (
          <div className="px-5 pb-5"><EmptyState message="No active projects" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Project</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Health</th>
                  {["Active", "On Track", "At Risk", "Overdue", "Done 30d"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {projects.map((p) => {
                  const badge = HEALTH_BADGE[p.health];
                  return (
                    <tr
                      key={p.projectId}
                      className="transition-colors hover:bg-muted/30 cursor-pointer"
                      onClick={() => { window.location.href = `/projects/${p.projectId}`; }}
                    >
                      <td className="px-5 py-3 font-semibold text-foreground max-w-[200px]">
                        <span className="block truncate">{p.projectName}</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Badge variant={badge.variant} className={badge.className}>{badge.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{p.active}</td>
                      <Cell value={p.onTrack} tone="blue" />
                      <Cell value={p.atRisk} tone="amber" />
                      <Cell value={p.overdue} tone="red" />
                      <Cell value={p.completed30d} tone="green" />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Cell({ value, tone }: { value: number; tone: "blue" | "amber" | "red" | "green" }) {
  const cls = value === 0
    ? "text-muted-foreground/30"
    : {
        blue: "text-blue-600 dark:text-blue-400",
        amber: "text-amber-600 dark:text-amber-400",
        red: "text-red-600 dark:text-red-400",
        green: "text-emerald-600 dark:text-emerald-400",
      }[tone];
  return (
    <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", cls)}>{value}</td>
  );
}

// ── Aging WIP ─────────────────────────────────────────────────────────────────

function AgingWip({ stale }: { stale: OverviewResponse["staleWip"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aging WIP</CardTitle>
        <CardAction>
          <ChartInfo description="In-progress issues with no Jira update in the longest time, across all projects. These are the most likely stalled or blocked items dragging on delivery." />
        </CardAction>
      </CardHeader>
      <CardContent>
        {stale.length === 0 ? (
          <EmptyState message="Nothing stalled — work is moving" />
        ) : (
          <div className="space-y-1">
            {stale.map((issue) => {
              const jiraUrl = `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;
              return (
                <a
                  key={issue.id}
                  href={jiraUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-3 rounded-lg px-3 py-2 -mx-3 hover:bg-muted/40 transition-colors"
                >
                  <span className="mt-1.5 shrink-0 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-destructive">
                    {issue.daysStale}d
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground leading-tight">
                      {issue.summary}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="font-mono">{issue.jiraKey}</span>
                      <span className="text-border">·</span>
                      <span className="truncate">{issue.assigneeName ?? "Unassigned"}</span>
                      <span className="text-border">·</span>
                      <span className="truncate">{issue.projectName}</span>
                    </p>
                  </div>
                  <RiExternalLinkLine className="mt-1 size-3.5 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors" />
                </a>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10">
      <RiInboxLine className="size-5 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="gap-1.5 p-4">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-8 w-12 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Skeleton className="h-[320px] rounded-xl xl:col-span-2" />
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Skeleton className="h-[320px] rounded-xl xl:col-span-2" />
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    </div>
  );
}

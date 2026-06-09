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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { OverviewResponse, ProjectHealth } from "@/app/api/analytics/overview/route";
import type {
  OverviewIssue,
  OverviewIssuesResponse,
  OverviewBucket,
} from "@/app/api/analytics/overview/issues/route";
import {
  getQuarterChips,
  currentFiscalQuarterChip,
  type QuarterChip,
} from "@/lib/date-utils";

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
  const [quarter, setQuarter] = useState<QuarterChip | null>(null);
  const [drill, setDrill] = useState<{ bucket: OverviewBucket; title: string } | null>(null);

  useEffect(() => {
    setQuarter(currentFiscalQuarterChip());
  }, []);

  useEffect(() => {
    if (!quarter) return;
    setLoading(true);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const params = new URLSearchParams({
      now: nowStr,
      ustart: quarter.start,
      uend: quarter.end,
    });
    fetch(`/api/analytics/overview?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [quarter]);

  const quarters = getQuarterChips();
  const qLabel = quarter?.label ?? "";

  return (
    <div className="space-y-5">
      {/* ── Quarter filter ── */}
      <div className="flex items-center justify-end gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Quarter
        </span>
        <div className="flex items-center gap-0.5">
          {quarters.map((q) => (
            <button
              key={q.label}
              onClick={() => setQuarter(q)}
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

      {loading || !data ? (
        <DashboardSkeleton />
      ) : (
        <div className="space-y-5 animate-in fade-in duration-500">
          {/* ── KPI strip ── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              label="Active Work"
              value={data.kpis.totalActive}
              sub={`${data.kpis.activeWip} in progress · due ${qLabel}`}
              info={`Open issues whose due date falls in ${qLabel || "the quarter"}. Click to list them.`}
              onClick={() => setDrill({ bucket: "active", title: "Active Work" })}
            />
            <KpiCard
              label={`Completed · ${qLabel}`}
              value={data.kpis.completed}
              trend={data.kpis.completedDeltaPct}
              trendLabel="vs prior quarter"
              info={`Issues completed during ${qLabel || "the quarter"}. The trend compares against the previous quarter.`}
            />
            <KpiCard
              label="At Risk"
              value={data.kpis.atRisk}
              tone={data.kpis.atRisk > 0 ? "amber" : undefined}
              info="Open issues due this quarter with 20% or less of their scheduled working time left. Check in before they slip. Click to list them."
              onClick={() => setDrill({ bucket: "at_risk", title: "At Risk issues" })}
            />
            <KpiCard
              label="Overdue"
              value={data.kpis.overdue}
              alert={data.kpis.overdue > 0}
              info="Open issues due this quarter whose due date has already passed. Needs follow-up or reschedule. Click to list them."
              onClick={() => setDrill({ bucket: "overdue", title: "Overdue issues" })}
            />
            <KpiCard
              label="On-Time Rate"
              value={data.kpis.onTimeRatePct}
              suffix="%"
              tone={
                data.kpis.onTimeRatePct == null
                  ? undefined
                  : data.kpis.onTimeRatePct >= 80
                  ? "green"
                  : data.kpis.onTimeRatePct >= 60
                  ? "amber"
                  : "red"
              }
              sub={`${qLabel} delivered`}
              info={`Of the issues completed in ${qLabel || "the quarter"} that had a due date, the share delivered on or before it.`}
            />
            <KpiCard
              label="Unplanned"
              value={data.kpis.unplannedPct}
              suffix="%"
              tone={data.kpis.unplannedPct >= 30 ? "amber" : undefined}
              sub={`${data.kpis.unplanned} without dates`}
              info="Open issues created this quarter that are missing a start or due date — work that isn't scheduled. Click to list them."
              onClick={() => setDrill({ bucket: "unplanned", title: "Unplanned issues" })}
            />
          </div>

          {/* ── Flow + Cycle time ── */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <DeliveryFlow flow={data.flow} />
            </div>
            <CycleTime cycle={data.cycleTimeByType} />
          </div>

          {/* ── Project health ── */}
          <ProjectHealthTable projects={data.projectHealth} />
        </div>
      )}

      {drill && quarter && (
        <BucketDialog
          bucket={drill.bucket}
          title={drill.title}
          quarter={quarter}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

// ── Issue drill-down dialog ─────────────────────────────────────────────────────

function BucketDialog({
  bucket,
  title,
  quarter,
  onClose,
}: {
  bucket: OverviewBucket;
  title: string;
  quarter: QuarterChip;
  onClose: () => void;
}) {
  const [issues, setIssues] = useState<OverviewIssue[] | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    setIssues(null);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const params = new URLSearchParams({
      bucket,
      ustart: quarter.start,
      uend: quarter.end,
      now: nowStr,
    });
    fetch(`/api/analytics/overview/issues?${params}`)
      .then((r) => r.json())
      .then((d: OverviewIssuesResponse) => {
        setIssues(d.issues);
        setTruncated(d.truncated);
      })
      .catch(() => setIssues([]));
  }, [bucket, quarter]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {quarter.label}
            {issues ? ` · ${issues.length}${truncated ? "+" : ""} issue${issues.length === 1 ? "" : "s"}` : ""}
            {" · click a key to open it in Jira"}
          </DialogDescription>
        </DialogHeader>

        {issues === null ? (
          <div className="space-y-2 py-2">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </div>
        ) : issues.length === 0 ? (
          <EmptyState message="No issues in this bucket" />
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[96px]" />
                <col />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[104px]" />
              </colgroup>
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Key</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Summary</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Assignee</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Project</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {issues.map((it) => (
                  <tr key={it.jiraKey} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2">
                      <a
                        href={it.jiraUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1 font-mono text-xs font-medium text-primary hover:underline"
                      >
                        <span className="truncate">{it.jiraKey}</span>
                        <RiExternalLinkLine className="size-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground" />
                      </a>
                    </td>
                    <td className="px-3 py-2"><span className="block truncate" title={it.summary}>{it.summary}</span></td>
                    <td className="px-3 py-2 text-muted-foreground"><span className="block truncate" title={it.assigneeName ?? "Unassigned"}>{it.assigneeName ?? "Unassigned"}</span></td>
                    <td className="px-3 py-2 text-muted-foreground"><span className="block truncate" title={it.projectName}>{it.projectName}</span></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums"><DueLabel issue={it} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DueLabel({ issue }: { issue: OverviewIssue }) {
  if (issue.daysToDue == null) return <span className="text-muted-foreground/50">—</span>;
  if (issue.daysToDue < 0)
    return <span className="font-medium text-destructive">{Math.abs(issue.daysToDue)}d overdue</span>;
  if (issue.daysToDue === 0) return <span className="font-medium text-amber-600 dark:text-amber-400">due today</span>;
  return <span className="text-muted-foreground">in {issue.daysToDue}d</span>;
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
  info,
  onClick,
}: {
  label: string;
  value: number | null;
  sub?: string;
  trend?: number | null;
  trendLabel?: string;
  suffix?: string;
  alert?: boolean;
  tone?: "green" | "amber" | "red";
  info?: string;
  onClick?: () => void;
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
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "gap-1.5 p-4",
        onClick && "cursor-pointer transition-colors hover:bg-muted/40 hover:ring-1 hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        alert && "ring-destructive/30 bg-destructive/5 dark:bg-destructive/10"
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {alert && <RiErrorWarningLine className="size-3 shrink-0 text-destructive" />}
        {label}
        {info && (
          <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
            <ChartInfo description={info} />
          </span>
        )}
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
                This quarter:{" "}
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
          <ChartInfo description="Median active working hours (in-progress, review, QA) from start to completion, by issue type, for work completed in the selected quarter. Longer bars are slower-moving work types worth investigating." />
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
                  {["Active", "On Track", "At Risk", "Overdue", "Done"].map((h) => (
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
                      <Cell value={p.completed} tone="green" />
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

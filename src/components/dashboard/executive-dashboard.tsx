"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { Button } from "@/components/ui/button";
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
import type { OverviewResponse, TopProject } from "@/app/api/analytics/overview/route";
import type {
  OverviewIssue,
  OverviewIssuesResponse,
  OverviewBucket,
} from "@/app/api/analytics/overview/issues/route";
import type {
  ThroughputResponse,
  PersonThroughput,
} from "@/app/api/analytics/throughput/route";
import type { BoardSummary } from "@/app/api/analytics/workload/boards/route";
import type {
  CommittersResponse,
  CommitterStat,
} from "@/app/api/analytics/committers/route";
import type { LinesOfCodeResponse } from "@/app/api/analytics/lines-of-code/route";
import type { LocRow } from "@/app/(app)/views/lines-of-code/data";
import {
  getQuarterChips,
  currentFiscalQuarterChip,
  type QuarterChip,
} from "@/lib/date-utils";
import { DelayLogButton } from "@/components/delay-tracker/delay-log-button";
import type { DelayAnalyticsResponse, DelayLeader } from "@/app/api/analytics/delays/route";

const flowConfig: ChartConfig = {
  completed: { label: "Completed", color: "var(--chart-1)" },
  created: { label: "Created", color: "var(--chart-3)" },
};

const cycleConfig: ChartConfig = {
  p50Hours: { label: "Median hours", color: "var(--chart-2)" },
};

export function ExecutiveDashboard() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [throughput, setThroughput] = useState<ThroughputResponse | null>(null);
  const [boards, setBoards] = useState<{ boards: BoardSummary[] } | null>(null);
  const [committers, setCommitters] = useState<CommittersResponse | null>(null);
  const [linesOfCode, setLinesOfCode] = useState<LinesOfCodeResponse | null>(null);
  const [delays, setDelays] = useState<DelayAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
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
    // All three leaderboards are scoped to the selected quarter.
    const overviewParams = new URLSearchParams({
      now: nowStr,
      ustart: quarter.start,
      uend: quarter.end,
    });
    const throughputParams = new URLSearchParams({
      start: quarter.start,
      end: quarter.end,
    });
    const boardParams = new URLSearchParams({
      now: nowStr,
      start: quarter.start,
      end: quarter.end,
      ustart: quarter.start,
      uend: quarter.end,
    });
    const committerParams = new URLSearchParams({
      start: quarter.start,
      end: quarter.end,
    });
    const getJson = (url: string) =>
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url} → ${r.status}`);
        return r.json();
      });
    // Settle independently so a failing leaderboard endpoint degrades only its
    // own card (cards fall back to empty) while the core overview still renders.
    Promise.allSettled([
      getJson(`/api/analytics/overview?${overviewParams}`),
      getJson(`/api/analytics/throughput?${throughputParams}`),
      getJson(`/api/analytics/workload/boards?${boardParams}`),
      getJson(`/api/analytics/committers?${committerParams}`),
      getJson(`/api/analytics/lines-of-code?${committerParams}`),
      getJson(`/api/analytics/delays`),
    ]).then(([o, t, b, c, l, d]) => {
      if (o.status === "fulfilled") setData(o.value);
      if (t.status === "fulfilled") setThroughput(t.value);
      if (b.status === "fulfilled") setBoards(b.value);
      if (c.status === "fulfilled") setCommitters(c.value);
      if (l.status === "fulfilled") setLinesOfCode(l.value);
      if (d.status === "fulfilled") setDelays(d.value);
      setLoading(false);
    });
  }, [quarter, reloadKey]);

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

      {loading ? (
        <DashboardSkeleton />
      ) : !data ? (
        <DashboardError onRetry={() => setReloadKey((k) => k + 1)} />
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

          {/* ── Leaderboards ── */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            <TopThroughputCard people={throughput?.people ?? []} />
            <TopCommittersCard committers={committers?.committers ?? []} />
            <TopNetLocCard people={linesOfCode?.people ?? []} />
            <TopTeamsCard boards={boards?.boards ?? []} />
            <TopProjectsCard projects={data.topProjects} />
            <TopDelayLeaderboard
              title="Top Delay Reasons · Projects"
              info="Projects with the most logged delay entries. The subtitle shows each project's single most common reason. Click a row to see the delayed issues."
              emptyMessage="No delays logged yet"
              leaders={delays?.byProject ?? []}
              filterKind="project"
            />
            <TopDelayLeaderboard
              title="Top Delay Reasons · People"
              info="People most often named as responsible for a logged delay. The subtitle shows their single most common reason. Click a row to see the delayed issues."
              emptyMessage="No delays logged yet"
              leaders={delays?.byUser ?? []}
              filterKind="user"
            />
          </div>
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
                <col className="w-[40px]" />
              </colgroup>
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Key</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Summary</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Assignee</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Project</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Due</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {issues.map((it) => (
                  <tr key={it.id} className="hover:bg-muted/30 transition-colors">
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
                    <td className="px-2 py-2"><DelayLogButton issueId={it.id} /></td>
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

// ── Leaderboards (Top 10) ─────────────────────────────────────────────────────

type LeaderItem = {
  key: string;
  primary: string;
  secondary?: string;
  value: number;
  /** Optional unit shown after the value, e.g. "/person". */
  valueSuffix?: string;
  href?: string;
};

/** Shared ranked Top-10 list with a proportional bar per row. */
function LeaderboardCard({
  title,
  info,
  emptyMessage,
  items,
  titleHref,
}: {
  title: string;
  info: string;
  emptyMessage: string;
  items: LeaderItem[];
  /** When set, the card title itself links here — "see everything behind this leaderboard," distinct from a row's own href. */
  titleHref?: string;
}) {
  const max = items.reduce((m, it) => Math.max(m, it.value), 0);

  return (
    <Card>
      <CardHeader>
        {titleHref ? (
          <CardTitle>
            <Link href={titleHref} className="hover:underline">
              {title}
            </Link>
          </CardTitle>
        ) : (
          <CardTitle>{title}</CardTitle>
        )}
        <CardAction>
          <ChartInfo description={info} />
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-5 pb-5"><EmptyState message={emptyMessage} /></div>
        ) : (
          <ol className="divide-y divide-border/50">
            {items.map((it, i) => {
              const pct = max > 0 ? Math.max(0, Math.round((it.value / max) * 100)) : 0;
              const row = (
                <div className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-4 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{it.primary}</p>
                    {it.secondary && (
                      <p className="truncate text-[11px] text-muted-foreground">{it.secondary}</p>
                    )}
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {it.value.toLocaleString("en-US")}
                    {it.valueSuffix && (
                      <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">
                        {it.valueSuffix}
                      </span>
                    )}
                  </span>
                </div>
              );
              return (
                <li key={it.key}>
                  {it.href ? (
                    <a href={it.href} className="block transition-colors hover:bg-muted/30">
                      {row}
                    </a>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function TopThroughputCard({ people }: { people: PersonThroughput[] }) {
  const items: LeaderItem[] = people.slice(0, 10).map((p) => ({
    key: p.email,
    primary: p.name,
    secondary: p.email,
    value: p.closed,
  }));
  return (
    <LeaderboardCard
      title="Top Throughput · People"
      info="People who closed the most Jira issues in the selected quarter. Each issue is credited to its primary and additional assignees; cancelled issues are excluded."
      emptyMessage="No issues closed this quarter"
      items={items}
    />
  );
}

function TopCommittersCard({ committers }: { committers: CommitterStat[] }) {
  const items: LeaderItem[] = committers.slice(0, 10).map((c) => ({
    key: c.email,
    primary: c.name,
    secondary: `${c.repos} repo${c.repos === 1 ? "" : "s"} · ${c.net >= 0 ? "+" : ""}${c.net} net LOC`,
    value: c.commits,
    href: "/views/lines-of-code",
  }));
  return (
    <LeaderboardCard
      title="Top Committers · People"
      info="People ranked by GitHub commits in the selected quarter, summed across every GitHub login mapped to them and across tracked repos. Bots and unmapped accounts are excluded. Open the Lines of Code view for the full breakdown."
      emptyMessage="No commits recorded this quarter"
      items={items}
    />
  );
}

function TopNetLocCard({ people }: { people: LocRow[] }) {
  // Already net-ranked by the same query that powers the Lines of Code page, so
  // the two stay in lockstep. Just take the top 10.
  const items: LeaderItem[] = people.slice(0, 10).map((c) => ({
    key: c.email,
    primary: c.name,
    secondary: `${c.commits} commit${c.commits === 1 ? "" : "s"} · ${c.repos} repo${
      c.repos === 1 ? "" : "s"
    }`,
    value: c.net,
    href: "/views/lines-of-code",
  }));
  return (
    <LeaderboardCard
      title="Top Net LOC · People"
      info="People ranked by net lines of code (additions − deletions) committed in the selected quarter, summed across every GitHub login mapped to them and across tracked repos. Bots and unmapped accounts are excluded. Matches the Lines of Code view exactly — open it for the full breakdown."
      emptyMessage="No lines of code recorded this quarter"
      items={items}
    />
  );
}

function TopTeamsCard({ boards }: { boards: BoardSummary[] }) {
  // Rank by load per person (active work ÷ team size), so the most overloaded
  // teams relative to their headcount rise to the top — not just the biggest
  // teams. The boards API pre-sorts by raw active count, so we re-sort here.
  const items: LeaderItem[] = boards
    .map((b) => ({
      board: b,
      perPerson: b.memberCount > 0 ? b.active / b.memberCount : b.active,
    }))
    .sort((a, b) => b.perPerson - a.perPerson || b.board.active - a.board.active)
    .slice(0, 10)
    .map(({ board: b, perPerson }) => ({
      key: b.boardId,
      primary: b.boardName,
      secondary: `${b.active} active · ${b.memberCount} member${
        b.memberCount === 1 ? "" : "s"
      }`,
      value: Math.round(perPerson * 10) / 10,
      valueSuffix: "/person",
      href: `/observer/${b.boardId}`,
    }));
  return (
    <LeaderboardCard
      title="Top Workload · Teams"
      info="Teams ranked by active work per person — total active issues this quarter divided by team size — so the most overloaded teams relative to their headcount surface first. Each row also shows the team's total active work and member count."
      emptyMessage="No team workload this quarter"
      items={items}
    />
  );
}

function TopDelayLeaderboard({
  title,
  info,
  emptyMessage,
  leaders,
  filterKind,
}: {
  title: string;
  info: string;
  emptyMessage: string;
  leaders: DelayLeader[];
  /** Which filter field `l.key` maps to when a row is clicked. */
  filterKind: "project" | "user";
}) {
  const items: LeaderItem[] = leaders.map((l) => {
    const params = new URLSearchParams();
    if (filterKind === "project") {
      params.set("projectIds", l.key);
    } else {
      params.set("responsibleEmail", l.key);
      params.set("responsibleName", l.name);
    }
    return {
      key: l.key,
      primary: l.name,
      secondary: `${l.topCategory} · ${l.topCategoryCount}`,
      value: l.total,
      href: `/delay-tracker?${params}`,
    };
  });
  return (
    <LeaderboardCard
      title={title}
      info={info}
      emptyMessage={emptyMessage}
      items={items}
      titleHref="/delay-tracker"
    />
  );
}

function TopProjectsCard({ projects }: { projects: TopProject[] }) {
  const items: LeaderItem[] = projects.map((p) => ({
    key: p.projectId,
    primary: p.projectName,
    value: p.workload,
    href: `/projects/${p.projectId}`,
  }));
  return (
    <LeaderboardCard
      title="Top Workload · Projects"
      info="Projects ranked by active, scheduled issues due in the selected quarter — counted directly per issue, regardless of how many people are assigned."
      emptyMessage="No project workload this quarter"
      items={items}
    />
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

function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 py-16">
      <RiErrorWarningLine className="size-6 text-destructive" />
      <p className="text-sm text-muted-foreground">
        Couldn&rsquo;t load the dashboard. Please try again.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </Card>
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
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-[360px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}

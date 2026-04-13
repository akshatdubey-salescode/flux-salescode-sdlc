"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  RiErrorWarningLine,
  RiTimeLine,
  RiArrowUpLine,
  RiArrowDownLine,
  RiExternalLinkLine,
} from "@remixicon/react";

type ProjectDashboardData = {
  projectHealth: {
    activeIssues: number;
    completedThisWeek: number;
    completedDelta: number;
    slaViolations: number;
  };
  assigneeWorkload: { assignee: string; active_count: number }[];
  throughput: { week: string; completed: number }[];
  cycleTimeByType: { issue_type: string; p50_hours: number }[];
  staleIssues: {
    id: string;
    jira_key: string;
    summary: string;
    assignee_name: string;
    days_stale: number;
  }[];
  jiraBaseUrl: string;
};

const throughputConfig: ChartConfig = {
  completed: { label: "Completed", color: "var(--chart-1)" },
};

export function ProjectOverviewDashboard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProjectDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/analytics`)
      .then((res) => res.json())
      .then((data) => {
        setData(data);
        setLoading(false);
      });
  }, [projectId]);

  if (loading || !data) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <ProjectHealthStrip health={data.projectHealth} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <div className="xl:col-span-2">
          <AssigneeWorkload workload={data.assigneeWorkload} />
        </div>
        <div className="xl:col-span-2">
          <ThroughputChart throughput={data.throughput} />
        </div>
        <div className="xl:col-span-2">
          <IssueTypeCycleTime cycleTime={data.cycleTimeByType} />
        </div>
        <div className="xl:col-span-2">
          <StaleIssuesList
            staleIssues={data.staleIssues}
            jiraBaseUrl={data.jiraBaseUrl}
          />
        </div>
      </div>
    </div>
  );
}

function ProjectHealthStrip({
  health,
}: {
  health: ProjectDashboardData["projectHealth"];
}) {
  const delta = health.completedDelta;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <StatCard label="Active Issues" value={health.activeIssues} />
      <StatCard
        label="Completed This Week"
        value={health.completedThisWeek}
        trend={delta}
        trendLabel="vs last wk"
      />
      <StatCard
        label="Active SLA Violations"
        value={health.slaViolations}
        alert={health.slaViolations > 0}
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
        {alert && (
          <RiErrorWarningLine className="size-3 shrink-0 text-destructive" />
        )}
        {label}
      </p>
      <p
        className={cn(
          "text-3xl font-semibold tabular-nums",
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
          {trend > 0 ? "+" : ""}
          {trend}%{trendLabel ? ` ${trendLabel}` : ""}
        </p>
      )}
    </Card>
  );
}

function AssigneeWorkload({
  workload,
}: {
  workload: ProjectDashboardData["assigneeWorkload"];
}) {
  const max = Math.max(...workload.map((w) => w.active_count), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assignee Workload</CardTitle>
      </CardHeader>
      <CardContent>
        {workload.length === 0 ? (
          <EmptyState message="No WIP issues assigned" />
        ) : (
          <div className="space-y-3.5 max-h-[260px] overflow-y-auto pr-1">
            {workload.map((row) => {
              const overloaded = row.active_count > 5;
              return (
                <div key={row.assignee} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">
                      {row.assignee}
                    </span>
                    <span
                      className={cn(
                        "tabular-nums",
                        overloaded ? "text-destructive font-semibold" : "text-muted-foreground"
                      )}
                    >
                      {row.active_count} active
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        overloaded
                          ? "bg-destructive"
                          : "bg-primary"
                      )}
                      style={{
                        width: `${Math.min((row.active_count / max) * 100, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ThroughputChart({
  throughput,
}: {
  throughput: ProjectDashboardData["throughput"];
}) {
  const chartData = throughput.map((row) => ({
    name: format(new Date(row.week), "MMM d"),
    completed: row.completed,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly Throughput</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <ChartContainer config={throughputConfig} className="h-[220px] w-full">
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
            >
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
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <Bar
                dataKey="completed"
                fill="var(--color-completed)"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <EmptyState message="Not enough data to calculate velocity" />
        )}
      </CardContent>
    </Card>
  );
}

function IssueTypeCycleTime({
  cycleTime,
}: {
  cycleTime: ProjectDashboardData["cycleTimeByType"];
}) {
  const sorted = [...cycleTime].sort((a, b) => b.p50_hours - a.p50_hours);
  const max = Math.max(...sorted.map((r) => r.p50_hours), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Median Cycle Time by Issue Type</CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <EmptyState message="No cycle time data available" />
        ) : (
          <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
            {sorted.map((row) => (
              <div key={row.issue_type} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <span className="size-1.5 rounded-full bg-primary shrink-0" />
                    {row.issue_type}
                  </span>
                  <span className="tabular-nums font-semibold text-muted-foreground">
                    {row.p50_hours}h
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/60 transition-all duration-500"
                    style={{ width: `${(row.p50_hours / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StaleIssuesList({
  staleIssues,
  jiraBaseUrl,
}: {
  staleIssues: ProjectDashboardData["staleIssues"];
  jiraBaseUrl: string;
}) {
  const getJiraUrl = (key: string) =>
    `${jiraBaseUrl.replace(/\/+$/, "")}/browse/${key}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stale Issues — &gt;7 Days</CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-1">
        {staleIssues.length === 0 ? (
          <div className="px-5 pb-4">
            <EmptyState message="No stale issues found" />
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-card">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Issue
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-20">
                    Assignee
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground w-16">
                    Age
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {staleIssues.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <div className="space-y-0.5">
                        <a
                          href={getJiraUrl(row.jira_key)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 font-medium text-foreground hover:text-primary transition-colors group"
                          title={row.summary}
                        >
                          <span className="truncate max-w-[200px]">
                            {row.summary}
                          </span>
                          <RiExternalLinkLine className="size-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                        </a>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {row.jira_key}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[80px]">
                      {row.assignee_name || (
                        <span className="opacity-40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Badge variant="warning" className="gap-1 tabular-nums">
                        <RiTimeLine className="size-2.5" />
                        {row.days_stale}d
                      </Badge>
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <Skeleton className="h-[300px] rounded-lg xl:col-span-2" />
        <Skeleton className="h-[300px] rounded-lg xl:col-span-2" />
        <Skeleton className="h-[260px] rounded-lg xl:col-span-2" />
        <Skeleton className="h-[260px] rounded-lg xl:col-span-2" />
      </div>
    </div>
  );
}

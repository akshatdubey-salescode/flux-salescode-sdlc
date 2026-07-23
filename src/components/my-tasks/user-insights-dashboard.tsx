"use client";

import { useEffect, useState } from "react";
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
  CartesianGrid,
  LabelList,
} from "recharts";
import {
  RiErrorWarningLine,
  RiTimeLine,
  RiArrowUpLine,
  RiArrowDownLine,
  RiExternalLinkLine,
} from "@remixicon/react";
import { DelayLogButton } from "@/components/delay-tracker/delay-log-button";
import { DeliveryBadge } from "@/components/delivery-tracker/delivery-badge";

type UserDashboardData = {
  personalHealth: {
    activeIssues: number;
    completedThisWeek: number;
    completedDelta: number;
    slaViolations: number;
  };
  cycleTimeComparison: { cohort: string; p50_hours: number }[];
  staleIssues: {
    id: string;
    jira_key: string;
    summary: string;
    project_name: string;
    jira_base_url: string;
    days_stale: number;
  }[];
};

const cycleChartConfig: ChartConfig = {
  me: { label: "Me", color: "var(--chart-1)" },
  org: { label: "Org Avg", color: "var(--chart-2)" },
};

export function UserInsightsDashboard() {
  const [data, setData] = useState<UserDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/my-tasks/analytics")
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
    <div className="space-y-5 animate-in fade-in duration-500 pt-4">
      <PersonalHealthStrip health={data.personalHealth} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <CycleTimeChart cycleTime={data.cycleTimeComparison} />
        <div className="lg:col-span-2">
          <MyStaleIssues staleIssues={data.staleIssues} />
        </div>
      </div>
    </div>
  );
}

function PersonalHealthStrip({
  health,
}: {
  health: UserDashboardData["personalHealth"];
}) {
  const delta = health.completedDelta;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <StatCard label="My Active Tasks" value={health.activeIssues} />
      <StatCard
        label="Completed This Week"
        value={health.completedThisWeek}
        trend={delta}
        trendLabel="vs last wk"
      />
      <StatCard
        label="My SLA Violations"
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

function CycleTimeChart({
  cycleTime,
}: {
  cycleTime: UserDashboardData["cycleTimeComparison"];
}) {
  // Reshape to a single grouped-bar entry so ChartConfig drives colors + tooltip
  const me = cycleTime.find((c) => c.cohort === "Me")?.p50_hours ?? 0;
  const org = cycleTime.find((c) => c.cohort !== "Me")?.p50_hours ?? 0;
  const chartData = [{ label: "Median (P50)", me, org }];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>Cycle Time vs Org Average — Median</CardTitle>
        <CardAction>
          <ChartInfo description="Your median time to complete an issue compared to the org-wide average. Being above the line isn't necessarily bad — it may reflect working on more complex issues than your peers." />
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        {cycleTime.length > 0 ? (
          <ChartContainer config={cycleChartConfig} className="h-full w-full flex-1 min-h-[180px]">
            <BarChart
              data={chartData}
              barGap={8}
              barCategoryGap="15%"
              margin={{ top: 24, right: 8, left: 8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11 }}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => [`${value}h`, ""]}
                    indicator="dot"
                  />
                }
              />
              <Bar dataKey="me" fill="var(--color-me)" radius={[4, 4, 0, 0]} barSize={72}>
                <LabelList
                  dataKey="me"
                  position="top"
                  formatter={(v) => `${v}h`}
                  style={{ fill: "var(--foreground)", fontSize: 11, fontWeight: 600 }}
                />
              </Bar>
              <Bar dataKey="org" fill="var(--color-org)" radius={[4, 4, 0, 0]} barSize={72}>
                <LabelList
                  dataKey="org"
                  position="top"
                  formatter={(v) => `${v}h`}
                  style={{ fill: "var(--foreground)", fontSize: 11, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        ) : (
          <EmptyState message="Not enough data points yet" />
        )}
      </CardContent>
    </Card>
  );
}

function MyStaleIssues({
  staleIssues,
}: {
  staleIssues: UserDashboardData["staleIssues"];
}) {
  const getJiraUrl = (baseUrl: string, key: string) =>
    `${baseUrl.replace(/\/+$/, "")}/browse/${key}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>My Stale Issues — &gt;3 Days</CardTitle>
        <CardAction>
          <ChartInfo description="Your assigned issues with no activity in the last 3 days. These may be blocked, need a status update, or have been quietly set aside." />
        </CardAction>
      </CardHeader>
      <CardContent>
        {staleIssues.length === 0 ? (
          <EmptyState message="All caught up — no stale tasks" />
        ) : (
          <div className="divide-y divide-border/50">
            {staleIssues.map((row) => (
              <div key={row.id} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <a
                    href={getJiraUrl(row.jira_base_url, row.jira_key)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary transition-colors line-clamp-1 leading-relaxed min-w-0"
                    title={row.summary}
                  >
                    <span className="truncate">{row.summary}</span>
                    <RiExternalLinkLine className="size-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                  </a>
                  <Badge variant="destructive" className="shrink-0 gap-1 tabular-nums">
                    <RiTimeLine className="size-2.5" />
                    {row.days_stale}d
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                    {row.jira_key}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {row.project_name}
                  </span>
                  <DelayLogButton issueId={row.id} />
                  <DeliveryBadge issueId={row.id} />
                </div>
              </div>
            ))}
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
    <div className="space-y-5 pt-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Skeleton className="h-[280px] rounded-lg" />
        <Skeleton className="h-[280px] rounded-lg lg:col-span-2" />
      </div>
    </div>
  );
}

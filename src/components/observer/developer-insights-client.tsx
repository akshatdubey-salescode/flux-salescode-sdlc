"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  RiInboxLine,
  RiBarChartLine,
} from "@remixicon/react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { MyTasksView } from "@/components/my-tasks";
import { Suspense, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Insights = {
  completedThisWeek: number;
  completedLastWeek: number;
  openIssues: number;
  avgCycleHours: number | null;
  priorityDistribution: { priority: string; count: number }[];
  projectDistribution: { project_name: string; project_key: string; count: number }[];
  issueTypeDistribution: { issue_type: string; count: number }[];
  statusDistribution: { status: string; status_category: string; count: number }[];
};

const PRIORITY_COLORS: Record<string, string> = {
  Highest: "var(--chart-1)",
  Critical: "var(--chart-1)",
  High: "var(--chart-2)",
  Medium: "var(--chart-3)",
  Low: "var(--chart-4)",
  None: "var(--chart-5)",
};

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

type Props = {
  email: string;
  boardId?: string;
  boardName?: string;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DeveloperInsightsClient({ email, boardId, boardName }: Props) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [showInsights, setShowInsights] = useState(false);

  const initials = email.split("@")[0].slice(0, 2).toUpperCase();

  // Load insights only when toggled on
  useEffect(() => {
    if (!showInsights || insights) return;
    setInsightsLoading(true);
    fetch(`/api/observer/developer/${encodeURIComponent(email)}/insights`)
      .then((r) => r.json())
      .then(setInsights)
      .catch(() => {})
      .finally(() => setInsightsLoading(false));
  }, [showInsights, email, insights]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Developer header */}
      <div className="flex items-center gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-primary font-bold text-lg ring-2 ring-primary/10">
          {initials}
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {email.split("@")[0]}
          </h1>
          <p className="text-sm text-muted-foreground">{email}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setShowInsights((v) => !v)}
            className={`flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 border transition-colors ${
              showInsights
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-muted-foreground hover:text-foreground"
            }`}
          >
            <RiBarChartLine size={13} />
            {showInsights ? "Hide insights" : "Show insights"}
          </button>
          {boardId && (
            <Link
              href={`/observer/${boardId}`}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              ← Back to {boardName ?? "board"}
            </Link>
          )}
        </div>
      </div>

      {/* Insights panel (toggled) */}
      {showInsights && (
        <InsightsPanel insights={insights} loading={insightsLoading} />
      )}

      {/* Open Work Queue — reuse my-tasks table */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <RiInboxLine size={16} className="text-blue-500" />
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Open Work Queue
          </h2>
        </div>
        <Suspense>
          <MyTasksView targetEmail={email} />
        </Suspense>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insights panel (charts)
// ---------------------------------------------------------------------------

function InsightsPanel({
  insights,
  loading,
}: {
  insights: Insights | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-56 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        ))}
      </div>
    );
  }

  if (!insights) return null;

  const priorityData = insights.priorityDistribution.map((p) => ({
    name: p.priority,
    value: p.count,
    fill: PRIORITY_COLORS[p.priority] ?? "var(--chart-5)",
  }));

  const projectData = insights.projectDistribution.slice(0, 8).map((p) => ({
    name: p.project_key,
    fullName: p.project_name,
    count: p.count,
  }));

  const issueTypeData = insights.issueTypeDistribution.map((t, i) => ({
    name: t.issue_type,
    value: t.count,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const avgCycleDays =
    insights.avgCycleHours != null
      ? insights.avgCycleHours < 24
        ? `${insights.avgCycleHours}h`
        : `${(insights.avgCycleHours / 24).toFixed(1)}d`
      : "—";

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Completed this week" value={insights.completedThisWeek} sub={`vs ${insights.completedLastWeek} last week`} />
        <StatCard label="Open issues" value={insights.openIssues} />
        <StatCard label="Avg cycle time" value={avgCycleDays} sub="last 30 days" />
        <StatCard label="Projects" value={insights.projectDistribution.length} />
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ChartCard title="Priority Distribution" subtitle="All assigned issues">
          {priorityData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={priorityData} cx="50%" cy="50%" innerRadius={36} outerRadius={60} paddingAngle={2} dataKey="value">
                    {priorityData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip content={TooltipContent} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1">
                {priorityData.map((e) => (
                  <div key={e.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block size-2 rounded-full" style={{ background: e.fill }} />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">{e.name}</span>
                    </div>
                    <span className="text-xs font-semibold tabular-nums">{e.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <NoData />}
        </ChartCard>

        <ChartCard title="Projects Breakdown" subtitle="Issues per project">
          {projectData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={projectData} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis type="category" dataKey="name" width={44} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <Tooltip content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="font-medium">{(payload[0].payload as { fullName: string }).fullName}</p>
                      <p className="text-muted-foreground">{payload[0].value} issues</p>
                    </div>
                  ) : null
                } />
                <Bar dataKey="count" fill="var(--primary)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <NoData />}
        </ChartCard>

        <ChartCard title="Issue Types" subtitle="Story, Bug, Task…">
          {issueTypeData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={issueTypeData} cx="50%" cy="50%" outerRadius={60} paddingAngle={2} dataKey="value">
                    {issueTypeData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip content={TooltipContent} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1">
                {issueTypeData.map((e) => (
                  <div key={e.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block size-2 rounded-full" style={{ background: e.fill }} />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">{e.name}</span>
                    </div>
                    <span className="text-xs font-semibold tabular-nums">{e.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <NoData />}
        </ChartCard>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TooltipContent({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{payload[0].name}</p>
      <p className="text-muted-foreground">{payload[0].value} issues</p>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-0.5">{title}</h3>
      <p className="text-xs text-muted-foreground mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

function NoData() {
  return <div className="flex items-center justify-center h-28 text-xs text-muted-foreground">No data available</div>;
}


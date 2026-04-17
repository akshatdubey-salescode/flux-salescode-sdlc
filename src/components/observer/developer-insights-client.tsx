"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  RiArrowUpLine,
  RiArrowDownLine,
  RiCheckDoubleLine,
  RiTimerLine,
  RiFileList2Line,
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

type Insights = {
  completedThisWeek: number;
  completedLastWeek: number;
  openIssues: number;
  avgCycleHours: number | null;
  priorityDistribution: { priority: string; count: number }[];
  projectDistribution: { project_name: string; project_key: string; count: number }[];
  issueTypeDistribution: { issue_type: string; count: number }[];
  statusDistribution: { status: string; status_category: string; count: number }[];
  recentIssues: {
    jira_key: string;
    summary: string;
    status: string;
    status_category: string;
    issue_type: string;
    priority: string;
    jira_updated_at: string;
    jira_created_at: string;
    project_name: string;
    project_key: string;
  }[];
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

export function DeveloperInsightsClient({ email, boardId, boardName }: Props) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const initials = email.split("@")[0].slice(0, 2).toUpperCase();

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/observer/developer/${encodeURIComponent(email)}/insights`
        );
        if (!res.ok) throw new Error("Failed to load insights");
        const data = await res.json();
        setInsights(data);
      } catch {
        setError("Failed to load developer insights. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [email]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 w-48 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-64 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!insights) return null;

  const weekTrend = insights.completedLastWeek > 0
    ? Math.round(((insights.completedThisWeek - insights.completedLastWeek) / insights.completedLastWeek) * 100)
    : null;

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
    <div className="max-w-6xl mx-auto space-y-8">
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
        {boardId && (
          <Link
            href={`/observer/${boardId}`}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            ← Back to {boardName ?? "board"}
          </Link>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          title="Completed This Week"
          value={insights.completedThisWeek}
          icon={<RiCheckDoubleLine size={18} />}
          trend={weekTrend}
          trendLabel={`vs last week (${insights.completedLastWeek})`}
          accent="text-emerald-600 dark:text-emerald-400"
          bg="bg-emerald-50 dark:bg-emerald-950/30"
        />
        <KpiCard
          title="Open Issues"
          value={insights.openIssues}
          icon={<RiFileList2Line size={18} />}
          accent="text-blue-600 dark:text-blue-400"
          bg="bg-blue-50 dark:bg-blue-950/30"
        />
        <KpiCard
          title="Avg Cycle Time"
          value={avgCycleDays}
          icon={<RiTimerLine size={18} />}
          subtitle="last 30 days"
          accent="text-amber-600 dark:text-amber-400"
          bg="bg-amber-50 dark:bg-amber-950/30"
        />
        <KpiCard
          title="Total Projects"
          value={insights.projectDistribution.length}
          icon={<RiBarChartLine size={18} />}
          accent="text-violet-600 dark:text-violet-400"
          bg="bg-violet-50 dark:bg-violet-950/30"
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Priority distribution */}
        <ChartCard title="Priority Distribution" subtitle="All assigned issues">
          {priorityData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie
                    data={priorityData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={65}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {priorityData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                          <p className="font-medium">{payload[0].name}</p>
                          <p className="text-muted-foreground">{payload[0].value} issues</p>
                        </div>
                      ) : null
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {priorityData.map((entry) => (
                  <div key={entry.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ background: entry.fill }}
                      />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">{entry.name}</span>
                    </div>
                    <span className="text-xs font-semibold tabular-nums">{entry.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <NoDataPlaceholder />
          )}
        </ChartCard>

        {/* Project distribution */}
        <ChartCard title="Projects Breakdown" subtitle="Issues per project">
          {projectData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={projectData} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={44}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                        <p className="font-medium">{(payload[0].payload as { fullName: string }).fullName}</p>
                        <p className="text-muted-foreground">{payload[0].value} issues</p>
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="count" fill="var(--primary)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <NoDataPlaceholder />
          )}
        </ChartCard>

        {/* Issue type distribution */}
        <ChartCard title="Issue Types" subtitle="Story, Bug, Task…">
          {issueTypeData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie
                    data={issueTypeData}
                    cx="50%"
                    cy="50%"
                    outerRadius={65}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {issueTypeData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                          <p className="font-medium">{payload[0].name}</p>
                          <p className="text-muted-foreground">{payload[0].value} issues</p>
                        </div>
                      ) : null
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {issueTypeData.map((entry) => (
                  <div key={entry.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ background: entry.fill }}
                      />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">{entry.name}</span>
                    </div>
                    <span className="text-xs font-semibold tabular-nums">{entry.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <NoDataPlaceholder />
          )}
        </ChartCard>
      </div>

      {/* Status distribution */}
      {insights.statusDistribution.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
            Open Issues by Status
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Current status breakdown</p>
          <div className="flex flex-wrap gap-2">
            {insights.statusDistribution.map((s) => (
              <div
                key={`${s.status}-${s.status_category}`}
                className="flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-800"
              >
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: getStatusCategoryColor(s.status_category) }}
                />
                <span className="text-xs font-medium">{s.status}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent issues */}
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent Activity</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Last 15 updated issues</p>
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {insights.recentIssues.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted-foreground text-center">No issues found.</p>
          ) : (
            insights.recentIssues.map((issue) => (
              <div key={issue.jira_key} className="flex items-start gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <span
                  className="mt-1.5 shrink-0 inline-block size-2 rounded-full"
                  style={{ background: getStatusCategoryColor(issue.status_category) }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-800 dark:text-zinc-200 truncate leading-snug">
                    {issue.summary}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">{issue.jira_key}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{issue.project_name}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{issue.issue_type}</span>
                    {issue.priority && (
                      <>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className={`text-xs font-medium ${getPriorityTextColor(issue.priority)}`}>
                          {issue.priority}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <StatusBadge statusCategory={issue.status_category} status={issue.status} />
                  {issue.jira_updated_at && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {formatRelative(issue.jira_updated_at)}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  title,
  value,
  icon,
  trend,
  trendLabel,
  subtitle,
  accent,
  bg,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number | null;
  trendLabel?: string;
  subtitle?: string;
  accent: string;
  bg: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-muted-foreground leading-tight">{title}</p>
        <div className={`flex size-7 items-center justify-center rounded-lg ${bg} ${accent}`}>
          {icon}
        </div>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
      {trend != null ? (
        <div className="flex items-center gap-1 mt-1">
          {trend > 0 ? (
            <RiArrowUpLine size={12} className="text-emerald-500" />
          ) : trend < 0 ? (
            <RiArrowDownLine size={12} className="text-red-500" />
          ) : null}
          <span className={`text-[10px] ${trend > 0 ? "text-emerald-600" : trend < 0 ? "text-red-600" : "text-muted-foreground"}`}>
            {trend > 0 ? "+" : ""}{trend}% {trendLabel}
          </span>
        </div>
      ) : subtitle ? (
        <p className="text-[10px] text-muted-foreground mt-1">{subtitle}</p>
      ) : null}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-0.5">{title}</h3>
      <p className="text-xs text-muted-foreground mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

function NoDataPlaceholder() {
  return (
    <div className="flex items-center justify-center h-28 text-xs text-muted-foreground">
      No data available
    </div>
  );
}

function isDone(cat: string): boolean {
  const c = cat.toLowerCase();
  return c === "done" || c === "complete" || c === "completed";
}

function isInProgress(cat: string): boolean {
  const c = cat.toLowerCase();
  return c === "in progress" || c === "indeterminate";
}

function StatusBadge({ statusCategory, status }: { statusCategory: string; status: string }) {
  const cls = isDone(statusCategory)
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
    : isInProgress(statusCategory)
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {status}
    </span>
  );
}

function getStatusCategoryColor(statusCategory: string): string {
  if (isDone(statusCategory)) return "#22c55e";
  if (isInProgress(statusCategory)) return "#f59e0b";
  return "#94a3b8";
}

function getPriorityTextColor(priority: string): string {
  switch (priority?.toLowerCase()) {
    case "highest":
    case "critical":
      return "text-red-600 dark:text-red-400";
    case "high":
      return "text-orange-600 dark:text-orange-400";
    case "medium":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

function formatRelative(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
  } catch {
    return "";
  }
}

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  RiCheckboxCircleLine,
  RiInboxLine,
  RiBarChartLine,
  RiCalendarLine,
  RiChat1Line,
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

type TodayDeclaration = {
  id: string;
  comment: string | null;
  expected_completion_date: string | null;
  created_at: string;
  updated_at: string;
  jira_issue_id: string;
  jira_key: string;
  summary: string;
  status: string;
  status_category: string | null;
  priority: string | null;
  project_name: string;
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
  stalenessThreshold?: number;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DeveloperInsightsClient({ email, boardId, boardName, stalenessThreshold = 5 }: Props) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [todayDecls, setTodayDecls] = useState<TodayDeclaration[]>([]);
  const [declsLoading, setDeclsLoading] = useState(true);

  const initials = email.split("@")[0].slice(0, 2).toUpperCase();

  // Load today's declarations
  useEffect(() => {
    setDeclsLoading(true);
    fetch(`/api/observer/developer/${encodeURIComponent(email)}/declarations?stalenessThreshold=${stalenessThreshold}`)
      .then((r) => r.json())
      .then((data) => setTodayDecls(data.todayDeclarations ?? []))
      .catch(() => {})
      .finally(() => setDeclsLoading(false));
  }, [email, stalenessThreshold]);

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

  const today = new Date().toISOString().split("T")[0];

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

      {/* Today's Declarations */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <RiCheckboxCircleLine size={14} className="text-emerald-500" />
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            Today&apos;s Declarations
          </h2>
          {todayDecls.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {todayDecls.length}
            </span>
          )}
        </div>
        {declsLoading ? (
          <div className="space-y-0 animate-pulse">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 border-b border-zinc-100 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/40" />
            ))}
          </div>
        ) : todayDecls.length === 0 ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <RiInboxLine size={14} className="text-zinc-300 dark:text-zinc-700" />
            No declarations for today.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {todayDecls.map((decl) => (
              <DeclRow key={decl.id} decl={decl} today={today} />
            ))}
          </div>
        )}
      </div>

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

// ---------------------------------------------------------------------------
// Declaration row (flat, Notion-style)
// ---------------------------------------------------------------------------

function DeclRow({ decl, today }: { decl: TodayDeclaration; today: string }) {
  const [showComment, setShowComment] = useState(false);
  const expDate = decl.expected_completion_date;
  const isOverdue = expDate && expDate < today;
  const isToday = expDate === today;

  return (
    <div className="group/decl py-2.5 px-3 -mx-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
      <div className="flex items-start gap-3 min-w-0">
        <span
          className="shrink-0 mt-2 size-1.5 rounded-full"
          style={{ background: statusCategoryColor(decl.status_category) }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 leading-tight">
              {decl.summary}
            </span>
            <div className="flex items-center gap-2.5 shrink-0 mt-0.5">
              {expDate && (
                <span className={`flex items-center gap-1 text-[11px] font-medium ${
                  isOverdue ? "text-red-500" : isToday ? "text-amber-500" : "text-muted-foreground"
                }`}>
                  <RiCalendarLine size={11} />
                  {formatDateShort(expDate)}
                </span>
              )}
              <DeclStatusChip status={decl.status} statusCategory={decl.status_category} />
              {decl.comment && (
                <button
                  onClick={() => setShowComment((v) => !v)}
                  className={`transition-colors ${
                    showComment
                      ? "text-zinc-600 dark:text-zinc-300"
                      : "text-zinc-300 dark:text-zinc-600 hover:text-zinc-400"
                  }`}
                  title={showComment ? "Hide comment" : "Show comment"}
                >
                  <RiChat1Line size={12} />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground/80 font-medium">
            <span className="font-mono">{decl.jira_key}</span>
            <span className="text-zinc-300 dark:text-zinc-800">·</span>
            <span className="truncate max-w-[240px]">{decl.project_name}</span>
            {decl.priority && (
              <>
                <span className="text-zinc-300 dark:text-zinc-800">·</span>
                <span className={priorityTextColor(decl.priority)}>{decl.priority}</span>
              </>
            )}
          </div>
        </div>
      </div>
      {showComment && decl.comment && (
        <div className="pl-4.5 mt-2">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-800/30 p-2 rounded-md border border-zinc-100 dark:border-zinc-800/50">
            {decl.comment}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function DeclStatusChip({ status, statusCategory }: { status: string; statusCategory: string | null }) {
  const cat = (statusCategory ?? "").toLowerCase();
  const cls =
    cat.includes("done") || cat.includes("complete")
      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100/50 dark:border-emerald-900/50"
      : cat.includes("progress") || cat === "indeterminate"
        ? "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-100/50 dark:border-amber-900/50"
        : "text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border-zinc-200/50 dark:border-zinc-700/50";
  return (
    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-tight uppercase whitespace-nowrap ${cls}`}>
      {status}
    </span>
  );
}

function statusCategoryColor(cat: string | null): string {
  const c = (cat ?? "").toLowerCase();
  if (c.includes("done") || c.includes("complete")) return "#10b981";
  if (c.includes("progress") || c === "indeterminate") return "#f59e0b";
  return "#94a3b8";
}

function priorityTextColor(priority: string): string {
  switch (priority?.toLowerCase()) {
    case "critical":
    case "highest":
      return "text-red-600 dark:text-red-400 font-semibold";
    case "high":
      return "text-orange-600 dark:text-orange-400 font-semibold";
    case "medium":
      return "text-amber-600 dark:text-amber-400 font-semibold";
    default:
      return "text-muted-foreground";
  }
}

function formatDateShort(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    if (diff === -1) return "yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

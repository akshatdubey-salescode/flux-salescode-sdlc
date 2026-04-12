"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
} from "recharts";
import { RiErrorWarningLine, RiTimeLine } from "@remixicon/react";

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
  staleIssues: { id: string; jira_key: string; summary: string; assignee_name: string; days_stale: number }[];
  jiraBaseUrl: string;
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
    <div className="space-y-8 animate-in fade-in duration-500">
      <ProjectHealthStrip health={data.projectHealth} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-2">
          <AssigneeWorkloadChart workload={data.assigneeWorkload} />
        </div>
        <div className="xl:col-span-2">
          <ProjectThroughputChart throughput={data.throughput} />
        </div>
        <IssueTypeCycleTime cycleTime={data.cycleTimeByType} />
        <StaleIssuesList staleIssues={data.staleIssues} jiraBaseUrl={data.jiraBaseUrl} />
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      {children}
    </div>
  );
}

function ProjectHealthStrip({ health }: { health: ProjectDashboardData["projectHealth"] }) {
  const stats = [
    { label: "Active Project Issues", value: health.activeIssues },
    { 
      label: "Completed This Wk", 
      value: health.completedThisWeek,
      subtext: `${health.completedDelta > 0 ? "+" : ""}${health.completedDelta}% vs last wk` 
    },
    { 
      label: "Active SLA Violations", 
      value: health.slaViolations,
      alert: health.slaViolations > 0 
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {stats.map((stat, i) => (
        <div key={i} className={`rounded-xl border p-5 shadow-sm ${stat.alert ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950'}`}>
          <div className="text-sm font-medium text-zinc-500 mb-1 flex items-center gap-1.5">
            {stat.label}
            {stat.alert && <RiErrorWarningLine className="w-4 h-4 text-red-500" />}
          </div>
          <div className={`text-3xl font-bold ${stat.alert ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-50'}`}>
            {stat.value}
          </div>
          {stat.subtext && (
            <div className="text-xs text-zinc-400 mt-1.5">{stat.subtext}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function AssigneeWorkloadChart({ workload }: { workload: ProjectDashboardData["assigneeWorkload"] }) {
  return (
    <Card title="Assignee Workload (WIP Issues)">
      <div className="relative">
        <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
          {workload.map(row => (
            <div key={row.assignee}>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{row.assignee}</span>
                <span className="text-zinc-500 flex items-center gap-1">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{row.active_count}</span> active tasks
                </span>
              </div>
              <div className="h-2.5 w-full bg-zinc-100 rounded-full dark:bg-zinc-800 overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-500 outline outline-1 outline-offset-[-1px] ${row.active_count > 5 ? 'bg-red-400 outline-red-500' : 'bg-blue-400 outline-blue-500'}`}
                  style={{ width: `${Math.min((row.active_count / 10) * 100, 100)}%` }}
                />
              </div>
            </div>
          ))}
          {workload.length === 0 && <div className="text-sm text-zinc-500 text-center py-6">No WIP issues assigned.</div>}
        </div>
        {workload.length > 5 && (
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white dark:from-zinc-950 to-transparent pointer-events-none" />
        )}
      </div>
    </Card>
  );
}

function ProjectThroughputChart({ throughput }: { throughput: ProjectDashboardData["throughput"] }) {
  const chartData = throughput.map(row => ({
    name: format(new Date(row.week), "MMM d"),
    completed: row.completed
  }));

  return (
    <Card title="Throughput (Weekly)">
      <div className="h-[250px] w-full">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" className="dark:stroke-zinc-800" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#888888' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#888888' }} />
              <RechartsTooltip 
                cursor={{fill: 'var(--zinc-100)'}}
                contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="completed" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">Not enough data to calculate velocity</div>
        )}
      </div>
    </Card>
  );
}

function IssueTypeCycleTime({ cycleTime }: { cycleTime: ProjectDashboardData["cycleTimeByType"] }) {
  const sorted = [...cycleTime].sort((a, b) => b.p50_hours - a.p50_hours);

  return (
    <Card title="Median Cycle Time by Issue Type">
      <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
        {sorted.map(row => (
          <div key={row.issue_type} className="flex justify-between items-center p-3 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
            <span className="font-medium text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
              {row.issue_type}
            </span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              {row.p50_hours}h
            </span>
          </div>
        ))}
        {sorted.length === 0 && <div className="text-sm text-zinc-500 text-center">No cycle time data available.</div>}
      </div>
    </Card>
  );
}

function StaleIssuesList({ staleIssues, jiraBaseUrl }: { staleIssues: ProjectDashboardData["staleIssues"]; jiraBaseUrl: string }) {
  const getJiraIssueUrl = (issueKey: string) => {
    const baseUrl = jiraBaseUrl.replace(/\/$/, "");
    return `${baseUrl}/browse/${issueKey}`;
  };

  return (
    <Card title="Stale Issues assigned in project (>7 days)">
      <div className="space-y-1 max-h-[300px] overflow-y-auto pr-2">
        {staleIssues.map(row => (
          <div key={row.id} className="flex items-center justify-between py-2 px-1 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
            <div className="flex flex-col gap-0.5 min-w-0">
              <a
                href={getJiraIssueUrl(row.jira_key)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sm truncate text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                title={row.summary}
              >
                {row.summary}
              </a>
              <span className="text-xs text-zinc-500 font-mono">{row.jira_key}</span>
            </div>
            <div className="flex items-center gap-2 ml-3 shrink-0">
              <span className="text-xs text-zinc-500">{row.assignee_name || "Unassigned"}</span>
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-500 whitespace-nowrap bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded">
                <RiTimeLine className="w-3.5 h-3.5" />
                {row.days_stale}d
              </span>
            </div>
          </div>
        ))}
        {staleIssues.length === 0 && <div className="text-sm text-zinc-500 py-4">No stale issues found.</div>}
      </div>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <Skeleton className="h-[300px] rounded-xl xl:col-span-2" />
        <Skeleton className="h-[300px] rounded-xl xl:col-span-2" />
        <Skeleton className="h-[250px] rounded-xl" />
        <Skeleton className="h-[250px] rounded-xl" />
      </div>
    </div>
  );
}

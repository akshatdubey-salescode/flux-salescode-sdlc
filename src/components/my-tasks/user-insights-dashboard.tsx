"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
} from "recharts";
import { RiErrorWarningLine, RiTimeLine } from "@remixicon/react";

type UserDashboardData = {
  personalHealth: {
    activeIssues: number;
    completedThisWeek: number;
    completedDelta: number;
    slaViolations: number;
  };
  cycleTimeComparison: { cohort: string; p50_hours: number }[];
  staleIssues: { id: string; jira_key: string; summary: string; project_name: string; days_stale: number }[];
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
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl pt-4">
      <PersonalHealthStrip health={data.personalHealth} />
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <PersonalCycleTimeChart cycleTime={data.cycleTimeComparison} />
        <MyStaleIssues staleIssues={data.staleIssues} />
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

function PersonalHealthStrip({ health }: { health: UserDashboardData["personalHealth"] }) {
  const stats = [
    { label: "My Active Tasks", value: health.activeIssues },
    { 
      label: "Completed This Wk", 
      value: health.completedThisWeek,
      subtext: `${health.completedDelta > 0 ? "+" : ""}${health.completedDelta}% vs last wk` 
    },
    { 
      label: "My SLA Violations", 
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

function PersonalCycleTimeChart({ cycleTime }: { cycleTime: UserDashboardData["cycleTimeComparison"] }) {
  return (
    <Card title="Cycle Time vs Org Average (Median)">
      <div className="h-[250px] w-full mt-4">
        {cycleTime.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cycleTime} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" className="dark:stroke-zinc-800" />
              <XAxis dataKey="cohort" axisLine={false} tickLine={false} tick={{ fontSize: 13, fill: '#888888', fontWeight: 500 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#888888' }} />
              <RechartsTooltip 
                cursor={{fill: 'var(--zinc-100)'}}
                contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="p50_hours" name="Hours" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={60} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">Not enough data points yet.</div>
        )}
      </div>
    </Card>
  );
}

function MyStaleIssues({ staleIssues }: { staleIssues: UserDashboardData["staleIssues"] }) {
  return (
    <Card title="My Stale Issues (>3 days)">
      <div className="space-y-3">
        {staleIssues.map(row => (
          <div key={row.id} className="flex flex-col gap-1.5 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950">
            <div className="flex justify-between items-start">
              <span className="font-medium text-sm line-clamp-1">{row.summary}</span>
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-500 whitespace-nowrap bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded">
                <RiTimeLine className="w-3.5 h-3.5" />
                {row.days_stale}d
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">{row.jira_key}</span>
              <span>{row.project_name}</span>
            </div>
          </div>
        ))}
        {staleIssues.length === 0 && <div className="text-sm text-zinc-500">You are all caught up! No recent stale tasks.</div>}
      </div>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8 animate-pulse max-w-5xl pt-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-[300px] rounded-xl" />
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    </div>
  );
}

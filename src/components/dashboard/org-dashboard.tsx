"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  Cell
} from "recharts";
import { RiErrorWarningLine, RiCheckLine, RiTimeLine } from "@remixicon/react";

type OrgDashboardData = {
  orgHealth: {
    activeIssues: number;
    completedThisWeek: number;
    completedDelta: number;
    slaViolations: number;
    unmappedWarnings: number;
    projectsSyncedToday: number;
  };
  throughput: { week: string; project_id: string; project_name: string; completed: number }[];
  wipHeatmap: { project_id: string; name: string; canonical_status: string; issue_count: number }[];
  cycleTime: { project_id: string; project_name: string; p50_hours: number; p75_hours: number; p90_hours: number }[];
  staleIssues: { project_id: string; name: string; stale_count: number }[];
  flowEfficiency: { project_id: string; project_name: string; flow_efficiency_pct: number }[];
  slaTopRules: { rule_name: string; project_name: string; trigger_count: number }[];
};

export function OrgDashboard() {
  const [data, setData] = useState<OrgDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics/dashboard")
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
    <div className="space-y-8 pb-8">
      <OrgHealthStrip health={data.orgHealth} />
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ThroughputChart throughput={data.throughput} />
        <WipHeatmap wipHeatmap={data.wipHeatmap} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
           <CycleTimeTable cycleTime={data.cycleTime} />
        </div>
        <div>
           <FlowEfficiencyChart flowEfficiency={data.flowEfficiency} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SlaViolationSummary 
          totalViolations={data.orgHealth.slaViolations} 
          topRules={data.slaTopRules} 
        />
        <StaleIssueRadar staleIssues={data.staleIssues} />
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

function OrgHealthStrip({ health }: { health: OrgDashboardData["orgHealth"] }) {
  const stats = [
    { label: "Active Issues", value: health.activeIssues },
    { 
      label: "Completed This Week", 
      value: health.completedThisWeek,
      subtext: `${health.completedDelta > 0 ? "+" : ""}${health.completedDelta}% vs last wk` 
    },
    { 
      label: "SLA Violations", 
      value: health.slaViolations,
      alert: health.slaViolations > 0 
    },
    { 
      label: "Unmapped Statuses", 
      value: health.unmappedWarnings,
      alert: health.unmappedWarnings > 0 
    },
    { label: "Projects Synced (24h)", value: health.projectsSyncedToday },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {stats.map((stat, i) => (
        <div key={i} className={`rounded-xl border p-4 shadow-sm ${stat.alert ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950'}`}>
          <div className="text-sm font-medium text-zinc-500 mb-1 flex items-center gap-1">
            {stat.label}
            {stat.alert && <RiErrorWarningLine className="w-4 h-4 text-red-500" />}
          </div>
          <div className={`text-2xl font-bold ${stat.alert ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-50'}`}>
            {stat.value}
          </div>
          {stat.subtext && (
            <div className="text-xs text-zinc-400 mt-1">{stat.subtext}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function ThroughputChart({ throughput }: { throughput: OrgDashboardData["throughput"] }) {
  // Aggregate by week across all projects for a simpler stacked bar, 
  // or group by week and show lines/bars per project. Let's do a simple stacked bar chart.
  const chartDataMap = new Map<string, any>();
  const projects = new Set<string>();

  throughput.forEach((row) => {
    const weekStr = format(new Date(row.week), "MMM d");
    if (!chartDataMap.has(weekStr)) {
      chartDataMap.set(weekStr, { name: weekStr });
    }
    const weekData = chartDataMap.get(weekStr);
    weekData[row.project_name] = row.completed;
    projects.add(row.project_name);
  });

  const chartData = Array.from(chartDataMap.values());
  const projectColors = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#6366f1"];

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
                cursor={{fill: 'transparent'}}
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              {Array.from(projects).map((proj, i) => (
                <Bar key={proj} dataKey={proj} stackId="a" fill={projectColors[i % projectColors.length]} radius={[2, 2, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">Not enough data</div>
        )}
      </div>
    </Card>
  );
}

function WipHeatmap({ wipHeatmap }: { wipHeatmap: OrgDashboardData["wipHeatmap"] }) {
  // Aggregate to Project x Stage matrix
  const statuses = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'IN_QA'];
  const dataByProject = new Map<string, Record<string, number>>();

  wipHeatmap.forEach(row => {
    if (!statuses.includes(row.canonical_status)) return;
    if (!dataByProject.has(row.name)) {
      dataByProject.set(row.name, { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, IN_QA: 0 });
    }
    dataByProject.get(row.name)![row.canonical_status] = row.issue_count;
  });

  return (
    <Card title="WIP Heatmap">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b dark:border-zinc-800">
              <th className="text-left font-medium pb-2 text-zinc-500">Project</th>
              {statuses.map(s => (
                <th key={s} className="text-center font-medium pb-2 text-zinc-500">{s.replace('_', ' ')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(dataByProject.entries()).map(([project, counts]) => (
              <tr key={project} className="border-b last:border-0 dark:border-zinc-800">
                <td className="py-3 font-medium text-zinc-900 dark:text-zinc-100">{project}</td>
                {statuses.map(s => {
                  const val = counts[s];
                  // Simple color intensity logic based on value (0-15+)
                  const intensity = Math.min(val / 15, 1);
                  return (
                    <td key={s} className="py-2 px-1">
                      <div 
                        className={`text-center py-1 rounded w-12 mx-auto font-medium ${val > 0 ? "text-white" : "text-zinc-300 dark:text-zinc-600"}`}
                        style={{ backgroundColor: val > 0 ? `rgba(99, 102, 241, ${Math.max(intensity, 0.2)})` : 'transparent' }}
                      >
                        {val}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {dataByProject.size === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-zinc-500">No active WIP found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CycleTimeTable({ cycleTime }: { cycleTime: OrgDashboardData["cycleTime"] }) {
  // Sort by P90 worst first
  const sorted = [...cycleTime].sort((a, b) => b.p90_hours - a.p90_hours);

  return (
    <Card title="Cycle Time (Hours)">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b dark:border-zinc-800 text-zinc-500">
              <th className="pb-2 font-medium">Project</th>
              <th className="pb-2 font-medium">P50 (Median)</th>
              <th className="pb-2 font-medium">P75</th>
              <th className="pb-2 font-medium text-red-500">P90 (Worst case)</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.project_id} className="border-b last:border-0 dark:border-zinc-800">
                <td className="py-3 font-medium">{row.project_name}</td>
                <td className="py-3">{row.p50_hours}h</td>
                <td className="py-3">{row.p75_hours}h</td>
                <td className="py-3 font-bold text-red-600 dark:text-red-400">{row.p90_hours}h</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={4} className="py-4 text-center text-zinc-500">No cycle time data available.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FlowEfficiencyChart({ flowEfficiency }: { flowEfficiency: OrgDashboardData["flowEfficiency"] }) {
  const sorted = [...flowEfficiency].sort((a, b) => b.flow_efficiency_pct - a.flow_efficiency_pct);
  
  return (
    <Card title="Flow Efficiency">
      <div className="space-y-4">
        {sorted.map(row => (
          <div key={row.project_id}>
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{row.project_name}</span>
              <span className={row.flow_efficiency_pct > 40 ? "text-emerald-600" : row.flow_efficiency_pct < 20 ? "text-red-500" : "text-amber-500"}>
                {row.flow_efficiency_pct}%
              </span>
            </div>
            <div className="h-2 w-full bg-zinc-100 rounded-full dark:bg-zinc-800 overflow-hidden">
              <div 
                className={`h-full rounded-full ${row.flow_efficiency_pct > 40 ? "bg-emerald-500" : row.flow_efficiency_pct < 20 ? "bg-red-500" : "bg-amber-400"}`}
                style={{ width: `${Math.min(row.flow_efficiency_pct, 100)}%` }}
              />
            </div>
          </div>
        ))}
        {sorted.length === 0 && <div className="text-sm text-zinc-500 text-center py-4">No data</div>}
      </div>
    </Card>
  );
}

function SlaViolationSummary({ totalViolations, topRules }: { totalViolations: number, topRules: OrgDashboardData["slaTopRules"] }) {
  return (
    <Card title="SLA Violations">
      <div className="mb-4">
        <div className="text-3xl font-bold text-red-600 dark:text-red-400">{totalViolations}</div>
        <div className="text-sm text-zinc-500">Active Violations Across Org</div>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Most Triggered Rules (30d)</h4>
        <div className="space-y-3">
          {topRules.map((rule, idx) => (
            <div key={idx} className="flex flex-col gap-0.5">
              <div className="flex justify-between items-start">
                <span className="text-sm font-medium">{rule.rule_name}</span>
                <span className="text-sm font-semibold bg-red-100 text-red-700 px-2 rounded-full dark:bg-red-900/30 dark:text-red-400">{rule.trigger_count}</span>
              </div>
              <div className="text-xs text-zinc-500">{rule.project_name}</div>
            </div>
          ))}
          {topRules.length === 0 && <div className="text-sm text-zinc-500">Looking good. No rules triggered recently.</div>}
        </div>
      </div>
    </Card>
  );
}

function StaleIssueRadar({ staleIssues }: { staleIssues: OrgDashboardData["staleIssues"] }) {
  const sorted = [...staleIssues].sort((a, b) => b.stale_count - a.stale_count);

  return (
    <Card title="Stale Issues Radar (>7 days)">
      <div className="space-y-3">
        {sorted.map(row => (
          <div key={row.project_id} className="flex justify-between items-center p-3 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
            <span className="font-medium text-sm">{row.name}</span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-500">
              <RiTimeLine className="w-4 h-4" />
              {row.stale_count} <span className="font-normal text-amber-700/70 dark:text-amber-500/70">stuck</span>
            </span>
          </div>
        ))}
        {sorted.length === 0 && <div className="text-sm text-zinc-500">No stale issues.</div>}
      </div>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8 pb-8">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-[300px] rounded-xl" />
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Skeleton className="md:col-span-2 h-[200px] rounded-xl" />
        <Skeleton className="h-[200px] rounded-xl" />
      </div>
    </div>
  );
}

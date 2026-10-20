"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RiCheckboxCircleFill, RiCheckboxBlankCircleLine, RiDownload2Line, RiTimeLine } from "@remixicon/react";
import { cn } from "@/lib/utils";
import { READINESS_LABELS, type ResultCounts, type SetStats, type TypeRow } from "@/lib/test-cases/analytics";
import { TC_CATEGORY_LABELS, TC_POLARITY_LABELS, type TcCategory, type TcPolarity } from "@/lib/test-cases/values";
import type { RoundTrendPoint } from "@/lib/test-cases/stats-service";

export const READINESS_STYLE: Record<SetStats["readiness"], string> = {
  not_started: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  not_recommended: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  risk: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  ready: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
};

const RESULT_COLORS = { pass: "#10b981", fail: "#ef4444", blocked: "#f59e0b", not_run: "#a1a1aa" } as const;
const RESULT_LABELS = { pass: "Passed", fail: "Failed", blocked: "Blocked", not_run: "Not run" } as const;
const RESULT_KEYS = ["pass", "fail", "blocked", "not_run"] as const;

const QUALITY_LABELS: [keyof SetStats["qualityComponents"], string, number][] = [
  ["completeness", "Completeness", 30],
  ["diversity", "Positive / negative / edge mix", 25],
  ["uniqueness", "No duplicates", 20],
  ["priorityCoverage", "Priority coverage", 15],
  ["idHygiene", "ID hygiene", 10],
];

function stackRows<K extends string>(split: Partial<Record<K, TypeRow>>, label: (k: K) => string, pick: (r: TypeRow) => ResultCounts) {
  return (Object.entries(split) as [K, TypeRow][])
    .filter(([, r]) => r.total > 0)
    .map(([k, r]) => ({ name: label(k), ...pick(r) }))
    .sort((a, b) => b.total - a.total);
}

function StackedBars({ data, height }: { data: { name: string; pass: number; fail: number; blocked: number; not_run: number }[]; height?: number }) {
  if (data.length === 0) return <p className="text-xs text-muted-foreground">Nothing to show yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(90, data.length * 28 + 36)}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 0 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" strokeOpacity={0.4} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
        <YAxis type="category" dataKey="name" width={104} tick={{ fontSize: 10 }} />
        <Tooltip cursor={{ fillOpacity: 0.08 }} contentStyle={{ fontSize: 11 }} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {RESULT_KEYS.map((k) => (
          <Bar key={k} dataKey={k} name={RESULT_LABELS[k]} stackId="r" fill={RESULT_COLORS[k]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">{title}</h3>
      {children}
    </section>
  );
}

function Check({ done, children, note }: { done: boolean; children: React.ReactNode; note?: string }) {
  return (
    <li className="flex items-start gap-1.5 text-xs">
      {done ? <RiCheckboxCircleFill className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <RiCheckboxBlankCircleLine className="mt-0.5 size-3.5 shrink-0 text-zinc-400" />}
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{children}</span>
      {note && <span className="text-[11px] text-muted-foreground">({note})</span>}
    </li>
  );
}

export function AnalyticsPanel({ issueId, stats, trend, computedAt }: { issueId: string; stats: SetStats; trend: RoundTrendPoint[]; computedAt: string }) {
  const c = stats.effective;
  const byCategory = stackRows(stats.categorySplit, (k) => TC_CATEGORY_LABELS[k as TcCategory] ?? k, (r) => r.effective);
  const byPolarity = stackRows(stats.polaritySplit, (k) => (k === "unspecified" ? "Unspecified" : TC_POLARITY_LABELS[k as TcPolarity] ?? k), (r) => r.effective);
  const byPriority = stackRows(stats.prioritySplit, (k) => (k === "none" ? "No priority" : String(k)), (r) => r.effective).sort((a, b) => a.name.localeCompare(b.name));
  const byRole = [
    { name: "Developer", ...stats.dev },
    { name: "Tester", ...stats.tester },
  ].filter((r) => r.signedOff);

  return (
    <div className="space-y-4">
      {/* Headline */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">Delivery confidence</p>
            <p className="text-3xl font-bold tabular-nums text-foreground">{stats.confidence}%</p>
          </div>
          <span className={cn("rounded-md px-2.5 py-1 text-xs font-semibold", READINESS_STYLE[stats.readiness])}>{READINESS_LABELS[stats.readiness]}</span>
          <a
            href={`/api/test-cases/issues/${issueId}/summary`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium hover:bg-zinc-50 sm:ml-auto dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            <RiDownload2Line className="size-3.5" />
            Download summary
          </a>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            {[
              ["Execution score", `${stats.executionScore}`],
              ["Quality (estimated)", `${stats.quality}`],
              ["Pass rate", `${stats.passRate}%`],
              ["Executed", `${stats.executedPct}%`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-semibold tabular-nums text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        {stats.confidenceCaps.length > 0 && (
          <ul className="mt-3 list-disc space-y-0.5 pl-4 text-[11px] text-amber-700 dark:text-amber-400">
            {stats.confidenceCaps.map((cap) => (
              <li key={cap}>{cap}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <RiTimeLine className="size-3" /> Latest round · updated {computedAt}. Confidence = 40% quality + 60% execution, capped by the rules above.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Status checklist">
          <ul className="space-y-1.5">
            <Check done={stats.tcCount > 0}>{stats.tcCount} test cases uploaded</Check>
            <Check done={stats.llmReviewed} note={stats.llmReviewed ? undefined : "not enabled yet"}>LLM reviewed</Check>
            <Check done={stats.reviewersApproved > 0}>
              Reviewer approved ({stats.reviewersApproved}/{stats.reviewersTotal})
            </Check>
            <Check done={stats.dev.signedOff}>Developer signed off</Check>
            <Check done={stats.tester.signedOff}>Tester signed off</Check>
            <Check done={stats.feedbackOpen === 0 && stats.feedbackTotal > 0} note={`${stats.feedbackOpen} open of ${stats.feedbackTotal}`}>Reviewer feedback resolved</Check>
          </ul>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {RESULT_KEYS.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] dark:border-zinc-700">
                <span className="size-2 rounded-full" style={{ background: RESULT_COLORS[k] }} />
                {RESULT_LABELS[k]} <span className="font-semibold tabular-nums">{c[k]}</span>
              </span>
            ))}
          </div>
        </Card>

        <Card title="Quality breakdown (estimated)">
          <ul className="space-y-1.5">
            {QUALITY_LABELS.map(([key, label, weight]) => {
              const v = stats.qualityComponents[key] as number;
              return (
                <li key={key} className="text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{label} <span className="text-[10px]">· weight {weight}</span></span>
                    <span className="font-semibold tabular-nums">{v}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className={cn("h-full rounded-full", v >= 75 ? "bg-emerald-500" : v >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${v}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {stats.qualityComponents.changesRequestedPenalty > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">−{stats.qualityComponents.changesRequestedPenalty} while reviewer changes are outstanding.</p>
          )}
          <p className="text-[11px] text-muted-foreground">Based on the sheet&apos;s structure. An LLM review will refine this later.</p>
        </Card>

        <Card title="Results by category"><StackedBars data={byCategory} /></Card>
        <Card title="Results by type (positive / negative / edge)"><StackedBars data={byPolarity} /></Card>
        <Card title="Results by priority"><StackedBars data={byPriority} /></Card>
        <Card title="Developer vs tester sign-off">
          {byRole.length === 0 ? <p className="text-xs text-muted-foreground">No sign-off uploaded yet.</p> : <StackedBars data={byRole} height={byRole.length * 40 + 50} />}
        </Card>
      </div>

      {trend.length > 1 && (
        <Card title="Rounds compared">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend.map((t) => ({ ...t, name: `R${t.roundNo}` }))} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="quality" name="Quality" stroke="#6366f1" strokeWidth={2} />
              <Line type="monotone" dataKey="passRate" name="Pass rate %" stroke="#10b981" strokeWidth={2} />
              <Line type="monotone" dataKey="confidence" name="Confidence" stroke="#f59e0b" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-muted-foreground">TC counts: {trend.map((t) => `R${t.roundNo} ${t.tcCount}`).join(" · ")}</p>
        </Card>
      )}
    </div>
  );
}

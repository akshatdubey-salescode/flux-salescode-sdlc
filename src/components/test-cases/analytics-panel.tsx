"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RiCheckboxCircleFill, RiCheckboxBlankCircleLine, RiDownload2Line, RiTimeLine } from "@remixicon/react";
import { cn } from "@/lib/utils";
import { FINDING_CATEGORY_LABELS } from "@/lib/test-cases/ai-review/labels";
import type { FindingCategory } from "@/lib/test-cases/ai-review/baseline";
import { READINESS_LABELS, type ResultCounts, type RoundTrendPoint, type SetStats, type TypeRow } from "@/lib/test-cases/analytics";
import {
  TC_CATEGORY_LABELS,
  TC_POLARITY_LABELS,
  AI_REVIEWER_STATE_LABELS,
  TC_REVIEWER_STATE_LABELS,
  isAiReviewer,
  TC_ROUND_STATUS_LABELS,
  type TcCategory,
  type TcPolarity,
} from "@/lib/test-cases/values";

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
    <ResponsiveContainer width="100%" height={height ?? Math.max(120, data.length * 30 + 70)}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 0 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" strokeOpacity={0.4} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
        <YAxis type="category" dataKey="name" width={104} tick={{ fontSize: 10 }} interval={0} />
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
    <section className={cn("min-w-0 space-y-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900", className)}>
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
  const byTab = stats.tabSplit && Object.keys(stats.tabSplit).length > 1 ? stackRows(stats.tabSplit, (k) => String(k), (r) => r.effective) : [];
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
        {stats.scope && stats.scope.tabs.length > 0 && (
          <Card title="Scope of this review" className="lg:col-span-2">
            <ScopeCard scope={stats.scope} />
          </Card>
        )}
        <Card title="Status checklist">
          <ul className="space-y-1.5">
            <Check done={stats.tcCount > 0}>{stats.tcCount} test cases uploaded</Check>
            <Check done={stats.llmReviewed} note={aiNote(stats)}>
              AI reviewed
            </Check>
            <Check done={stats.roundStatus === "approved"} note={TC_ROUND_STATUS_LABELS[stats.roundStatus]}>
              Reviewer approved ({stats.reviewersApproved}/{stats.reviewersTotal})
            </Check>
            <Check done={stats.dev.signedOff}>Developer signed off</Check>
            <Check done={stats.tester.signedOff}>Tester signed off</Check>
            <Check
              done={stats.feedbackOpen === 0 && stats.feedback.awaitingReReview === 0}
              note={`${stats.feedbackOpen} open of ${stats.feedbackTotal}${stats.feedback.awaitingReReview > 0 ? `, ${stats.feedback.awaitingReReview} waiting to re-review` : ""}`}
            >
              Feedback resolved or waived
            </Check>
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
            {qualityRows(stats).map(([key, label, weight, v]) => {
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
          <CoverageNote stats={stats} />
        </Card>

        <AiReviewCard stats={stats} />
        <FeedbackCard stats={stats} />

        {byTab.length > 0 && <Card title="Results by tab"><StackedBars data={byTab} /></Card>}
        <Card title="Results by category"><StackedBars data={byCategory} /></Card>
        <Card title="Results by type (positive / negative / edge)"><StackedBars data={byPolarity} /></Card>
        <Card title="Results by priority"><StackedBars data={byPriority} /></Card>
        <Card title="Developer vs tester sign-off">
          {byRole.length === 0 ? <p className="text-xs text-muted-foreground">No sign-off uploaded yet.</p> : <StackedBars data={byRole} height={byRole.length * 40 + 80} />}
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
          {trend.some((t) => t.scope) && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
              {trend.map((t) => (
                <li key={t.roundNo}>
                  <span className="font-medium text-foreground">R{t.roundNo}</span>: {t.scope ?? "all rows of the chosen tabs"}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

/** Which tabs and rows are under review, and how much of those tabs this item claims (the rest belongs to other features). */
function ScopeCard({ scope }: { scope: NonNullable<SetStats["scope"]> }) {
  return (
    <div className="space-y-2 text-xs">
      {scope.defaulted && (
        <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          No tab was named when this was submitted, so every test-case tab of the source is reviewed.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-muted-foreground dark:border-zinc-800">
              {["Tab", "Rows", "In this review", "In the whole tab"].map((h) => (
                <th key={h} className="px-2 py-1 font-semibold uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scope.tabs.map((t) => (
              <tr key={t.tab} className="border-b border-zinc-100 dark:border-zinc-800/60">
                <td className="max-w-[220px] truncate px-2 py-1 font-medium text-foreground" title={t.tab}>{t.tab}</td>
                <td className="px-2 py-1">{t.rows ?? "all"}</td>
                <td className="px-2 py-1 tabular-nums">{t.inScope}</td>
                <td className="px-2 py-1 tabular-nums">{t.totalInTab}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        This item covers <span className="font-semibold text-foreground">{scope.inScope}</span> of the {scope.totalInTabs} test cases in these tabs ({scope.coveragePct}%). The rest belong to other features that share
        the sheet and are not counted here.
      </p>
    </div>
  );
}

function FeedbackCard({ stats }: { stats: SetStats }) {
  const fb = stats.feedback;
  const counters: [string, number, string?][] = [
    ["Feedback raised", fb.raised],
    ["Open now", stats.feedbackOpen, stats.feedbackOpen > 0 ? "text-amber-600" : undefined],
    ["Resolved", fb.resolved],
    ["Waived", fb.waived],
    ["Change requests", fb.changeRequests],
    ["Resubmissions", fb.resubmissions],
    ["Overrides", fb.overrides, fb.overrides > 0 ? "text-violet-600" : undefined],
    ["AI findings", fb.llm.raised],
  ];
  const rounds = fb.perRound.map((r) => ({ name: `R${r.roundNo}`, "Change requests": r.changeRequests, Comments: r.comments, Waived: r.waived }));
  return (
    <Card title="Review feedback" className="lg:col-span-2">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-8">
        {counters.map(([label, n, cls]) => (
          <div key={label} className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
            <dd className={cn("text-base font-semibold tabular-nums text-foreground", cls)}>{n}</dd>
            <dt className="text-[10px] text-muted-foreground">{label}</dt>
          </div>
        ))}
      </dl>

      {fb.byTab && fb.byTab.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Feedback by tab</p>
          <table className="w-full min-w-[420px] border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-muted-foreground dark:border-zinc-800">
                {["Tab", "Comments", "Open now", "Resolved", "Waived", "AI"].map((h) => (
                  <th key={h} className="px-2 py-1 font-semibold uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fb.byTab.map((t) => (
                <tr key={t.tab} className="border-b border-zinc-100 dark:border-zinc-800/60">
                  <td className="max-w-[200px] truncate px-2 py-1 font-medium text-foreground" title={t.tab}>{t.tab}</td>
                  <td className="px-2 py-1 tabular-nums">{t.comments}</td>
                  <td className={cn("px-2 py-1 tabular-nums", t.open > 0 && "font-semibold text-amber-600")}>{t.open}</td>
                  <td className="px-2 py-1 tabular-nums">{t.resolved}</td>
                  <td className="px-2 py-1 tabular-nums">{t.waived}</td>
                  <td className="px-2 py-1 tabular-nums">{t.ai}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fb.byReviewer.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-muted-foreground dark:border-zinc-800">
                {["Reviewer", "Now", "Approvals", "Change requests", "Comments", "Overrides"].map((h) => (
                  <th key={h} className="px-2 py-1 font-semibold uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fb.byReviewer.map((r) => (
                <tr key={r.email} className="border-b border-zinc-100 dark:border-zinc-800/60">
                  <td className="px-2 py-1 font-medium text-foreground">{r.name ?? r.email}</td>
                  <td className="px-2 py-1 text-muted-foreground">{r.state ? (isAiReviewer(r.email) ? AI_REVIEWER_STATE_LABELS[r.state] : TC_REVIEWER_STATE_LABELS[r.state]) : "No longer a reviewer"}</td>
                  <td className="px-2 py-1 tabular-nums">{r.approvals}</td>
                  <td className="px-2 py-1 tabular-nums">{r.changeRequests}</td>
                  <td className="px-2 py-1 tabular-nums">{r.comments}</td>
                  <td className="px-2 py-1 tabular-nums">{r.overrides}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rounds.length > 1 && (
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={rounds} margin={{ left: 0, right: 12, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip cursor={{ fillOpacity: 0.08 }} contentStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="Change requests" stackId="f" fill="#f59e0b" />
            <Bar dataKey="Comments" stackId="f" fill="#6366f1" />
            <Bar dataKey="Waived" stackId="f" fill="#8b5cf6" />
          </BarChart>
        </ResponsiveContainer>
      )}
      <p className="text-[11px] text-muted-foreground">Counts cover every round; the full trail is in Review history below.</p>
    </Card>
  );
}


/** Why the quality number is what it is: the sheet's structure, and how much of the review's feedback is fixed. */
function CoverageNote({ stats }: { stats: SetStats }) {
  const cov = stats.feedback.coverage;
  if (stats.qualityComponents.reviewCoverage === null || stats.qualityComponents.reviewCoverage === undefined || !cov) {
    return <p className="text-[11px] text-muted-foreground">Based on the sheet&apos;s structure only: no AI or reviewer feedback has been recorded yet.</p>;
  }
  const sum = (b: { high: number; medium: number; low: number }) => b.high + b.medium + b.low;
  const open = sum(cov.open);
  const waived = sum(cov.waived);
  const fixed = sum(cov.addressed);
  return (
    <div className="space-y-1 text-[11px] text-muted-foreground">
      <p>
        Review coverage counts the AI review&apos;s and the reviewers&apos; points: <b className="text-foreground">{fixed}</b> fixed, <b className={cn(open > 0 ? "text-amber-600" : "text-foreground")}>{open}</b> open,{" "}
        <b className={cn(waived > 0 ? "text-amber-600" : "text-foreground")}>{waived}</b> waived by an override. Open and waived points are gaps: only fixing them (and resubmitting) raises the score. High-severity ones weigh most.
      </p>
      {cov.open.high + cov.waived.high > 0 && (
        <p className="font-medium text-amber-700 dark:text-amber-400">
          {cov.open.high + cov.waived.high} high-severity point{cov.open.high + cov.waived.high === 1 ? "" : "s"} not fixed ({cov.open.high} open, {cov.waived.high} waived): delivery confidence is capped.
        </p>
      )}
    </div>
  );
}


const QUALITY_PARTS: [keyof SetStats["qualityComponents"], string, number][] = QUALITY_LABELS;

/** The rows of the quality breakdown: the sheet's structure (scaled to what is left), then what the AI review and the reviewers raised. */
function qualityRows(stats: SetStats): [string, string, number, number][] {
  const q = stats.qualityComponents;
  const share = q.reviewCoverageShare ?? 0;
  const rows: [string, string, number, number][] = QUALITY_PARTS.map(([key, label, base]) => [key, label, Math.round((base * (100 - share)) / 100), q[key] as number]);
  if (q.aiCoverage !== null && q.aiCoverage !== undefined) rows.push(["aiCoverage", "AI review: findings fixed", q.aiShare, q.aiCoverage]);
  if (q.reviewerCoverage !== null && q.reviewerCoverage !== undefined) rows.push(["reviewerCoverage", "Reviewer feedback fixed", q.reviewerShare, q.reviewerCoverage]);
  return rows;
}

/** The note beside "AI reviewed" in the checklist: how many findings, and where they stand. */
function aiNote(stats: SetStats): string | undefined {
  if (!stats.llmReviewed) return "not run on this round yet";
  const ai = stats.feedback.ai;
  if (!ai) return undefined;
  if (ai.findings === 0) return "no findings";
  const high = ai.bySeverity.high;
  return `${ai.findings} finding${ai.findings === 1 ? "" : "s"}${high > 0 ? `, ${high} high` : ""} · ${ai.fixed} fixed, ${ai.open} open, ${ai.waived} waived`;
}

const SEVERITY_STYLE = {
  high: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
  medium: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
  low: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
} as const;

/** What the AI review found and how much of it has been dealt with; it feeds the quality estimate. */
function AiReviewCard({ stats }: { stats: SetStats }) {
  const ai = stats.feedback.ai;
  if (!stats.llmReviewed && (!ai || ai.findings === 0)) return null;
  const q = stats.qualityComponents;
  if (!ai || ai.findings === 0) {
    return (
      <Card title="AI review">
        <p className="text-xs text-foreground">The AI review ran and raised no findings.</p>
        <p className="text-[11px] text-muted-foreground">That counts as fully covered in the quality estimate.</p>
      </Card>
    );
  }
  const total = ai.findings;
  const seg = [
    ["Fixed", ai.fixed, "bg-emerald-500"],
    ["Open", ai.open, "bg-red-500"],
    ["Waived by an override", ai.waived, "bg-amber-500"],
  ] as const;
  return (
    <Card title="AI review">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums text-foreground">{total}</span>
        <span className="text-xs text-muted-foreground">finding{total === 1 ? "" : "s"} across all rounds</span>
        {q.aiCoverage !== null && q.aiCoverage !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground">
            Quality: <b className="tabular-nums text-foreground">{q.aiCoverage}</b>/100 fixed (counts {q.aiShare}% of quality)
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(["high", "medium", "low"] as const).map((k) => (
          <span key={k} className={cn("rounded-full border px-2 py-0.5 text-[11px] capitalize", SEVERITY_STYLE[k])}>
            {k} <span className="font-semibold tabular-nums">{ai.bySeverity[k]}</span>
          </span>
        ))}
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="img" aria-label={`${ai.fixed} fixed, ${ai.open} open, ${ai.waived} waived`}>
        {seg.map(([label, n, cls]) => (n > 0 ? <div key={label} className={cls} style={{ width: `${(100 * n) / total}%` }} title={`${label}: ${n}`} /> : null))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {seg.map(([label, n, cls]) => (
          <span key={label} className="inline-flex items-center gap-1">
            <span className={cn("size-2 rounded-full", cls)} />
            {label} <span className="font-semibold tabular-nums text-foreground">{n}</span>
          </span>
        ))}
      </div>
      {ai.categories.length > 0 && (
        <div className="space-y-0.5 pt-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">What it found</p>
          <ul className="text-[11px]">
            {ai.categories.slice(0, 6).map((c) => (
              <li key={c.category} className="flex justify-between gap-2 border-b border-zinc-100 py-0.5 dark:border-zinc-800/60">
                <span className="truncate text-foreground">{FINDING_CATEGORY_LABELS[c.category as FindingCategory] ?? c.category}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {c.total}
                  {c.notFixed > 0 && <span className="text-amber-600"> · {c.notFixed} not fixed</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

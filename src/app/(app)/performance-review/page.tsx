import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { requireAuth } from "@/lib/auth/server";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { selectableQuarters, currentQuarter } from "@/lib/scorecard/quarter";
import { SCORE_SCALE } from "@/lib/scorecard/config";
import { fetchScorecards, fetchScorecardDetail } from "./data";
import { getVisibleColumns } from "./visible-columns";
import { ReviewControls } from "./controls";
import { LeaderboardTable } from "./leaderboard-table";
import { ScoringGuide } from "./scoring-guide";
import { MetricMeaningModal } from "./metric-meaning-modal";
import { FeatureTasksTable } from "./feature-tasks-table";
import { formatComplexityAccuracy } from "./complexity-accuracy-stat";
import { complexTasksCalc, findComplexTasksMetric } from "./rating-calc";

type SearchParams = Promise<{ quarter?: string; person?: string }>;

function fmtPoints(p: number | null | undefined): string {
  return p == null ? "—" : p.toFixed(2);
}

function fmtDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr ? `${d}d ${hr}h` : `${d}d`;
}

function resolveQuarterKey(raw: string | undefined): string {
  const quarters = selectableQuarters();
  if (raw && quarters.some((q) => q.key === raw)) return raw;
  return currentQuarter().key;
}

/**
 * Renders a Jira issue key. When the issue's instance URL is known it links to
 * the original Jira issue, opening in a new tab; otherwise it's plain text.
 */
function JiraKeyLink({ item }: { item: { key: string; url?: string } }) {
  if (!item.url) return <>{item.key}</>;
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:underline dark:text-blue-400"
    >
      {item.key}
    </a>
  );
}

const SCORE_NSA_E_INFO =
  "Same formula as Score (Bug Quality + MTTR + Sprint Commitment + Complex Tasks), but computed with self-assigned Jiras excluded and Complex Tasks weighted by LOC-predicted complexity instead of marked. Unlike Complex. NSA. (E) below (Complex Tasks contribution alone, 0-30), this is the full four-metric composite, 0-100 — directly comparable to Score.";

/** One Complexity Accuracy reading: correct/checked (pct%), or a dash. */
function ComplexityAccuracyStat({
  correct,
  checked,
}: {
  correct: number;
  checked: number;
}) {
  return <>{formatComplexityAccuracy(correct, checked)}</>;
}

/** One KPI card in the metrics grid: label, detail line, and a points/weight/contribution stat row. */
function MetricCard({
  label,
  detail,
  points,
  weight,
  contribution,
  dimmed,
}: {
  label: string;
  detail: ReactNode;
  points: ReactNode;
  weight?: number;
  contribution?: ReactNode;
  dimmed?: boolean;
}) {
  return (
    <Card className={cn("gap-1 py-3", dimmed && "opacity-50")}>
      <CardHeader className="gap-0.5 px-4">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {label}
        </CardTitle>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">{detail}</p>
      </CardHeader>
      <CardContent className="px-4">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular-nums">{points}</span>
          {weight != null && (
            <span className="text-xs text-zinc-500">weight {weight.toFixed(2)}</span>
          )}
        </div>
        {contribution != null && (
          <p className="mt-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {contribution}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function PerformanceReviewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireAuth();
  const canRecompute = user.role === "SUPERUSER";

  const sp = await searchParams;
  const quarters = selectableQuarters();
  const quarterKey = resolveQuarterKey(sp.quarter);
  const quarterLabel =
    quarters.find((q) => q.key === quarterKey)?.label ?? quarterKey;

  // ---- Drill-down: one developer's full breakdown ----
  if (sp.person) {
    const detail = await fetchScorecardDetail(sp.person, quarterKey);

    return (
      <div className="flex min-h-svh flex-col bg-zinc-50 dark:bg-zinc-950">
        <PageHeader>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={`/performance-review?quarter=${quarterKey}`}>
                    Performance Review
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{detail?.name ?? sp.person}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageHeader>

        <main className="flex-1 p-6">
          <div className="mx-auto max-w-4xl space-y-6">
            {!detail ? (
              <p className="text-sm text-zinc-500">
                No scorecard found for this developer in {quarterLabel}.
              </p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                      {detail.name}
                    </h1>
                    <p className="mt-1 font-mono text-xs text-zinc-500">
                      {detail.email}
                    </p>
                    <p className="mt-4 text-sm text-zinc-500">
                      Score for <strong>{quarterLabel}</strong>:{" "}
                      <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                        {detail.finalScore.toFixed(1)}
                      </span>{" "}
                      / 100
                    </p>
                    <p className="mt-1 text-sm text-zinc-500" title={SCORE_NSA_E_INFO}>
                      Score NSA. (E) for <strong>{quarterLabel}</strong>:{" "}
                      <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                        {detail.scoreNsaExpected.toFixed(1)}
                      </span>{" "}
                      / 100
                    </p>
                  </div>
                  <MetricMeaningModal detail={detail} />
                </div>

                <Tabs defaultValue="metrics" className="w-full">
                  <div className="overflow-x-auto">
                    <TabsList>
                      <TabsTrigger value="metrics">
                        Metrics
                      </TabsTrigger>
                      <TabsTrigger value="bugs">
                        Weighted bugs ({detail.weightedBugItems.length})
                      </TabsTrigger>
                      <TabsTrigger value="features">
                        Feature tasks ({detail.featureItems.length})
                      </TabsTrigger>
                      <TabsTrigger value="mttr">
                        MTTR samples ({detail.mttrItems.length})
                      </TabsTrigger>
                      <TabsTrigger value="complexity">
                        Complexity ({detail.complexTasksCount})
                      </TabsTrigger>
                      <TabsTrigger value="expected-complexity">
                        Expected Complexity ({detail.complexTasksCount})
                      </TabsTrigger>
                      <TabsTrigger value="missing-dates">
                        Missing dates ({detail.missingActualDateItems.length})
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="metrics" className="space-y-6 pt-6 pb-6">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {detail.breakdown.metrics.map((m) => (
                    <Fragment key={m.key}>
                      <MetricCard
                        label={m.label}
                        detail={m.available ? m.raw : "N/A — not tracked"}
                        points={m.available ? fmtPoints(m.points) : "N/A"}
                        weight={m.weight}
                        contribution={
                          m.available
                            ? `${m.contribution.toFixed(2)} / ${(m.weight * 5 * SCORE_SCALE).toFixed(2)}`
                            : "—"
                        }
                        dimmed={!m.available}
                      />
                      {m.key === "codeChurn" && (
                        <>
                          <MetricCard
                            label="Complex. (M)"
                            detail={(() => {
                              const cm = findComplexTasksMetric(detail.breakdown.metrics);
                              return cm ? complexTasksCalc(cm) : "Recompute to see the breakdown";
                            })()}
                            points={`${detail.markedComplexityScoreAll.toFixed(1)} / 30`}
                          />
                          <MetricCard
                            label="Complex. (E)"
                            detail={(() => {
                              const ce = findComplexTasksMetric(detail.breakdown.expectedAllMetrics);
                              return ce ? complexTasksCalc(ce) : "Recompute to see the breakdown";
                            })()}
                            points={`${detail.expectedComplexityScoreAll.toFixed(1)} / 30`}
                          />
                          <MetricCard
                            label="Complex. NSA. (M)"
                            detail={(() => {
                              const nm = findComplexTasksMetric(detail.breakdown.nsaMetrics);
                              return nm ? complexTasksCalc(nm) : "Recompute to see the breakdown";
                            })()}
                            points={`${detail.markedComplexityScore.toFixed(1)} / 30`}
                          />
                          <MetricCard
                            label="Complex. NSA. (E)"
                            detail={(() => {
                              const ne = findComplexTasksMetric(detail.breakdown.nsaExpectedMetrics);
                              return ne ? complexTasksCalc(ne) : "Recompute to see the breakdown";
                            })()}
                            points={`${detail.expectedComplexityScore.toFixed(1)} / 30`}
                          />
                          <MetricCard
                            label="Complexity Accuracy (all Jiras)"
                            detail={
                              <ComplexityAccuracyStat
                                correct={detail.complexityAccuracyAllCorrect}
                                checked={detail.complexityAccuracyAllChecked}
                              />
                            }
                            points={
                              <ComplexityAccuracyStat
                                correct={detail.complexityAccuracyAllCorrect}
                                checked={detail.complexityAccuracyAllChecked}
                              />
                            }
                          />
                          <MetricCard
                            label="Complexity Accuracy (NSA only)"
                            detail={
                              <ComplexityAccuracyStat
                                correct={detail.complexityAccuracyCorrect}
                                checked={detail.complexityAccuracyChecked}
                              />
                            }
                            points={
                              <ComplexityAccuracyStat
                                correct={detail.complexityAccuracyCorrect}
                                checked={detail.complexityAccuracyChecked}
                              />
                            }
                          />
                        </>
                      )}
                    </Fragment>
                  ))}
                  <Card className="gap-1 border-zinc-300 bg-zinc-50 py-3 dark:border-zinc-700 dark:bg-zinc-900/60">
                    <CardHeader className="gap-0.5 px-4">
                      <CardTitle className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Final score
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4">
                      <span className="text-2xl font-bold tabular-nums">
                        {detail.finalScore.toFixed(1)}
                      </span>
                      <span className="font-normal text-zinc-400">
                        {" "}
                        /{" "}
                        {detail.breakdown.metrics
                          .reduce((s, m) => s + m.weight * 5 * SCORE_SCALE, 0)
                          .toFixed(0)}
                      </span>
                    </CardContent>
                  </Card>
                  <Card
                    className="gap-1 border-zinc-300 bg-zinc-50/60 py-3 dark:border-zinc-700 dark:bg-zinc-900/40"
                    title={SCORE_NSA_E_INFO}
                  >
                    <CardHeader className="gap-0.5 px-4">
                      <CardTitle className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Score NSA. (E)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4">
                      <span className="text-2xl font-bold tabular-nums">
                        {detail.scoreNsaExpected.toFixed(1)}
                      </span>
                      <span className="font-normal text-zinc-400"> / 100</span>
                    </CardContent>
                  </Card>
                </div>

                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Final score = Σ (weight × points) × 20, on a 0–100 scale. A
                  missing sub-score counts as 0 but its weight still occupies the
                  scale. Code Churn and Effort are not tracked on this platform,
                  and AI Tasks is currently excluded from the rating — all three
                  carry weight 0, so they don&apos;t affect the score.
                </p>
                  </TabsContent>

                  <TabsContent value="bugs" className="pt-6">
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Weighted bugs ({detail.weightedBugItems.length}) ·{" "}
                    {detail.weightedBugs} total weight
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Bugs attributed to this developer (as Issue Owner, or assignee
                    when no owner is set), each weighted by priority. Higher total
                    weight lowers the Bug Quality score. Bugs whose status is{" "}
                    <span className="font-medium text-zinc-600 dark:text-zinc-300">
                      “Not a bug”
                    </span>{" "}
                    or{" "}
                    <span className="font-medium text-zinc-600 dark:text-zinc-300">
                      “Can’t Reproduce”
                    </span>{" "}
                    are excluded entirely — they count toward neither weighted bugs
                    nor MTTR.
                  </p>
                  <div className="max-h-96 overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0">
                        <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/95">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Key
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Summary
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Priority
                          </th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Weight
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.weightedBugItems.map((b) => (
                          <tr
                            key={b.key}
                            className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                          >
                            <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-xs text-zinc-600 dark:text-zinc-300">
                              <JiraKeyLink item={b} />
                            </td>
                            <td className="px-4 py-2.5 align-top text-zinc-700 dark:text-zinc-300">
                              {b.summary}
                            </td>
                            <td className="px-4 py-2.5 align-top text-zinc-600 dark:text-zinc-400">
                              {b.priority ?? "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right align-top font-semibold tabular-nums">
                              {b.weight}
                            </td>
                          </tr>
                        ))}
                        {detail.weightedBugItems.length === 0 && (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-4 py-8 text-center text-sm text-zinc-400"
                            >
                              No bugs attributed to this developer this quarter.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                  </TabsContent>

                  <TabsContent value="features" className="pt-6">
                <FeatureTasksTable
                  items={detail.featureItems}
                  isSuperuser={canRecompute}
                  quarterKey={quarterKey}
                />
                  </TabsContent>

                  <TabsContent value="mttr" className="pt-6">
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    MTTR samples ({detail.mttrItems.length})
                    {detail.mttrMinutes != null && (
                      <span className="ml-2 font-normal text-zinc-500">
                        avg {fmtDuration(detail.mttrMinutes)}
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    P1/P2 bugs owned by this developer (Issue Owner, assignee
                    fallback). Resolution time spans the developer work-window — see
                    “How dates are captured” below — not the full ticket lifetime.
                    Their average drives the MTTR score; with no samples the metric
                    defaults to a full 5.
                  </p>
                  <div className="max-h-96 overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0">
                        <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/95">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Key
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Summary
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Priority
                          </th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Resolution time
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.mttrItems.map((b) => (
                          <tr
                            key={b.key}
                            className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                          >
                            <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-xs text-zinc-600 dark:text-zinc-300">
                              <JiraKeyLink item={b} />
                            </td>
                            <td className="px-4 py-2.5 align-top text-zinc-700 dark:text-zinc-300">
                              {b.summary}
                            </td>
                            <td className="px-4 py-2.5 align-top text-zinc-600 dark:text-zinc-400">
                              {b.priority ?? "—"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right align-top tabular-nums">
                              {fmtDuration(b.minutes)}
                            </td>
                          </tr>
                        ))}
                        {detail.mttrItems.length === 0 && (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-4 py-8 text-center text-sm text-zinc-400"
                            >
                              No P1/P2 bug resolutions this quarter — MTTR scored 5 by
                              default.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                  </TabsContent>

                  <TabsContent value="complexity" className="pt-6">
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Complexity distribution ({detail.complexTasksCount} task
                    {detail.complexTasksCount === 1 ? "" : "s"})
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Every completed task counts toward Complex Tasks, weighted by its
                    complexity (C1 = 1, C2 = 3, C3 = 5, C4 = 7, C5 = 10). The average
                    weight, combined with volume, sets the score.
                  </p>
                  <div className="overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/95">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Complexity
                          </th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Tasks
                          </th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Weight each
                          </th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Total weight
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.complexityBuckets.map((c) => (
                          <tr
                            key={c.label}
                            className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                          >
                            <td className="whitespace-nowrap px-4 py-2.5 align-top font-medium text-zinc-900 dark:text-zinc-100">
                              {c.label}
                            </td>
                            <td className="px-4 py-2.5 text-right align-top tabular-nums text-zinc-700 dark:text-zinc-300">
                              {c.count}
                            </td>
                            <td className="px-4 py-2.5 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                              {c.weightEach}
                            </td>
                            <td className="px-4 py-2.5 text-right align-top font-semibold tabular-nums">
                              {c.totalWeight}
                            </td>
                          </tr>
                        ))}
                        {detail.complexityBuckets.length === 0 ? (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-4 py-8 text-center text-sm text-zinc-400"
                            >
                              No tasks completed this quarter.
                            </td>
                          </tr>
                        ) : (
                          (() => {
                            const tasks = detail.complexityBuckets.reduce(
                              (s, c) => s + c.count,
                              0
                            );
                            const weight = detail.complexityBuckets.reduce(
                              (s, c) => s + c.totalWeight,
                              0
                            );
                            return (
                              <tr className="bg-zinc-50 dark:bg-zinc-900/60">
                                <td className="px-4 py-2.5 text-sm font-semibold">
                                  Total
                                </td>
                                <td className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums">
                                  {tasks}
                                </td>
                                <td className="px-4 py-2.5 text-right text-xs text-zinc-500">
                                  avg {(weight / tasks).toFixed(2)}
                                </td>
                                <td className="px-4 py-2.5 text-right text-sm font-bold tabular-nums">
                                  {weight}
                                </td>
                              </tr>
                            );
                          })()
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                  </TabsContent>

                  <TabsContent value="expected-complexity" className="pt-6">
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Expected Complexity distribution ({detail.complexTasksCount} task
                    {detail.complexTasksCount === 1 ? "" : "s"})
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Sibling of the distribution above, using each task&apos;s
                    LOC-predicted complexity instead of the marked value — same
                    weights (C1 = 1, C2 = 3, C3 = 5, C4 = 7, C5 = 10), same
                    tasks, just bucketed by what the code actually looked like
                    rather than what was marked in Jira. Feeds Complex. (E) /
                    Complex. NSA. (E) the same way the distribution above feeds
                    Complex. (M) / Complex. NSA. (M).
                  </p>
                  <div className="overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/95">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Complexity
                          </th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Tasks
                          </th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Weight each
                          </th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Total weight
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.expectedComplexityBuckets.map((c) => (
                          <tr
                            key={c.label}
                            className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                          >
                            <td className="whitespace-nowrap px-4 py-2.5 align-top font-medium text-zinc-900 dark:text-zinc-100">
                              {c.label}
                            </td>
                            <td className="px-4 py-2.5 text-right align-top tabular-nums text-zinc-700 dark:text-zinc-300">
                              {c.count}
                            </td>
                            <td className="px-4 py-2.5 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                              {c.weightEach}
                            </td>
                            <td className="px-4 py-2.5 text-right align-top font-semibold tabular-nums">
                              {c.totalWeight}
                            </td>
                          </tr>
                        ))}
                        {detail.expectedComplexityBuckets.length === 0 ? (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-4 py-8 text-center text-sm text-zinc-400"
                            >
                              No tasks completed this quarter.
                            </td>
                          </tr>
                        ) : (
                          (() => {
                            const tasks = detail.expectedComplexityBuckets.reduce(
                              (s, c) => s + c.count,
                              0
                            );
                            const weight = detail.expectedComplexityBuckets.reduce(
                              (s, c) => s + c.totalWeight,
                              0
                            );
                            return (
                              <tr className="bg-zinc-50 dark:bg-zinc-900/60">
                                <td className="px-4 py-2.5 text-sm font-semibold">
                                  Total
                                </td>
                                <td className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums">
                                  {tasks}
                                </td>
                                <td className="px-4 py-2.5 text-right text-xs text-zinc-500">
                                  avg {(weight / tasks).toFixed(2)}
                                </td>
                                <td className="px-4 py-2.5 text-right text-sm font-bold tabular-nums">
                                  {weight}
                                </td>
                              </tr>
                            );
                          })()
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                  </TabsContent>

                  <TabsContent value="missing-dates" className="pt-6">
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Issues missing Actual start / end ({detail.missingActualDateItems.length})
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Scored issues this quarter without a team-set{" "}
                    <span className="font-medium text-zinc-600 dark:text-zinc-300">
                      Actual start
                    </span>{" "}
                    and/or{" "}
                    <span className="font-medium text-zinc-600 dark:text-zinc-300">
                      Actual end
                    </span>{" "}
                    date. For these, the time-based metrics fell back to the
                    status-history dev-window (or Jira created/completed) — see
                    “How dates are captured” above. Filling these fields in Jira
                    makes MTTR and Sprint Commitment more accurate.
                  </p>
                  <div className="max-h-96 overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0">
                        <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/95">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Key
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Summary
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Actual start
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Actual end
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.missingActualDateItems.map((m) => (
                          <tr
                            key={m.key}
                            className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                          >
                            <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-xs text-zinc-600 dark:text-zinc-300">
                              <JiraKeyLink item={m} />
                            </td>
                            <td className="px-4 py-2.5 align-top text-zinc-700 dark:text-zinc-300">
                              {m.summary}
                            </td>
                            <td className="px-4 py-2.5 align-top">
                              {m.missingStart ? (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                                  Missing
                                </span>
                              ) : (
                                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                                  Set
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 align-top">
                              {m.missingEnd ? (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                                  Missing
                                </span>
                              ) : (
                                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                                  Set
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {detail.missingActualDateItems.length === 0 && (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-4 py-8 text-center text-sm text-zinc-400"
                            >
                              Every scored issue this quarter has both Actual start
                              and Actual end set.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ---- Leaderboard ----
  const rows = await fetchScorecards(quarterKey);
  const computedAt = rows[0]?.computedAt ?? null;
  const visibleColumns = await getVisibleColumns();

  return (
    <div className="flex min-h-svh flex-col bg-zinc-50 dark:bg-zinc-950">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Performance Review</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Performance Review
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-zinc-500">
                Suggested quarterly ratings for developers, scored out of 100
                from synced Jira data. A decision aid, not a verdict.
              </p>
            </div>
            <ScoringGuide />
          </div>

          <ReviewControls
            quarters={quarters}
            selectedKey={quarterKey}
            computedAt={computedAt}
            canRecompute={canRecompute}
          />

          <LeaderboardTable
            rows={rows}
            quarterKey={quarterKey}
            quarterLabel={quarterLabel}
            visibleColumns={visibleColumns}
          />
        </div>
      </main>
    </div>
  );
}

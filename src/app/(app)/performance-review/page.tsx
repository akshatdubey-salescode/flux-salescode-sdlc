import Link from "next/link";
import { requireAuth } from "@/lib/auth/server";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { selectableQuarters, currentQuarter } from "@/lib/scorecard/quarter";
import { WEIGHTS } from "@/lib/scorecard/config";
import { METRIC_INFO } from "@/lib/scorecard/metric-descriptions";
import { fetchScorecards, fetchScorecardDetail } from "./data";
import { ReviewControls } from "./controls";
import { LeaderboardTable } from "./leaderboard-table";

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
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {detail.name}
                  </h1>
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    {detail.email}
                  </p>
                  <p className="mt-3 text-sm text-zinc-500">
                    Suggested rating for <strong>{quarterLabel}</strong>:{" "}
                    <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      {detail.finalScore.toFixed(2)}
                    </span>{" "}
                    / 5.00
                  </p>
                </div>

                <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/80">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          Metric
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          Detail
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          Points
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          Weight
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          Contribution
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.breakdown.metrics.map((m) => (
                        <tr
                          key={m.key}
                          className={
                            "border-b border-zinc-100 last:border-0 dark:border-zinc-800/60 " +
                            (m.available ? "" : "opacity-50")
                          }
                        >
                          <td className="px-4 py-3 align-top font-medium text-zinc-900 dark:text-zinc-100">
                            {m.label}
                          </td>
                          <td className="px-4 py-3 align-top text-zinc-600 dark:text-zinc-400">
                            {m.available ? m.raw : "N/A — not tracked"}
                          </td>
                          <td className="px-4 py-3 text-right align-top tabular-nums">
                            {m.available ? fmtPoints(m.points) : "N/A"}
                          </td>
                          <td className="px-4 py-3 text-right align-top tabular-nums text-zinc-500">
                            {m.weight.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right align-top font-semibold tabular-nums">
                            {m.available ? m.contribution.toFixed(3) : "—"}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-zinc-50 dark:bg-zinc-900/60">
                        <td
                          colSpan={4}
                          className="px-4 py-3 text-right text-sm font-semibold"
                        >
                          Final score
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">
                          {detail.finalScore.toFixed(3)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Final score = Σ (weight × points), on a 0–5 scale. A missing
                  sub-score counts as 0 but its weight still occupies the scale.
                  Code Churn and Effort are not tracked on this platform (weight 0),
                  so they don&apos;t affect the score.
                </p>

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

                <section className="space-y-3">
                  <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Feature tasks ({detail.featureItems.length})
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Non-bug tasks the developer completed this quarter, counted as
                    feature output for the Bug Quality score.
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
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Complexity
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.featureItems.map((t) => (
                          <tr
                            key={t.key}
                            className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                          >
                            <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-xs text-zinc-600 dark:text-zinc-300">
                              <JiraKeyLink item={t} />
                            </td>
                            <td className="px-4 py-2.5 align-top text-zinc-700 dark:text-zinc-300">
                              {t.summary}
                            </td>
                            <td className="px-4 py-2.5 text-right align-top tabular-nums text-zinc-600 dark:text-zinc-400">
                              {t.complexity ?? "—"}
                            </td>
                          </tr>
                        ))}
                        {detail.featureItems.length === 0 && (
                          <tr>
                            <td
                              colSpan={3}
                              className="px-4 py-8 text-center text-sm text-zinc-400"
                            >
                              No feature tasks completed this quarter.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

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
                    fallback), with time from creation to completion. Their average
                    drives the MTTR score; with no samples the metric defaults to a
                    full 5.
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

                <section className="space-y-3">
                  <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    What each metric means
                  </h2>
                  <dl className="space-y-3">
                    {detail.breakdown.metrics.map((m) => {
                      const info = METRIC_INFO[m.key];
                      return (
                        <div
                          key={m.key}
                          className={
                            "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 " +
                            (m.available ? "" : "opacity-70")
                          }
                        >
                          <dt className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                              {m.label}
                            </span>
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                              weight {m.weight.toFixed(2)}
                            </span>
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                              range {info.range}
                            </span>
                            {m.weight === 0 && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                                does not affect score
                              </span>
                            )}
                          </dt>
                          <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                            {info.detail}
                          </dd>
                          <dd className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                            This developer:{" "}
                            <span className="text-zinc-700 dark:text-zinc-300">
                              {m.available ? m.raw : "N/A — not tracked"}
                            </span>{" "}
                            →{" "}
                            <span className="font-medium text-zinc-700 dark:text-zinc-300">
                              {m.available
                                ? `${fmtPoints(m.points)} points`
                                : "no points"}
                            </span>
                            {m.available && m.weight > 0 && (
                              <>
                                {" "}
                                (contributes {m.contribution.toFixed(3)} to the
                                final score)
                              </>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </section>
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
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Performance Review
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-500">
              Suggested quarterly ratings for developers, derived from synced Jira
              data across five weighted metrics — Bug Quality ({WEIGHTS.bugQuality}),
              Sprint Commitment ({WEIGHTS.sprintCommitment}), Complex Tasks (
              {WEIGHTS.complexTasks}), MTTR ({WEIGHTS.mttr}), and AI Tasks (
              {WEIGHTS.aiTasks}). Scores are a decision aid, not a verdict. Click a
              name for the full breakdown.
            </p>
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
          />
        </div>
      </main>
    </div>
  );
}

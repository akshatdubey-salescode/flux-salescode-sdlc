import { notFound } from "next/navigation";
import Link from "next/link";
import {
  RiAddLine,
  RiDownload2Line,
  RiExternalLinkLine,
  RiFileExcel2Line,
  RiGoogleLine,
} from "@remixicon/react";
import { requireAuth } from "@/lib/auth/server";
import { hasMinRole } from "@/lib/auth/types";
import { FEATURE_FLAGS, isEnabled } from "@/lib/feature-flags";
import { isValidUuid } from "@/lib/validation";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import { CasesTable } from "@/components/test-cases/cases-table";
import { ReviewPanel } from "@/components/test-cases/review-panel";
import { AnalyticsPanel } from "@/components/test-cases/analytics-panel";
import { HistoryPanel } from "@/components/test-cases/history-panel";
import { DeletePanel } from "@/components/test-cases/delete-panel";
import { SignoffPanel } from "@/components/test-cases/signoff-panel";
import { BackLink } from "@/components/test-cases/back-link";
import { returnLabel, safeReturnTo, withReturnTo } from "@/lib/test-cases/return-to";
import { countOpenFeedback, fetchFeedbackFiles, fetchRoundComments } from "@/lib/test-cases/review-service";
import { fetchSetDetail, findIssue, sameWorkbookElsewhere } from "@/lib/test-cases/service";
import { fetchStoredStats } from "@/lib/test-cases/stats-service";
import { canSignOff } from "@/lib/test-cases/state";
import { fetchSignoffs, getIssuePeople } from "@/lib/test-cases/signoff-service";
import { istDateTime } from "@/lib/test-cases/filenames";
import { fetchHistory } from "@/lib/test-cases/history-service";
import {
  TC_CATEGORY_LABELS,
  TC_POLARITY_LABELS,
  TC_ROUND_STATUS_LABELS,
  type TcCategory,
  type TcPolarity,
  type TcRoundStatus,
} from "@/lib/test-cases/values";

type Props = {
  params: Promise<{ issueId: string }>;
  searchParams: Promise<{ round?: string; from?: string }>;
};

const ROUND_STATUS_STYLE: Record<string, string> = {
  in_review: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  changes_requested: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
};

function fmtSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function TestCaseDetailsPage({ params, searchParams }: Props) {
  const user = await requireAuth();
  if (!(await isEnabled(FEATURE_FLAGS.TEST_CASES))) notFound();

  const { issueId } = await params;
  const sp = await searchParams;
  const returnTo = safeReturnTo(sp.from);
  // Accept the internal id, or a Jira key for convenience.
  const lookup = await findIssue(isValidUuid(issueId) ? { issueId } : { key: issueId });
  if (lookup.kind === "none") notFound();
  if (lookup.kind === "ambiguous") {
    return (
      <div className="p-6 text-sm">
        That key exists in more than one project:{" "}
        {lookup.issues.map((i) => (
          <Link key={i.id} href={`/test-cases/${i.id}`} className="mr-3 text-primary hover:underline">
            {i.jiraKey} ({i.projectName})
          </Link>
        ))}
      </div>
    );
  }
  const issue = lookup.issue;
  const wanted = sp.round && /^\d+$/.test(sp.round) ? Number(sp.round) : undefined;
  const detail = await fetchSetDetail(issue.id, wanted);
  const round = detail?.rounds.find((r) => r.roundNo === detail.selectedRoundNo);
  const [comments, feedbackByRound] =
    detail && round
      ? await Promise.all([fetchRoundComments(round.id), fetchFeedbackFiles(detail.setId)])
      : [[], new Map()];
  const viewer = { email: user.email, isAdmin: hasMinRole(user.role, "ADMIN") };
  const isLatest = !!detail && round?.roundNo === detail.rounds[0]?.roundNo;
  const roundApproved = round?.status === "approved";

  const [stored, signoffs, people, openFeedback, history, sameWorkbook] =
    detail && round
      ? await Promise.all([
          fetchStoredStats(detail.setId),
          fetchSignoffs(round.id),
          getIssuePeople(issue.id),
          countOpenFeedback(round.id),
          fetchHistory(detail.setId),
          sameWorkbookElsewhere(round.id),
        ])
      : [null, [], { dev: [], qa: [] }, 0, { events: [], items: [] }, []];
  const needsResubmit = isLatest && round?.status === "changes_requested";
  const signoffActions = (["dev", "tester"] as const).map((role) => {
    const v = canSignOff({ role, actor: viewer, people, roundApproved, isLatestRound: isLatest, openFeedback });
    return { role, allowed: v.ok, reason: v.ok ? null : v.reason };
  });
  const jiraUrl = `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;

  const categoryCounts = new Map<string, number>();
  const polarityCounts = new Map<string, number>();
  for (const c of detail?.cases ?? []) {
    categoryCounts.set(c.category, (categoryCounts.get(c.category) ?? 0) + 1);
    if (c.polarity) polarityCounts.set(c.polarity, (polarityCounts.get(c.polarity) ?? 0) + 1);
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader
        actions={
          <Link
            href={withReturnTo(`/test-cases/new?issue=${issue.id}`, returnTo)}
            className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground"
          >
            <RiAddLine className="size-3.5" />
            {!detail ? "Submit test cases" : needsResubmit ? "Resubmit TCs" : "New round"}
          </Link>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild><Link href="/home">Home</Link></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Test cases · {issue.jiraKey}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <BackLink href={returnTo ?? "/home"} label={returnLabel(returnTo)} />
          {/* Issue header */}
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <a href={jiraUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono font-semibold text-foreground hover:underline">
                {issue.jiraKey}
                <RiExternalLinkLine className="size-3 opacity-60" />
              </a>
              <span>{issue.issueType}</span>
              <span>·</span>
              <span>{issue.status}</span>
              <span>·</span>
              <span>{issue.projectName}</span>
            </div>
            <h1 className="mt-1.5 text-base font-semibold text-foreground">{issue.summary}</h1>
          </section>

          {!detail || !round ? (
            <section className="rounded-xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
              <p className="text-sm font-medium text-foreground">No test cases submitted for this issue yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">Share a Google Sheet link (preferred) or upload an Excel file, and assign reviewers.</p>
              <Link href={withReturnTo(`/test-cases/new?issue=${issue.id}`, returnTo)} className="mt-4 inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground">
                Submit test cases
              </Link>
            </section>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
              {/* Rounds timeline */}
              <aside className="space-y-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">Rounds</h2>
                <ol className="space-y-1.5">
                  {detail.rounds.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={withReturnTo(`/test-cases/${issue.id}?round=${r.roundNo}`, returnTo)}
                        className={cn(
                          "block rounded-lg border px-3 py-2 text-xs transition-colors",
                          r.roundNo === round.roundNo
                            ? "border-primary/40 bg-primary/5"
                            : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30",
                        )}
                      >
                        <p className="font-semibold text-foreground">{r.label}</p>
                        <p className="text-muted-foreground">
                          {r.tcCount} TCs · {r.committedByName ?? r.committedBy}
                        </p>
                        <span className={cn("mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold", ROUND_STATUS_STYLE[r.status])}>
                          {TC_ROUND_STATUS_LABELS[r.status as TcRoundStatus] ?? r.status}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </aside>

              <div className="min-w-0 space-y-5">
                {!isLatest && (
                  <p className="flex flex-wrap items-center gap-x-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                    <span>
                      You&apos;re viewing {round.label}, which was superseded. It is read-only: analytics, review actions and sign-off apply to the latest round.
                    </span>
                    <Link href={withReturnTo(`/test-cases/${issue.id}`, returnTo)} className="font-semibold underline underline-offset-2">
                      Go to the latest round
                    </Link>
                  </p>
                )}

                {/* Selected round */}
                <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">{round.label}</h2>
                      <p className="text-xs text-muted-foreground">
                        Committed by {round.committedByName ?? round.committedBy} · {round.tcCount} test cases
                        {round.sheetTabs.length > 0 ? ` · tab${round.sheetTabs.length === 1 ? "" : "s"}: ${round.sheetTabs.join(", ")}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {round.sheetUrl && (
                        <a
                          href={round.sheetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                        >
                          <RiGoogleLine className="size-3.5" />
                          Open Google Sheet
                          <RiExternalLinkLine className="size-3 opacity-60" />
                        </a>
                      )}
                      {round.snapshotFile && (
                        <a
                          href={`/api/test-cases/files/${round.snapshotFile.id}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                          title={round.snapshotFile.fileName}
                        >
                          <RiDownload2Line className="size-3.5" />
                          {round.source === "xlsx" && isLatest ? "Download current workbook" : "Download snapshot"}
                          <span className="text-muted-foreground">({fmtSize(round.snapshotFile.sizeBytes)})</span>
                        </a>
                      )}
                    </div>
                  </div>

                  {round.snapshotFile && (
                    <p className="flex items-center gap-1.5 break-all text-[11px] text-muted-foreground">
                      <RiFileExcel2Line className="size-3.5 shrink-0" />
                      {round.snapshotFile.fileName}
                    </p>
                  )}
                  {sameWorkbook.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      This exact workbook file was also used for{" "}
                      {sameWorkbook.map((w, i) => (
                        <span key={w.issueId}>
                          {i > 0 && ", "}
                          <Link href={withReturnTo(`/test-cases/${w.issueId}`, returnTo)} className="font-mono font-semibold text-primary hover:underline">
                            {w.issueKey}
                          </Link>{" "}
                          (Round {w.roundNo})
                        </span>
                      ))}
                      . Each item keeps its own copy of just its tabs.
                    </p>
                  )}
                  {round.source === "google_sheet" && (
                    <p className="text-[11px] text-muted-foreground">
                      The snapshot is exactly what was reviewed; the live sheet may have changed since this round.
                    </p>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    {[...polarityCounts].map(([t, n]) => (
                      <span key={t} className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] dark:border-sky-900 dark:bg-sky-950/30">
                        {TC_POLARITY_LABELS[t as TcPolarity] ?? t} <span className="font-semibold tabular-nums">{n}</span>
                      </span>
                    ))}
                    {[...categoryCounts].map(([t, n]) => (
                      <span key={t} className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] dark:border-zinc-700 dark:bg-zinc-900">
                        {TC_CATEGORY_LABELS[t as TcCategory] ?? t} <span className="font-semibold tabular-nums">{n}</span>
                      </span>
                    ))}
                  </div>

                  {round.notes && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Notes</p>
                      <p className="whitespace-pre-wrap text-xs text-foreground">{round.notes}</p>
                    </div>
                  )}
                </section>

                {isLatest && stored && (
                  <AnalyticsPanel issueId={issue.id} stats={stored.stats} trend={stored.stats.trend ?? []} computedAt={istDateTime(stored.computedAt)} />
                )}

                <ReviewPanel
                  roundId={round.id}
                  roundNo={round.roundNo}
                  isLatest={isLatest}
                  reviewers={round.reviewers}
                  comments={comments}
                  feedbackFiles={feedbackByRound.get(round.roundNo) ?? []}
                  viewer={viewer}
                  committerEmail={round.committedBy}
                />

                <SignoffPanel
                  issueId={issue.id}
                  returnTo={returnTo}
                  signoffs={signoffs}
                  actions={signoffActions}
                  isLatest={isLatest}
                  approved={roundApproved}
                  resubmit={needsResubmit}
                  openFeedback={openFeedback}
                />

                <HistoryPanel events={history.events} items={history.items} returnTo={returnTo} />

                <CasesTable
                  cases={detail.cases}
                  review={{
                    roundId: round.id,
                    isLatest,
                    comments,
                    viewer,
                    reviewers: round.reviewers,
                    committerEmail: round.committedBy,
                  }}
                />

                {viewer.isAdmin && (
                  <DeletePanel
                    issueId={issue.id}
                    issueKey={issue.jiraKey}
                    summary={{ rounds: detail.rounds.length, cases: detail.rounds.reduce((n, r) => n + r.tcCount, 0), signoffs: history.events.filter((e) => e.kind === "signoff" && e.own).length }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

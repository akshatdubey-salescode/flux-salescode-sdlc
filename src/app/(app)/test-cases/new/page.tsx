import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAuth } from "@/lib/auth/server";
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
import { SubmissionForm } from "@/components/test-cases/submission-form";
import { BackLink } from "@/components/test-cases/back-link";
import { returnLabel, safeReturnTo, withReturnTo } from "@/lib/test-cases/return-to";
import { getItemLock } from "@/lib/test-cases/lock";
import { fetchSetDetail, findIssue, previousReviewers } from "@/lib/test-cases/service";

type Props = { searchParams: Promise<{ issue?: string; key?: string; from?: string }> };

export default async function NewTestCaseSubmissionPage({ searchParams }: Props) {
  const user = await requireAuth();
  if (!(await isEnabled(FEATURE_FLAGS.TEST_CASES))) notFound();

  const sp = await searchParams;
  const issueId = sp.issue && isValidUuid(sp.issue) ? sp.issue : undefined;
  const key = sp.key?.trim() || undefined;
  const returnTo = safeReturnTo(sp.from);
  const lookup = issueId || key ? await findIssue({ issueId, key }) : null;

  const header = (
    <PageHeader>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild><Link href="/home">Home</Link></BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Submit test cases</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </PageHeader>
  );

  // No issue chosen yet (or it could not be resolved): ask for a Jira key.
  if (!lookup || lookup.kind === "none" || lookup.kind === "ambiguous") {
    return (
      <div className="flex min-h-svh flex-col">
        {header}
        <main className="flex-1 p-6">
          <div className="mx-auto max-w-xl space-y-4">
            <BackLink href={returnTo ?? "/home"} label={returnLabel(returnTo)} />
            <h1 className="text-lg font-semibold text-foreground">Submit test cases</h1>
            {lookup?.kind === "none" && <p className="text-sm text-destructive">No issue found for that reference.</p>}
            {lookup?.kind === "ambiguous" ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">That key exists in more than one project. Choose one:</p>
                <ul className="space-y-1">
                  {lookup.issues.map((i) => (
                    <li key={i.id}>
                      <Link href={withReturnTo(`/test-cases/new?issue=${i.id}`, returnTo)} className="text-sm text-primary hover:underline">
                        {i.jiraKey} — {i.summary} <span className="text-muted-foreground">({i.projectName})</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <form action="/test-cases/new" className="flex items-end gap-2">
                {returnTo && <input type="hidden" name="from" value={returnTo} />}
                <label className="flex-1 space-y-1 text-xs text-muted-foreground">
                  Jira key
                  <input
                    name="key"
                    placeholder="e.g. CT-614"
                    defaultValue={key}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                  />
                </label>
                <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
                  Continue
                </button>
              </form>
            )}
          </div>
        </main>
      </div>
    );
  }

  const issue = lookup.issue;
  const [existing, reviewers, itemLock] = await Promise.all([fetchSetDetail(issue.id), previousReviewers(issue.id), getItemLock(issue.id)]);
  const nextRound = (existing?.rounds[0]?.roundNo ?? 0) + 1;
  // Back goes to where the user came from; with no known origin, to the issue's TC page if it has one.
  const backHref = returnTo ?? (existing ? `/test-cases/${issue.id}` : "/home");

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild><Link href={withReturnTo(`/test-cases/${issue.id}`, returnTo)}>{issue.jiraKey}</Link></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Submit test cases</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <main className="flex-1 space-y-3 p-6">
        <div className="mx-auto max-w-4xl">
          <BackLink href={backHref} label={returnLabel(returnTo)} />
        </div>
        <SubmissionForm
          // A new instance for each round, so a committed form never comes back as a stale draft.
          key={`${issue.id}:${nextRound}`}
          issue={{
            id: issue.id,
            jiraKey: issue.jiraKey,
            summary: issue.summary,
            issueType: issue.issueType,
            status: issue.status,
            projectName: issue.projectName,
            jiraBaseUrl: issue.jiraBaseUrl,
          }}
          nextRound={nextRound}
          committerEmail={user.email}
          // You can't review your own submission, so an admin who approved the last round isn't pre-filled.
          initialReviewers={reviewers.filter((r) => r.email.toLowerCase() !== user.email.toLowerCase())}
          returnTo={returnTo}
          cancelHref={backHref}
          lock={
            itemLock
              ? {
                  source: itemLock.source,
                  sheetUrl: itemLock.sheetUrl,
                  currentFile: existing?.rounds[0]?.snapshotFile
                    ? { id: existing.rounds[0].snapshotFile.id, fileName: existing.rounds[0].snapshotFile.fileName }
                    : null,
                }
              : null
          }
        />
      </main>
    </div>
  );
}

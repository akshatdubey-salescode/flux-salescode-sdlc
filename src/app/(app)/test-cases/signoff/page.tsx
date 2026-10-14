import { notFound } from "next/navigation";
import Link from "next/link";
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
import { SignoffForm } from "@/components/test-cases/signoff-form";
import { BackLink } from "@/components/test-cases/back-link";
import { returnLabel, safeReturnTo, withReturnTo } from "@/lib/test-cases/return-to";
import { getRoundContext } from "@/lib/test-cases/review-service";
import { checkSignoffAllowed } from "@/lib/test-cases/signoff-service";
import { fetchSetDetail, findIssue } from "@/lib/test-cases/service";

type Props = { searchParams: Promise<{ issue?: string; role?: string; from?: string }> };

export default async function TestCaseSignoffPage({ searchParams }: Props) {
  const user = await requireAuth();
  if (!(await isEnabled(FEATURE_FLAGS.TEST_CASES))) notFound();

  const sp = await searchParams;
  if (!sp.issue || !isValidUuid(sp.issue) || (sp.role !== "dev" && sp.role !== "tester")) notFound();
  const role = sp.role;
  const returnTo = safeReturnTo(sp.from);
  // Back goes to where the user came from, else the issue's TC page (which always exists here).

  const lookup = await findIssue({ issueId: sp.issue });
  if (lookup.kind !== "found") notFound();
  const issue = lookup.issue;
  const backHref = returnTo ?? `/test-cases/${issue.id}`;

  const detail = await fetchSetDetail(issue.id);
  const latest = detail?.rounds[0];
  const round = latest ? await getRoundContext(latest.id) : null;

  const allowed = round
    ? await checkSignoffAllowed({
        ctx: round,
        actor: { email: user.email, isAdmin: hasMinRole(user.role, "ADMIN") },
        role,
      })
    : null;

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild><Link href={withReturnTo(`/test-cases/${issue.id}`, returnTo)}>{issue.jiraKey}</Link></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{role === "dev" ? "Developer" : "Tester"} sign-off</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <main className="flex-1 space-y-3 p-6">
        <div className="mx-auto max-w-3xl">
          <BackLink href={backHref} label={returnTo ? returnLabel(returnTo) : "Back to test cases"} />
        </div>
        {!round || !latest ? (
          <p className="mx-auto max-w-xl text-sm text-muted-foreground">No test cases have been submitted for this issue yet.</p>
        ) : !allowed?.ok ? (
          <div className="mx-auto max-w-xl space-y-2">
            <p className="text-sm text-destructive">{allowed?.ok === false ? allowed.error : "You cannot sign off."}</p>
            
          </div>
        ) : (
          <SignoffForm
            key={`${round.roundId}:${role}`}
            issue={{ id: issue.id, jiraKey: issue.jiraKey, summary: issue.summary }}
            roundId={round.roundId}
            roundNo={round.roundNo}
            role={role}
            returnTo={returnTo}
            cancelHref={backHref}
          />
        )}
      </main>
    </div>
  );
}

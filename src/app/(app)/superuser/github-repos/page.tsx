import { asc, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { githubRepos } from "@/lib/db/schema";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ReposManager, type RepoRow } from "./repos-manager";

export default async function GithubReposPage() {
  await requireRole("SUPERUSER");

  // Only tracked repos feed the dashboard, so they're the only ones worth
  // pointing at extra branches.
  const repos: RepoRow[] = await db
    .select({
      id: githubRepos.id,
      fullName: githubRepos.fullName,
      defaultBranch: githubRepos.defaultBranch,
      extraBranches: githubRepos.extraBranches,
      statsMode: githubRepos.statsMode,
    })
    .from(githubRepos)
    .where(eq(githubRepos.isTracked, true))
    .orderBy(asc(githubRepos.fullName));

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/superuser">Superuser</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Repo Branches</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Repo Branches</h1>
            <p className="text-sm text-zinc-500 mt-1">
              By default the Lines of Code view counts each repo&apos;s default branch only —
              that&apos;s all GitHub&apos;s stats API reports. Add extra branches to a repo here
              to also count work that lives only on those branches; shared commits are deduped,
              so nothing is double-counted.
            </p>
          </div>

          <ReposManager repos={repos} />
        </div>
      </main>
    </div>
  );
}

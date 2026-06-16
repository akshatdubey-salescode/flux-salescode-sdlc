import { desc, eq, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { githubOrgs, githubRepos } from "@/lib/db/schema";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { OrgManager, type OrgRow } from "./org-manager";

export default async function GithubOrgsPage() {
  await requireRole("SUPERUSER");

  const orgs: OrgRow[] = await db
    .select({
      id: githubOrgs.id,
      login: githubOrgs.login,
      isActive: githubOrgs.isActive,
      lastSyncedAt: githubOrgs.lastSyncedAt,
      repoCount: sql<number>`count(${githubRepos.id})::int`,
    })
    .from(githubOrgs)
    .leftJoin(githubRepos, eq(githubRepos.orgId, githubOrgs.id))
    .groupBy(githubOrgs.id)
    .orderBy(desc(githubOrgs.isActive), githubOrgs.login);

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
              <BreadcrumbPage>GitHub Orgs</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">GitHub Orgs</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Organisations whose repos feed the Lines of Code view. Each needs its own
              fine-grained PAT (they&apos;re single-org). The sync covers every active org;
              pause one to exclude it without losing its data, or delete to remove it entirely.
            </p>
          </div>

          <OrgManager orgs={orgs} />
        </div>
      </main>
    </div>
  );
}

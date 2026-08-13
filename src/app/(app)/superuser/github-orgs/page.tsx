import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { githubOrgs, githubRepos, githubAppCredentials } from "@/lib/db/schema";
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

  const orgRows = await db
    .select({
      id: githubOrgs.id,
      login: githubOrgs.login,
      isActive: githubOrgs.isActive,
      authMode: githubOrgs.authMode,
      appInstallationId: githubOrgs.appInstallationId,
      discoveryMode: githubOrgs.discoveryMode,
      lastSyncedAt: githubOrgs.lastSyncedAt,
      repoCount: sql<number>`count(${githubRepos.id})::int`,
    })
    .from(githubOrgs)
    .leftJoin(githubRepos, eq(githubRepos.orgId, githubOrgs.id))
    .groupBy(githubOrgs.id)
    .orderBy(desc(githubOrgs.isActive), githubOrgs.login);

  const [appCreds] = await db
    .select({ appId: githubAppCredentials.appId })
    .from(githubAppCredentials)
    .limit(1);

  // Manual orgs carry a small, explicit repo list the superuser manages inline;
  // auto orgs have hundreds, so we never list those here (just the count above).
  const manualOrgIds = orgRows.filter((o) => o.discoveryMode === "manual").map((o) => o.id);
  const manualRepos = manualOrgIds.length
    ? await db
        .select({
          id: githubRepos.id,
          orgId: githubRepos.orgId,
          fullName: githubRepos.fullName,
        })
        .from(githubRepos)
        .where(inArray(githubRepos.orgId, manualOrgIds))
        .orderBy(asc(githubRepos.fullName))
    : [];
  const reposByOrg = new Map<string, { id: string; fullName: string }[]>();
  for (const r of manualRepos) {
    if (!r.orgId) continue;
    const list = reposByOrg.get(r.orgId) ?? [];
    list.push({ id: r.id, fullName: r.fullName });
    reposByOrg.set(r.orgId, list);
  }

  const orgs: OrgRow[] = orgRows.map((o) => ({ ...o, repos: reposByOrg.get(o.id) ?? [] }));

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
              Organisations whose repos feed the Lines of Code view. Each org authenticates
              either with its own fine-grained PAT, or with the shared GitHub App below (an
              org-level installation, not tied to anyone&apos;s personal account). Use{" "}
              <span className="font-medium">whole org</span> when the token can list the org
              (any App installed with &quot;All repositories&quot; qualifies), or{" "}
              <span className="font-medium">specific repos</span> when you only have a
              partial-access PAT and register repos by name. Pause an org to exclude it without
              losing data, or delete to remove it.
            </p>
          </div>

          <OrgManager orgs={orgs} hasAppCredentials={Boolean(appCreds)} />
        </div>
      </main>
    </div>
  );
}

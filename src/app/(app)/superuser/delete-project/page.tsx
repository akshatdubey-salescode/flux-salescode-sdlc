import { asc, eq, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { jiraProjects, jiraIssues } from "@/lib/db/schema";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbLink,
} from "@/components/ui/breadcrumb";
import { DeleteProjectPanel } from "@/components/superuser/delete-project-panel";

export default async function DeleteProjectPage() {
  await requireRole("SUPERUSER");

  const projects = await db
    .select({
      id: jiraProjects.id,
      name: jiraProjects.name,
      jiraProjectKey: jiraProjects.jiraProjectKey,
      issueCount: sql<number>`count(${jiraIssues.id})::int`,
    })
    .from(jiraProjects)
    .leftJoin(jiraIssues, eq(jiraIssues.projectId, jiraProjects.id))
    .groupBy(jiraProjects.id)
    .orderBy(asc(jiraProjects.name));

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
              <BreadcrumbPage>Delete Project</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Delete Project</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Permanently remove a project and all of its data from the platform.
              This includes all issues, SLA rules, violations, sync history,
              stakeholders, and Freshdesk tickets.
            </p>
          </div>

          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400">
            Deletions are irreversible. There is no soft-delete or recovery path.
          </div>

          <DeleteProjectPanel projects={projects} />
        </div>
      </main>
    </div>
  );
}

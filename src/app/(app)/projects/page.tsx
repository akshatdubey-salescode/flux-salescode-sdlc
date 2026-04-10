import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects, jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";

export default async function ProjectsPage() {
  const user = await requireAuth();

  const projects = await db
    .select({
      id: jiraProjects.id,
      name: jiraProjects.name,
      jiraProjectKey: jiraProjects.jiraProjectKey,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
      lastSyncedAt: jiraProjects.lastSyncedAt,
      issueCount: sql<number>`count(${jiraIssues.id})::int`,
    })
    .from(jiraProjects)
    .leftJoin(jiraIssues, eq(jiraIssues.projectId, jiraProjects.id))
    .where(eq(jiraProjects.isActive, true))
    .groupBy(jiraProjects.id)
    .orderBy(jiraProjects.createdAt);

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Projects</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {user.role === "SUPERUSER" && (
          <Link
            href="/projects/new"
            className="ml-auto inline-flex items-center rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Add project
          </Link>
        )}
      </header>

      <main className="flex-1 p-6">
        {projects.length === 0 ? (
          <EmptyState isSuperuser={user.role === "SUPERUSER"} />
        ) : (
          <div className="space-y-2">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="flex items-center gap-4 rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              >
                <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded bg-zinc-100 text-xs font-mono font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {p.jiraProjectKey}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {p.name}
                  </p>
                  <p className="truncate text-xs text-zinc-500">{p.jiraBaseUrl}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {p.issueCount}
                  </p>
                  <p className="text-xs text-zinc-500">issues</p>
                </div>
                {p.lastSyncedAt && (
                  <div className="hidden text-right shrink-0 sm:block">
                    <p className="text-xs text-zinc-500">
                      Synced {formatRelative(p.lastSyncedAt)}
                    </p>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function EmptyState({ isSuperuser }: { isSuperuser: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        No projects yet
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        {isSuperuser
          ? "Add your first Jira project to get started."
          : "A superuser needs to onboard a Jira project first."}
      </p>
      {isSuperuser && (
        <Link
          href="/projects/new"
          className="mt-4 inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700"
        >
          Add project
        </Link>
      )}
    </div>
  );
}

function formatRelative(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

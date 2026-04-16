import Link from "next/link";
import Image from "next/image";
import { eq, sql, or, ilike, and, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects, jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { SearchInput } from "./search-input";

export default async function ProjectsPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireAuth();
  const searchParams = await props.searchParams;
  const q = searchParams.q as string | undefined;

  const baseWhere = eq(jiraProjects.isActive, true);
  const searchWhere = q
    ? or(
        ilike(jiraProjects.name, `%${q}%`),
        ilike(jiraProjects.jiraProjectKey, `%${q}%`)
      )
    : undefined;

  const projects = await db
    .select({
      id: jiraProjects.id,
      name: jiraProjects.name,
      jiraProjectKey: jiraProjects.jiraProjectKey,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
      lastSyncedAt: jiraProjects.lastSyncedAt,
      headerImageUrl: jiraProjects.headerImageUrl,
      headerColor: jiraProjects.headerColor,
      issueCount: sql<number>`count(${jiraIssues.id})::int`,
    })
    .from(jiraProjects)
    .leftJoin(jiraIssues, eq(jiraIssues.projectId, jiraProjects.id))
    .where(and(baseWhere, searchWhere))
    .groupBy(jiraProjects.id)
    .orderBy(asc(jiraProjects.name));

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
            className="ml-auto inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add project
          </Link>
        )}
      </header>

      <main className="flex-1 p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">All Projects</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Manage your synced Jira projects and workspaces.</p>
          </div>
          <div className="flex items-center gap-4 flex-1 justify-end">
            <SearchInput />
          </div>
        </div>

        {projects.length === 0 ? (
          <EmptyState isSuperuser={user.role === "SUPERUSER"} hasSearch={!!q} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-200/60 bg-white transition-all hover:shadow-lg hover:-translate-y-1 dark:border-zinc-800/60 dark:bg-zinc-950 dark:hover:border-zinc-700/80 hover:shadow-zinc-200/50 dark:hover:shadow-black/50"
              >
                {/* Banner Section */}
                <div 
                  className="relative h-32 w-full overflow-hidden transition-transform duration-500 group-hover:scale-[1.02]"
                  style={{ backgroundColor: p.headerColor || "#E4E4E7" }}
                >
                  {p.headerImageUrl ? (
                    <Image
                      src={p.headerImageUrl}
                      alt={p.name}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-black/0 to-black/20" />
                  )}
                  {/* Subtle overlay gradient to ensure text readability if we decide to add text over banner */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-80" />
                  
                  {/* Project Key Badge floating on banner */}
                  <div className="absolute bottom-3 left-4 z-10">
                    <span className="flex h-7 items-center justify-center rounded-md bg-white/20 backdrop-blur-md px-2.5 text-xs font-mono font-bold tracking-wider text-white shadow-sm ring-1 ring-white/30">
                      {p.jiraProjectKey}
                    </span>
                  </div>
                </div>

                {/* Content Section */}
                <div className="flex flex-1 flex-col p-4 bg-gradient-to-b from-white to-zinc-50/50 dark:from-zinc-950 dark:to-zinc-950/80">
                  <div className="flex items-start justify-between min-w-0 mb-3">
                    <div className="min-w-0 pr-4">
                      <h3 className="truncate text-base font-semibold text-zinc-900 group-hover:text-blue-600 dark:text-zinc-50 dark:group-hover:text-blue-400 transition-colors">
                        {p.name}
                      </h3>
                      <p className="truncate text-xs font-medium text-zinc-500 max-w-[200px] mt-0.5" title={p.jiraBaseUrl}>
                        {new URL(p.jiraBaseUrl).hostname.replace('www.', '')}
                      </p>
                    </div>
                  </div>
                  
                  <div className="mt-auto pt-4 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800/60">
                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 leading-none mb-0.5">Issues</span>
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-none">{p.issueCount}</span>
                      </div>
                    </div>
                    {p.lastSyncedAt && (
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 leading-none mb-0.5">Synced</span>
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 leading-none">
                          {formatRelativeShort(p.lastSyncedAt)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function EmptyState({ isSuperuser, hasSearch }: { isSuperuser: boolean; hasSearch?: boolean }) {
  if (hasSearch) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          No projects found
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          We couldn't find any projects matching your search.
        </p>
        <Link
          href="/projects"
          className="mt-6 inline-flex items-center rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-700"
        >
          Clear search
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        No projects yet
      </p>
      <p className="mt-2 text-sm text-zinc-500">
        {isSuperuser
          ? "Add your first Jira project to get started."
          : "A superuser needs to onboard a Jira project first."}
      </p>
      {isSuperuser && (
        <Link
          href="/projects/new"
          className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
        >
          Add your first project
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

function formatRelativeShort(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

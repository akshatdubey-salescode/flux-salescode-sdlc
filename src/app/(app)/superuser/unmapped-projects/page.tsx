import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { jiraProjects, projectStatusMappings } from "@/lib/db/schema";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbLink,
} from "@/components/ui/breadcrumb";
import { RiArrowRightSLine, RiCheckboxCircleLine } from "@remixicon/react";

export default async function UnmappedProjectsPage() {
  await requireRole("SUPERUSER");

  // Active projects with no canonical status mapping configured at all.
  // A project is "unmapped" when it has zero rows in projectStatusMappings.
  const unmappedProjects = await db
    .select({
      id: jiraProjects.id,
      name: jiraProjects.name,
      jiraProjectKey: jiraProjects.jiraProjectKey,
    })
    .from(jiraProjects)
    .leftJoin(
      projectStatusMappings,
      eq(projectStatusMappings.projectId, jiraProjects.id)
    )
    .where(eq(jiraProjects.isActive, true))
    .groupBy(jiraProjects.id)
    .having(sql`count(${projectStatusMappings.id}) = 0`)
    .orderBy(asc(jiraProjects.name));

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/superuser">Superuser</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Unmapped Projects</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Unmapped Projects
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              Active projects that have no canonical status mapping configured
              yet. Select a project to configure its status mapping.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Projects without a mapping
              </span>
              {unmappedProjects.length > 0 && (
                <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                  {unmappedProjects.length}
                </span>
              )}
            </div>

            {unmappedProjects.length === 0 ? (
              <div className="flex items-center gap-2 p-5 text-sm text-zinc-500 dark:text-zinc-400">
                <RiCheckboxCircleLine className="size-4 text-emerald-500" />
                Every active project has a canonical status mapping configured.
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {unmappedProjects.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/projects/${project.id}/status-mapping`}
                      className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {project.name}
                      </span>
                      <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        {project.jiraProjectKey}
                      </span>
                      <RiArrowRightSLine className="size-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

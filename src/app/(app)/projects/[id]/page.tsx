import { Suspense } from "react";
import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { hasMinRole } from "@/lib/auth/types";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ProjectHeaderImage } from "@/components/project-header-image";
import { ProjectTabs } from "@/components/project-tabs";

export default async function ProjectPage(props: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const { id } = await props.params;

  const [project] = await db
    .select()
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, id), eq(jiraProjects.isActive, true)))
    .limit(1);

  if (!project) notFound();

  const isAdmin = hasMinRole(user.role, "ADMIN");
  const isSuperuser = hasMinRole(user.role, "SUPERUSER");

  return (
    <div className="flex flex-col min-h-svh min-w-0 w-full">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{project.name}</BreadcrumbPage>
            </BreadcrumbItem>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {project.jiraProjectKey}
            </span>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <ProjectHeaderImage
        projectId={project.id}
        projectName={project.name}
        initialImageUrl={project.headerImageUrl ?? null}
        initialColor={project.headerColor ?? null}
        isAdmin={isAdmin}
        isSuperuser={isSuperuser}
      />

      <main className="flex-1 min-w-0 w-full">
        <Suspense fallback={<TabsSkeleton />}>
          <ProjectTabs projectId={project.id} projectName={project.name} hasFreshdesk={project.freshdeskCompanyId != null} isAdmin={isAdmin} isSuperuser={isSuperuser} />
        </Suspense>
      </main>
    </div>
  );
}

function TabsSkeleton() {
  return (
    <div className="flex items-center gap-2 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
    </div>
  );
}

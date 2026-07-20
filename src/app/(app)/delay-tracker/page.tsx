import { Suspense } from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { isValidUuid } from "@/lib/delay-tracker/entries";
import { DelayIssuesTable } from "@/components/delay-tracker/delay-issues-table";

type SearchParams = Promise<{ projectIds?: string }>;

export default async function DelayTrackerPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAuth();
  const { projectIds } = await searchParams;
  const singleProjectId = projectIds?.split(",").filter(Boolean).length === 1 ? projectIds : undefined;

  // Breadcrumb reflects context, not a fragile "where did you come from" param:
  // when the filter names exactly one project, this is a project-scoped
  // view (a byProject leaderboard row, or anything reached from that
  // project's own Delay Reasons panel) — resolve its name and nest under
  // Projects, matching projects/[id]/page.tsx's own breadcrumb shape
  // exactly. Anything else (no project, or several) is org-wide, under
  // Dashboard.
  const project =
    singleProjectId && isValidUuid(singleProjectId)
      ? (
          await db
            .select({ name: jiraProjects.name })
            .from(jiraProjects)
            .where(eq(jiraProjects.id, singleProjectId))
            .limit(1)
        )[0]
      : null;

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <PageHeader className="bg-white dark:bg-zinc-900">
        <Breadcrumb>
          <BreadcrumbList>
            {project ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href={`/projects/${singleProjectId}`}>{project.name}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            ) : (
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/home">Dashboard</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            )}
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Delay Tracker</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-5xl mx-auto space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Delay Tracker</h1>
          {/* DelayIssuesTable reads filter state via useSearchParams, which
              must sit under a Suspense boundary — same page-level wrapping every
              other useSearchParams surface here uses (search, my-tasks, …). */}
          <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />}>
            <DelayIssuesTable />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

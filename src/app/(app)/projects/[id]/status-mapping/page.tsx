import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects, projectStatusMappings } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";
import { JiraClient } from "@/lib/jira/client";
import { decrypt } from "@/lib/crypto";
import { StatusMappingEditor } from "@/components/status-mapping-editor";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default async function StatusMappingPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onboarding?: string }>;
}) {
  await requireRole("ADMIN");
  const { id } = await props.params;
  const { onboarding } = await props.searchParams;
  const isOnboarding = onboarding === "1";

  const [project] = await db
    .select()
    .from(jiraProjects)
    .where(eq(jiraProjects.id, id))
    .limit(1);

  if (!project) notFound();

  let discoveredStatuses: { name: string; statusCategory: string }[] = [];
  try {
    const client = new JiraClient({
      baseUrl: project.jiraBaseUrl,
      email: project.jiraEmail,
      apiToken: decrypt(project.jiraApiToken),
    });
    discoveredStatuses = await client.fetchProjectStatuses(
      project.jiraProjectKey
    );
  } catch {
    // Non-fatal — editor renders with saved mappings and empty discovered list
  }

  const initialMappings = await db
    .select()
    .from(projectStatusMappings)
    .where(eq(projectStatusMappings.projectId, id));

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href={`/projects/${id}`}>
                {project.name}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Status Mapping</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6 max-w-2xl">
        {isOnboarding && (
          <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
            <strong>One last step:</strong> Map this project&apos;s Jira
            statuses to canonical statuses so they appear correctly in
            cross-project dashboards.{" "}
            <a
              href={`/projects/${id}`}
              className="underline underline-offset-2"
            >
              Skip for now
            </a>
          </div>
        )}

        <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Status Mapping
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Map each Jira workflow status to a canonical status for
          cross-project reporting. Unmapped statuses are excluded from
          aggregated views.
        </p>

        <StatusMappingEditor
          projectId={id}
          initialMappings={initialMappings}
          discoveredStatuses={discoveredStatuses}
          isOnboarding={isOnboarding}
        />
      </main>
    </div>
  );
}

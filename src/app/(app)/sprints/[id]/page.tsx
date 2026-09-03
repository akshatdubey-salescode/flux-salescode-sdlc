import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { isValidUuid } from "@/lib/validation";
import { fetchSprintById } from "@/lib/sprints/entries";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SprintFocus } from "@/components/sprint-tracker/sprint-focus";

/**
 * Full-screen view of one sprint — the target of the sprint share link and
 * the card's zoom button. The server resolves auth/breadcrumb; the client
 * component owns the data and every action the in-tab card has.
 */
export default async function SprintPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const { id } = await props.params;
  if (!isValidUuid(id)) notFound();

  const sprint = await fetchSprintById(id);
  if (!sprint) notFound();

  const [project] = await db
    .select({ id: jiraProjects.id, name: jiraProjects.name })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, sprint.projectId))
    .limit(1);
  if (!project) notFound();

  return (
    <div className="flex min-h-svh w-full min-w-0 flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href={`/projects/${project.id}?tab=sprint-tracker`}>{project.name}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{sprint.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <div className="p-6">
        <SprintFocus sprintId={sprint.id} canManage={canManageDeliveries(user)} />
      </div>
    </div>
  );
}

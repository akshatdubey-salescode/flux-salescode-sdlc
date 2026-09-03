import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { isValidUuid } from "@/lib/validation";
import { fetchSprintById } from "@/lib/sprints/entries";
import { db } from "@/lib/db";
import { jiraProjects, observerBoards } from "@/lib/db/schema";
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

  // Breadcrumb parent: the owning project, or the owning Team Pulse board.
  let parent: { href: string; label: string; rootHref: string; rootLabel: string } | null = null;
  if (sprint.projectId) {
    const [project] = await db
      .select({ id: jiraProjects.id, name: jiraProjects.name })
      .from(jiraProjects)
      .where(eq(jiraProjects.id, sprint.projectId))
      .limit(1);
    if (!project) notFound();
    parent = {
      href: `/projects/${project.id}?tab=sprint-tracker`,
      label: project.name,
      rootHref: "/projects",
      rootLabel: "Projects",
    };
  } else if (sprint.boardId) {
    const [board] = await db
      .select({ id: observerBoards.id, name: observerBoards.name })
      .from(observerBoards)
      .where(eq(observerBoards.id, sprint.boardId))
      .limit(1);
    if (!board) notFound();
    parent = {
      href: `/observer/${board.id}?tab=sprints`,
      label: board.name,
      rootHref: "/observer",
      rootLabel: "Team Pulse",
    };
  }
  if (!parent) notFound();

  return (
    <div className="flex min-h-svh w-full min-w-0 flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href={parent.rootHref}>{parent.rootLabel}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href={parent.href}>{parent.label}</BreadcrumbLink>
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

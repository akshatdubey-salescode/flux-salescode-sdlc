import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { isValidUuid } from "@/lib/validation";
import { fetchWorkstreamById } from "@/lib/sprints/entries";
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
import { WorkstreamFocus } from "@/components/sprint-tracker/workstream-focus";

/**
 * Full-screen view of one workstream — the target of the workstream share
 * link. The server resolves auth/breadcrumb; the client component owns the
 * data and every sprint action the in-tab cards have.
 */
export default async function WorkstreamPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const { id } = await props.params;
  if (!isValidUuid(id)) notFound();

  const result = await fetchWorkstreamById(id);
  if (!result) notFound();

  const [project] = await db
    .select({ id: jiraProjects.id, name: jiraProjects.name })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, result.workstream.projectId))
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
              <BreadcrumbPage>{result.workstream.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <div className="p-6">
        <WorkstreamFocus workstreamId={result.workstream.id} canManage={canManageDeliveries(user)} />
      </div>
    </div>
  );
}

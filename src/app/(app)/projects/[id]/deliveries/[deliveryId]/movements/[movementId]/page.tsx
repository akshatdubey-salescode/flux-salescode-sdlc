import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { deliveries, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { isValidUuid } from "@/lib/validation";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { MovementPage } from "@/components/delivery-tracker/movement/movement-page";
import { deliveryBackPath } from "@/components/delivery-tracker/movement/view-model";

/**
 * One environment movement as a page of its own. The ids are validated and the chain checked (an active project, a delivery of THAT project
 * that is not deleted) so a mistyped or foreign id is a 404; the movement itself is loaded by the client from the movement API, which
 * answers 404 for a movement that is not the delivery's (the page then offers the way back). Reading is open to any signed-in user, like the
 * API; every change is guarded by the API per action.
 */
export default async function MovementRoute(props: { params: Promise<{ id: string; deliveryId: string; movementId: string }> }) {
  await requireAuth();
  const { id, deliveryId, movementId } = await props.params;
  if (!isValidUuid(id) || !isValidUuid(deliveryId) || !isValidUuid(movementId)) notFound();

  const [project] = await db
    .select({ id: jiraProjects.id, name: jiraProjects.name, jiraBaseUrl: jiraProjects.jiraBaseUrl })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, id), eq(jiraProjects.isActive, true)))
    .limit(1);
  if (!project) notFound();

  const [delivery] = await db
    .select({ id: deliveries.id, name: deliveries.name })
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.projectId, id), isNull(deliveries.deletedAt)))
    .limit(1);
  if (!delivery) notFound();

  return (
    <div className="flex flex-col min-h-svh min-w-0 w-full">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href={`/projects/${project.id}`}>{project.name}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href={`/projects/${project.id}?tab=delivery-tracker`}>Deliveries</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href={deliveryBackPath(project.id, delivery.id)}>{delivery.name}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Movement</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <div className="flex min-w-0 w-full flex-1 flex-col">
        <MovementPage projectId={project.id} deliveryId={delivery.id} movementId={movementId} jiraBaseUrl={project.jiraBaseUrl ?? null} />
      </div>
    </div>
  );
}

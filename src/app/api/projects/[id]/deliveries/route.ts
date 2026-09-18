import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq, and, isNull } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { deliveries, deliveryItems, jiraProjects, sprints, sprintItems } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid, isValidDateString, parseOptionalText } from "@/lib/validation";
import {
  fetchProjectDeliveries,
  fetchProjectDeliveryOptions,
  fetchDeliveryById,
  type DeliveryWithItems,
  type DeliveryOption,
} from "@/lib/deliveries/entries";

type Params = { params: Promise<{ id: string }> };

export type ProjectDeliveriesResponse = { deliveries: DeliveryWithItems[] };
export type ProjectDeliveryOptionsResponse = { deliveries: DeliveryOption[] };

/** List active deliveries for a project. `?summary=1` returns a light {id,name,deliveryDate}[] shape for pickers. */
export async function GET(req: NextRequest, { params }: Params) {
  await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  if (req.nextUrl.searchParams.get("summary") === "1") {
    const options = await fetchProjectDeliveryOptions(id);
    return NextResponse.json({ deliveries: options } satisfies ProjectDeliveryOptionsResponse);
  }

  const list = await fetchProjectDeliveries(id);
  return NextResponse.json({ deliveries: list } satisfies ProjectDeliveriesResponse);
}

/**
 * Create a delivery. Two ways to seed its items in the same request instead
 * of a second round trip:
 *   - `initialIssueId`: the Project Tracking "create new delivery" action
 *     attaches the one issue it was opened from.
 *   - `fromSprintId`: "create a delivery from this sprint" — every ACTIVE
 *     (non-removed) item of that sprint becomes a delivery item. The sprint
 *     must belong to this project. Sprint membership is left untouched; the
 *     delivery is the client-facing commitment cut from the sprint's scope.
 * Both may be given; duplicates collapse to one item.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id: projectId } = await params;
  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = parseOptionalText(body.name);
  const deliveryDate = body.deliveryDate;
  const notifyDaysBefore = body.notifyDaysBefore ?? 5;
  const responsibleEmails = Array.isArray(body.responsibleEmails) ? body.responsibleEmails : [];
  const responsibleNames = Array.isArray(body.responsibleNames) ? body.responsibleNames : [];
  const initialIssueId = parseOptionalText(body.initialIssueId) ?? null;
  const fromSprintId = parseOptionalText(body.fromSprintId) ?? null;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!isValidDateString(deliveryDate)) {
    return NextResponse.json({ error: "deliveryDate must be a valid YYYY-MM-DD date" }, { status: 400 });
  }
  if (typeof notifyDaysBefore !== "number" || !Number.isInteger(notifyDaysBefore) || notifyDaysBefore < 0) {
    return NextResponse.json({ error: "notifyDaysBefore must be a non-negative integer" }, { status: 400 });
  }
  if (!responsibleEmails.every((v: unknown) => typeof v === "string") || !responsibleNames.every((v: unknown) => typeof v === "string")) {
    return NextResponse.json({ error: "responsibleEmails/responsibleNames must be string arrays" }, { status: 400 });
  }
  if (initialIssueId && !isValidUuid(initialIssueId)) {
    return NextResponse.json({ error: "initialIssueId must be a valid UUID" }, { status: 400 });
  }
  if (fromSprintId && !isValidUuid(fromSprintId)) {
    return NextResponse.json({ error: "fromSprintId must be a valid UUID" }, { status: 400 });
  }

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, projectId), eq(jiraProjects.isActive, true)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const sprintIssueIds: string[] = [];
  if (fromSprintId) {
    const [sprint] = await db
      .select({ id: sprints.id, projectId: sprints.projectId, deletedAt: sprints.deletedAt })
      .from(sprints)
      .where(eq(sprints.id, fromSprintId))
      .limit(1);
    if (!sprint || sprint.deletedAt || sprint.projectId !== projectId) {
      return NextResponse.json({ error: "fromSprintId must reference a sprint of this project" }, { status: 400 });
    }
    // Active scope only — items soft-removed from the sprint were taken OUT
    // of its commitment, so they have no business in a delivery cut from it.
    const rows = await db
      .select({ issueId: sprintItems.issueId })
      .from(sprintItems)
      .where(and(eq(sprintItems.sprintId, fromSprintId), isNull(sprintItems.removedAt)));
    for (const r of rows) sprintIssueIds.push(r.issueId);
  }
  const initialIssueIds = Array.from(new Set([...(initialIssueId ? [initialIssueId] : []), ...sprintIssueIds]));

  const session = await getServerSession(authOptions);
  const createdByName = session?.user?.name?.trim() || null;

  // One transaction: a sprint-seeded delivery that lost its items half-way
  // would look like an empty delivery nobody asked for.
  const createdId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(deliveries)
      .values({
        projectId,
        name,
        deliveryDate,
        notifyDaysBefore,
        responsibleEmails,
        responsibleNames,
        createdBy: user.id,
        createdByName,
      })
      .returning({ id: deliveries.id });

    if (initialIssueIds.length > 0) {
      await tx
        .insert(deliveryItems)
        .values(
          initialIssueIds.map((issueId) => ({
            deliveryId: created.id,
            issueId,
            addedBy: user.id,
            addedByName: createdByName,
          }))
        )
        .onConflictDoNothing();
    }
    return created.id;
  });

  revalidateTag("deliveries", "max");
  revalidateTag(`project:${projectId}`, "max");
  revalidateTag("my-tasks", "max");

  const delivery = await fetchDeliveryById(createdId);
  if (!delivery) {
    return NextResponse.json({ error: "Created delivery could not be loaded" }, { status: 500 });
  }
  return NextResponse.json({ delivery }, { status: 201 });
}

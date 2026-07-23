import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq, and } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { deliveries, deliveryItems, jiraProjects } from "@/lib/db/schema";
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
 * Create a delivery. `initialIssueId` lets the Project Tracking "create new
 * delivery" action attach the first item in the same request instead of a
 * second round trip.
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

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, projectId), eq(jiraProjects.isActive, true)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const session = await getServerSession(authOptions);
  const createdByName = session?.user?.name?.trim() || null;

  const [created] = await db
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

  if (initialIssueId) {
    await db
      .insert(deliveryItems)
      .values({ deliveryId: created.id, issueId: initialIssueId, addedBy: user.id, addedByName: createdByName })
      .onConflictDoNothing();
  }

  revalidateTag("deliveries", "max");
  revalidateTag(`project:${projectId}`, "max");
  revalidateTag("my-tasks", "max");

  const delivery = await fetchDeliveryById(created.id);
  if (!delivery) {
    return NextResponse.json({ error: "Created delivery could not be loaded" }, { status: 500 });
  }
  return NextResponse.json({ delivery }, { status: 201 });
}

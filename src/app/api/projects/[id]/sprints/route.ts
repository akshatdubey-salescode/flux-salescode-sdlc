import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq, and } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { sprints, sprintItems, jiraProjects, sprintWorkstreams } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid, isValidDateString, parseOptionalText } from "@/lib/validation";
import {
  fetchProjectSprints,
  fetchProjectSprintOptions,
  fetchSprintById,
  type SprintWithItems,
  type SprintOption,
} from "@/lib/sprints/entries";

type Params = { params: Promise<{ id: string }> };

export type ProjectSprintsResponse = { sprints: SprintWithItems[] };
export type ProjectSprintOptionsResponse = { sprints: SprintOption[] };

/** List active sprints for a project. `?summary=1` returns the light {id,name,dates,itemCount}[] shape for the carryover picker (open sprints only); add `&includeCompleted=1` to get closed sprints too (the create-delivery form's sprint source picker). */
export async function GET(req: NextRequest, { params }: Params) {
  await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  if (req.nextUrl.searchParams.get("summary") === "1") {
    const includeCompleted = req.nextUrl.searchParams.get("includeCompleted") === "1";
    const options = await fetchProjectSprintOptions(id, { includeCompleted });
    return NextResponse.json({ sprints: options } satisfies ProjectSprintOptionsResponse);
  }

  const list = await fetchProjectSprints(id);
  return NextResponse.json({ sprints: list } satisfies ProjectSprintsResponse);
}

/** Create a sprint. Sprint management shares the delivery-manager gate — same people plan both trackers. */
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
  const goal = parseOptionalText(body.goal) ?? null;
  const startDate = body.startDate;
  const endDate = body.endDate;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return NextResponse.json({ error: "startDate and endDate must be valid YYYY-MM-DD dates" }, { status: 400 });
  }
  if (endDate < startDate) {
    return NextResponse.json({ error: "endDate must not be before startDate" }, { status: 400 });
  }

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, projectId), eq(jiraProjects.isActive, true)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Optional: create the sprint directly inside a workstream of this project.
  let workstreamId: string | null = null;
  if (body.workstreamId !== undefined && body.workstreamId !== null) {
    if (typeof body.workstreamId !== "string" || !isValidUuid(body.workstreamId)) {
      return NextResponse.json({ error: "workstreamId must be a valid UUID or null" }, { status: 400 });
    }
    const [ws] = await db
      .select({ id: sprintWorkstreams.id, projectId: sprintWorkstreams.projectId })
      .from(sprintWorkstreams)
      .where(eq(sprintWorkstreams.id, body.workstreamId))
      .limit(1);
    if (!ws || ws.projectId !== projectId) {
      return NextResponse.json(
        { error: "workstreamId must reference a workstream of this project" },
        { status: 400 }
      );
    }
    workstreamId = ws.id;
  }

  const session = await getServerSession(authOptions);
  const createdByName = session?.user?.name?.trim() || null;

  const [created] = await db
    .insert(sprints)
    .values({ projectId, workstreamId, name, goal, startDate, endDate, createdBy: user.id, createdByName })
    .returning({ id: sprints.id });

  const initialIssueIds = Array.isArray(body.initialIssueIds) ? body.initialIssueIds : [];
  if (initialIssueIds.length > 0 && initialIssueIds.every((v): v is string => typeof v === "string" && isValidUuid(v))) {
    await db
      .insert(sprintItems)
      .values(initialIssueIds.map((issueId) => ({ sprintId: created.id, issueId, addedBy: user.id, addedByName: createdByName })))
      .onConflictDoNothing();
  }

  revalidateTag("sprints", "max");
  revalidateTag(`project:${projectId}`, "max");

  const sprint = await fetchSprintById(created.id);
  if (!sprint) {
    return NextResponse.json({ error: "Created sprint could not be loaded" }, { status: 500 });
  }
  return NextResponse.json({ sprint }, { status: 201 });
}

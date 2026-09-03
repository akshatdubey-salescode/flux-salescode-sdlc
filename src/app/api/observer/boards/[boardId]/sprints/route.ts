import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { sprints, sprintItems, observerBoards } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid, isValidDateString, parseOptionalText } from "@/lib/validation";
import {
  fetchBoardSprints,
  fetchBoardSprintOptions,
  fetchSprintById,
  type SprintWithItems,
  type SprintOption,
} from "@/lib/sprints/entries";

type Params = { params: Promise<{ boardId: string }> };

export type BoardSprintsResponse = { sprints: SprintWithItems[] };
export type BoardSprintOptionsResponse = { sprints: SprintOption[] };

/**
 * Team Pulse board sprints — same engine as project sprints, but owned by a
 * board, and free to pull issues from ANY project. `?summary=1` returns the
 * light {id,name,dates}[] shape for the carryover picker.
 */
export async function GET(req: NextRequest, { params }: Params) {
  await requireAuth();
  const { boardId } = await params;
  if (!isValidUuid(boardId)) {
    return NextResponse.json({ error: "boardId must be a valid UUID" }, { status: 400 });
  }

  if (req.nextUrl.searchParams.get("summary") === "1") {
    const options = await fetchBoardSprintOptions(boardId);
    return NextResponse.json({ sprints: options } satisfies BoardSprintOptionsResponse);
  }

  const list = await fetchBoardSprints(boardId);
  return NextResponse.json({ sprints: list } satisfies BoardSprintsResponse);
}

/** Create a board sprint. Same manager gate as project sprint planning. */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { boardId } = await params;
  if (!isValidUuid(boardId)) {
    return NextResponse.json({ error: "boardId must be a valid UUID" }, { status: 400 });
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

  const [board] = await db
    .select({ id: observerBoards.id })
    .from(observerBoards)
    .where(eq(observerBoards.id, boardId))
    .limit(1);
  if (!board) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  const session = await getServerSession(authOptions);
  const createdByName = session?.user?.name?.trim() || null;

  const [created] = await db
    .insert(sprints)
    .values({ boardId, projectId: null, name, goal, startDate, endDate, createdBy: user.id, createdByName })
    .returning({ id: sprints.id });

  const initialIssueIds = Array.isArray(body.initialIssueIds) ? body.initialIssueIds : [];
  if (initialIssueIds.length > 0 && initialIssueIds.every((v): v is string => typeof v === "string" && isValidUuid(v))) {
    await db
      .insert(sprintItems)
      .values(initialIssueIds.map((issueId) => ({ sprintId: created.id, issueId, addedBy: user.id, addedByName: createdByName })))
      .onConflictDoNothing();
  }

  revalidateTag("sprints", "max");
  revalidateTag(`board:${boardId}`, "max");

  const sprint = await fetchSprintById(created.id);
  if (!sprint) {
    return NextResponse.json({ error: "Created sprint could not be loaded" }, { status: 500 });
  }
  return NextResponse.json({ sprint }, { status: 201 });
}

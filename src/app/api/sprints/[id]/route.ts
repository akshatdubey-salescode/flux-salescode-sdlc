import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { sprints, sprintItems, sprintWorkstreams } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid, isValidDateString, parseOptionalText } from "@/lib/validation";
import { fetchSprintById, type SprintWithItems } from "@/lib/sprints/entries";

type Params = { params: Promise<{ id: string }> };

export type SprintResponse = { sprint: SprintWithItems; carried?: number };

/** One sprint, fully joined — backs the standalone /sprints/[id] page. */
export async function GET(_req: NextRequest, { params }: Params) {
  await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  const sprint = await fetchSprintById(id);
  if (!sprint) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ sprint } satisfies SprintResponse);
}

/**
 * Edit a sprint's fields, or drive its lifecycle:
 *
 *   { started: true }   planned → active. Takes the commitment snapshot
 *                       (stamps committed = true on every current item) and
 *                       enforces the one-active-sprint-per-project rule.
 *   { completed: true, moveIncompleteToSprintId? }
 *                       active → closed. Standard close flow: the caller says
 *                       what happens to unfinished items — carry them into
 *                       another open sprint (copied with provenance; the rows
 *                       here remain as the spillover record) or leave them.
 *                       No "everything done first" gate: sprints close on
 *                       schedule with unfinished work, that's the report.
 *   { completed: false } reopen a closed sprint.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
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

  const [existing] = await db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await getServerSession(authOptions);
  const actorName = session?.user?.name?.trim() || null;

  const updates: Partial<typeof sprints.$inferInsert> = {};

  if (body.name !== undefined) {
    const name = parseOptionalText(body.name);
    if (!name) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    updates.name = name;
  }
  if (body.goal !== undefined) {
    updates.goal = parseOptionalText(body.goal) ?? null;
  }
  // Move into / out of a workstream. null clears; a target workstream must
  // belong to the sprint's own project.
  if (body.workstreamId !== undefined) {
    if (body.workstreamId === null) {
      updates.workstreamId = null;
    } else {
      if (!isValidUuid(body.workstreamId)) {
        return NextResponse.json({ error: "workstreamId must be a valid UUID or null" }, { status: 400 });
      }
      const [ws] = await db
        .select({ id: sprintWorkstreams.id, projectId: sprintWorkstreams.projectId })
        .from(sprintWorkstreams)
        .where(eq(sprintWorkstreams.id, body.workstreamId))
        .limit(1);
      if (!ws || ws.projectId !== existing.projectId) {
        return NextResponse.json({ error: "workstreamId must reference a workstream of the same project" }, { status: 400 });
      }
      updates.workstreamId = ws.id;
    }
  }
  if (body.startDate !== undefined) {
    if (!isValidDateString(body.startDate)) {
      return NextResponse.json({ error: "startDate must be a valid YYYY-MM-DD date" }, { status: 400 });
    }
    updates.startDate = body.startDate;
  }
  if (body.endDate !== undefined) {
    if (!isValidDateString(body.endDate)) {
      return NextResponse.json({ error: "endDate must be a valid YYYY-MM-DD date" }, { status: 400 });
    }
    updates.endDate = body.endDate;
  }
  const nextStart = updates.startDate ?? existing.startDate;
  const nextEnd = updates.endDate ?? existing.endDate;
  if (nextEnd < nextStart) {
    return NextResponse.json({ error: "endDate must not be before startDate" }, { status: 400 });
  }

  // --- Start the sprint (planned → active) --------------------------------
  if (body.started !== undefined) {
    if (body.started !== true) {
      return NextResponse.json({ error: "started only accepts true — a sprint cannot be un-started" }, { status: 400 });
    }
    if (existing.startedAt) {
      return NextResponse.json({ error: "Sprint is already started" }, { status: 400 });
    }
    if (existing.completedAt) {
      return NextResponse.json({ error: "Sprint is already completed" }, { status: 400 });
    }
    // One active sprint per owner — per project (Jira's default, no parallel
    // sprints) or per Team Pulse board for board-owned sprints.
    const ownerCondition = existing.projectId
      ? eq(sprints.projectId, existing.projectId)
      : eq(sprints.boardId, existing.boardId!);
    const [otherActive] = await db
      .select({ id: sprints.id, name: sprints.name })
      .from(sprints)
      .where(
        and(
          ownerCondition,
          isNotNull(sprints.startedAt),
          isNull(sprints.completedAt),
          isNull(sprints.deletedAt)
        )
      )
      .limit(1);
    if (otherActive) {
      return NextResponse.json(
        { error: `"${otherActive.name}" is already active — complete it before starting another sprint.` },
        { status: 409 }
      );
    }
    updates.startedAt = new Date();
    updates.startedBy = user.id;
    updates.startedByName = actorName;
  }

  // --- Complete / reopen ---------------------------------------------------
  let carried: number | undefined;
  if (body.completed !== undefined) {
    if (typeof body.completed !== "boolean") {
      return NextResponse.json({ error: "completed must be a boolean" }, { status: 400 });
    }
    if (body.completed) {
      if (!existing.startedAt) {
        return NextResponse.json({ error: "Start the sprint before completing it" }, { status: 400 });
      }
      const moveTo = body.moveIncompleteToSprintId;
      if (moveTo !== undefined && moveTo !== null) {
        if (typeof moveTo !== "string" || !isValidUuid(moveTo) || moveTo === id) {
          return NextResponse.json({ error: "moveIncompleteToSprintId must be a different sprint's UUID" }, { status: 400 });
        }
        const [target] = await db.select().from(sprints).where(eq(sprints.id, moveTo)).limit(1);
        if (!target || target.deletedAt) {
          return NextResponse.json({ error: "Target sprint not found" }, { status: 404 });
        }
        if (target.completedAt) {
          return NextResponse.json({ error: "Cannot carry work into a completed sprint" }, { status: 400 });
        }
        if (target.projectId !== existing.projectId || target.boardId !== existing.boardId) {
          return NextResponse.json(
            { error: "Target sprint belongs to a different project or board" },
            { status: 400 }
          );
        }
        // Copy unfinished, non-removed items into the target with provenance;
        // rows here stay as the closed sprint's spillover record. Items the
        // target already holds are skipped. If the target is still planned,
        // its own start will stamp these committed; if it's active, they
        // count as scope added after start — both match Jira.
        carried = (
          await db.execute(sql`
            INSERT INTO sprint_items (sprint_id, issue_id, added_by, added_by_name, added_comment, carried_from_sprint_id, carried_from_sprint_name)
            SELECT ${moveTo}, si.issue_id, ${user.id}, ${actorName}, ${"Carried over from " + existing.name}, ${id}, ${existing.name}
            FROM sprint_items si
            JOIN jira_issues ji ON ji.id = si.issue_id
            WHERE si.sprint_id = ${id}
              AND si.removed_at IS NULL
              AND LOWER(TRIM(COALESCE(ji.status_category, ''))) NOT IN ('done', 'complete')
            ON CONFLICT (sprint_id, issue_id) DO NOTHING
            RETURNING id
          `)
        ).rows.length;
      }
      updates.completedAt = new Date();
      updates.completedBy = user.id;
      updates.completedByName = actorName;
    } else {
      updates.completedAt = null;
      updates.completedBy = null;
      updates.completedByName = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  updates.updatedAt = new Date();

  await db.update(sprints).set(updates).where(eq(sprints.id, id));

  // The commitment snapshot: everything in the sprint at start time is the
  // committed scope. Done AFTER the header update so a concurrent add during
  // this request lands on the started sprint as "added after start", never
  // as a phantom commitment.
  if (updates.startedAt) {
    await db
      .update(sprintItems)
      .set({ committed: true })
      .where(and(eq(sprintItems.sprintId, id), isNull(sprintItems.removedAt)));
  }

  revalidateTag("sprints", "max");
  if (existing.projectId) revalidateTag(`project:${existing.projectId}`, "max");
  if (existing.boardId) revalidateTag(`board:${existing.boardId}`, "max");

  const sprint = await fetchSprintById(id);
  if (!sprint) {
    return NextResponse.json({ error: "Updated sprint could not be loaded" }, { status: 500 });
  }
  return NextResponse.json({ sprint, ...(carried !== undefined ? { carried } : {}) } satisfies SprintResponse);
}

/** Soft-delete a sprint — items stay in the DB for history, it just stops counting anywhere. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await getServerSession(authOptions);
  const deletedByName = session?.user?.name?.trim() || null;

  const [deleted] = await db
    .update(sprints)
    .set({ deletedAt: new Date(), deletedBy: user.id, deletedByName, updatedAt: new Date() })
    .where(and(eq(sprints.id, id), isNull(sprints.deletedAt)))
    .returning({ id: sprints.id, projectId: sprints.projectId, boardId: sprints.boardId });
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  revalidateTag("sprints", "max");
  if (deleted.projectId) revalidateTag(`project:${deleted.projectId}`, "max");
  if (deleted.boardId) revalidateTag(`board:${deleted.boardId}`, "max");

  return NextResponse.json({ ok: true });
}

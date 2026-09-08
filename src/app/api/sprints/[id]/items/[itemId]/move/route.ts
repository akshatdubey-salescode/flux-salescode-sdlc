import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { sprints, sprintItems, jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { bucketStatusCategory } from "@/lib/sprints/entries";
import { parseNewSprintSpec, type NewSprintSpec } from "@/lib/sprints/next-sprint";

type Params = { params: Promise<{ id: string; itemId: string }> };

// Rollback signal for "the source row moved under us" — thrown inside the
// transaction so the target insert (and any sprint created for it) is undone.
const MOVE_RACE = "sprint-item-move-raced";

/**
 * Re-home one issue from this sprint into another — the per-item, any-time
 * version of the spillover carried out wholesale by the close flow (see the
 * sprint PATCH route's moveIncompleteToSprintId).
 *
 * The destination is either an existing open sprint (`targetSprintId`) or one
 * created here (`newSprint`) — the team plans sprints ahead, but the moment
 * work slips is exactly the moment the next sprint turns out not to exist yet,
 * and bouncing the user out to the create form loses the item they were
 * holding. Creating it inside this transaction also means a failed move can't
 * strand an empty sprint behind it.
 *
 * The source sprint's phase decides the semantics, exactly as it does for a
 * plain removal in the sibling DELETE route:
 *
 *   planned source  hard move. The row is deleted here and inserted fresh in
 *                   the target with no new provenance — nothing was ever
 *                   committed to this sprint, so this is backlog grooming,
 *                   not a scope change, and it needs no reason.
 *   active source   copy + soft removal, reason required. The row STAYS here
 *                   flagged removed_at (so the sprint report keeps showing it
 *                   under "removed after start" with the reason and where it
 *                   went) and the target gets a new row carrying
 *                   carried_from_sprint_id/_name — the same provenance the
 *                   close-time carryover writes, so the "↩ from X" badge, the
 *                   carriedOver rollup and the Excel report all light up with
 *                   no extra work.
 *
 * Never a hard move out of a started sprint: deleting the row would shrink
 * the commitment snapshot after the fact and quietly inflate this sprint's
 * completion rate — the one number the tracker exists to keep honest.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id: sourceSprintId, itemId } = await params;
  if (!isValidUuid(sourceSprintId) || !isValidUuid(itemId)) {
    return NextResponse.json({ error: "id and itemId must be valid UUIDs" }, { status: 400 });
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

  // Exactly one destination: an existing sprint, or one to create.
  const hasTargetId = body.targetSprintId !== undefined && body.targetSprintId !== null;
  const hasNewSprint = body.newSprint !== undefined && body.newSprint !== null;
  if (hasTargetId === hasNewSprint) {
    return NextResponse.json(
      { error: "Provide exactly one of targetSprintId or newSprint" },
      { status: 400 }
    );
  }
  let newSprintSpec: NewSprintSpec | null = null;
  if (hasNewSprint) {
    const parsed = parseNewSprintSpec(body.newSprint);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    newSprintSpec = parsed.spec;
  } else if (typeof body.targetSprintId !== "string" || !isValidUuid(body.targetSprintId)) {
    return NextResponse.json({ error: "targetSprintId must be a valid UUID" }, { status: 400 });
  } else if (body.targetSprintId === sourceSprintId) {
    return NextResponse.json({ error: "Target sprint must be different from the source" }, { status: 400 });
  }

  const rawComment = body.comment;
  if (rawComment !== undefined && rawComment !== null && typeof rawComment !== "string") {
    return NextResponse.json({ error: "comment must be a string" }, { status: 400 });
  }
  const comment = typeof rawComment === "string" ? rawComment.trim() : "";

  const [source] = await db
    .select({
      id: sprints.id,
      name: sprints.name,
      projectId: sprints.projectId,
      boardId: sprints.boardId,
      workstreamId: sprints.workstreamId,
      deletedAt: sprints.deletedAt,
      startedAt: sprints.startedAt,
      completedAt: sprints.completedAt,
    })
    .from(sprints)
    .where(eq(sprints.id, sourceSprintId))
    .limit(1);
  if (!source || source.deletedAt) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }
  // Moving work OUT of a closed sprint rewrites a finished report, so it
  // isn't a one-click action: reopen the sprint, move, close it again — that
  // path leaves a visible trail that someone edited closed history.
  if (source.completedAt) {
    return NextResponse.json(
      { error: "This sprint is completed — reopen it before moving work out of it" },
      { status: 400 }
    );
  }

  const [item] = await db
    .select({
      id: sprintItems.id,
      issueId: sprintItems.issueId,
      removedAt: sprintItems.removedAt,
      carriedFromSprintId: sprintItems.carriedFromSprintId,
      carriedFromSprintName: sprintItems.carriedFromSprintName,
      jiraKey: jiraIssues.jiraKey,
      statusCategory: jiraIssues.statusCategory,
    })
    .from(sprintItems)
    .innerJoin(jiraIssues, eq(jiraIssues.id, sprintItems.issueId))
    .where(and(eq(sprintItems.id, itemId), eq(sprintItems.sprintId, sourceSprintId)))
    .limit(1);
  if (!item || item.removedAt) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  // Same rule the close-time carryover applies by filtering on status
  // category: finished work stays in the sprint that finished it. Re-filing a
  // done issue would take the credit off this sprint's velocity and hand it
  // to one that did none of the work — and both reports go out by email.
  if (bucketStatusCategory(item.statusCategory) === "done") {
    return NextResponse.json(
      { error: `${item.jiraKey} is already done — finished work stays in the sprint that completed it` },
      { status: 400 }
    );
  }

  // A sprint about to be created is planned by definition and inherits the
  // source's owner, so the "same project/board" invariant holds by
  // construction; only an existing target has to be checked for it.
  let target: { id: string | null; name: string; startedAt: Date | null };
  if (newSprintSpec) {
    target = { id: null, name: newSprintSpec.name, startedAt: null };
  } else {
    const targetSprintId = body.targetSprintId as string;
    const [existing] = await db
      .select({
        id: sprints.id,
        name: sprints.name,
        projectId: sprints.projectId,
        boardId: sprints.boardId,
        deletedAt: sprints.deletedAt,
        startedAt: sprints.startedAt,
        completedAt: sprints.completedAt,
      })
      .from(sprints)
      .where(eq(sprints.id, targetSprintId))
      .limit(1);
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: "Target sprint not found" }, { status: 404 });
    }
    if (existing.completedAt) {
      return NextResponse.json({ error: "Cannot move work into a completed sprint" }, { status: 400 });
    }
    if (existing.projectId !== source.projectId || existing.boardId !== source.boardId) {
      return NextResponse.json(
        { error: "Target sprint belongs to a different project or board" },
        { status: 400 }
      );
    }
    target = { id: existing.id, name: existing.name, startedAt: existing.startedAt };
  }

  // A started sprint has a commitment to answer to, so the move must say why —
  // whichever END has started. Leaving with no reason would be an untracked
  // scope reduction here; arriving with none would be an untracked scope
  // addition there (the same rule the items POST route enforces).
  if ((source.startedAt || target.startedAt) && !comment) {
    return NextResponse.json(
      {
        error: source.startedAt
          ? "This sprint has started — a reason for moving the item is required."
          : `${target.name} has started — a reason for adding to it is required.`,
      },
      { status: 400 }
    );
  }

  const session = await getServerSession(authOptions);
  const actorName = session?.user?.name?.trim() || null;

  const addedComment = comment ? `Moved from ${source.name}: ${comment}` : null;
  // Leaving a STARTED sprint is spillover, so this sprint becomes the item's
  // origin. Leaving a planned one isn't — the item never belonged to it, so
  // it keeps whatever origin it already carried (an earlier real spillover
  // stays readable through any amount of re-planning).
  const carriedFromId = source.startedAt ? sourceSprintId : item.carriedFromSprintId;
  const carriedFromName = source.startedAt ? source.name : item.carriedFromSprintName;

  // Create-insert-vacate as one unit: a crash — or a concurrent edit to the
  // same item — would otherwise leave the issue sitting in both sprints, or
  // neither, or strand a freshly created sprint with nothing in it.
  const moved = await db
    .transaction(async (tx) => {
      let targetSprintId = target.id;
      if (newSprintSpec) {
        const [created] = await tx
          .insert(sprints)
          .values({
            projectId: source.projectId,
            boardId: source.boardId,
            // Same grouping as the sprint it follows, so an inline creation
            // doesn't silently fall out of its workstream.
            workstreamId: source.workstreamId,
            name: newSprintSpec.name,
            startDate: newSprintSpec.startDate,
            endDate: newSprintSpec.endDate,
            createdBy: user.id,
            createdByName: actorName,
          })
          .returning({ id: sprints.id });
        targetSprintId = created.id;
      }

      // A row the target holds only because it was soft-removed from it earlier
      // is revived as this move's arrival (same upsert the items POST route
      // uses, plus the provenance columns). The WHERE guard keeps a LIVE row
      // untouched — that's the duplicate case, reported as a conflict below.
      const inserted = await tx.execute(sql`
        INSERT INTO sprint_items (sprint_id, issue_id, added_by, added_by_name, added_comment, carried_from_sprint_id, carried_from_sprint_name)
        VALUES (${targetSprintId}, ${item.issueId}, ${user.id}, ${actorName}, ${addedComment}, ${carriedFromId}, ${carriedFromName})
        ON CONFLICT (sprint_id, issue_id) DO UPDATE SET
          removed_at = NULL, removed_by = NULL, removed_by_name = NULL, removed_comment = NULL,
          committed = false,
          added_by = EXCLUDED.added_by, added_by_name = EXCLUDED.added_by_name,
          added_comment = EXCLUDED.added_comment,
          carried_from_sprint_id = EXCLUDED.carried_from_sprint_id,
          carried_from_sprint_name = EXCLUDED.carried_from_sprint_name,
          added_at = now()
        WHERE sprint_items.removed_at IS NOT NULL
        RETURNING id
      `);
      if (inserted.rows.length === 0) return { outcome: "duplicate" as const };

      // Guarded so a move racing another edit of the same row can't strand the
      // issue in both sprints: no row vacated, whole transaction rolled back.
      const vacated = source.startedAt
        ? await tx
            .update(sprintItems)
            .set({
              removedAt: new Date(),
              removedBy: user.id,
              removedByName: actorName,
              removedComment: `Moved to ${target.name}${comment ? `: ${comment}` : ""}`,
            })
            .where(and(eq(sprintItems.id, itemId), isNull(sprintItems.removedAt)))
            .returning({ id: sprintItems.id })
        : await tx.delete(sprintItems).where(eq(sprintItems.id, itemId)).returning({ id: sprintItems.id });
      if (vacated.length === 0) throw new Error(MOVE_RACE);

      return { outcome: "moved" as const, targetSprintId: targetSprintId as string };
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.message === MOVE_RACE) return { outcome: "raced" as const };
      throw err;
    });

  if (moved.outcome === "duplicate") {
    return NextResponse.json({ error: `${item.jiraKey} is already in ${target.name}` }, { status: 409 });
  }
  if (moved.outcome === "raced") {
    return NextResponse.json(
      { error: "That item was changed by someone else — reload the sprint and try again" },
      { status: 409 }
    );
  }

  revalidateTag("sprints", "max");
  if (source.projectId) revalidateTag(`project:${source.projectId}`, "max");
  if (source.boardId) revalidateTag(`board:${source.boardId}`, "max");

  return NextResponse.json({
    ok: true,
    issueId: item.issueId,
    targetSprintId: moved.targetSprintId,
    targetSprintName: target.name,
    createdSprint: Boolean(newSprintSpec),
  });
}

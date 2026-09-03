import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { and, eq, isNull } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { sprints, sprintItems } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";

type Params = { params: Promise<{ id: string; itemId: string }> };

/**
 * Remove one issue from a sprint. Standard scope-change semantics: on a
 * sprint that has been STARTED this is a soft removal (the sprint report
 * keeps showing it under "removed from sprint") and MUST carry a reason in
 * the request body — no silent scope change. On a still-planned sprint it's
 * a hard delete — backlog grooming isn't scope change and needs no reason.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id: sprintId, itemId } = await params;
  if (!isValidUuid(sprintId) || !isValidUuid(itemId)) {
    return NextResponse.json({ error: "id and itemId must be valid UUIDs" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [sprint] = await db
    .select({ id: sprints.id, projectId: sprints.projectId, boardId: sprints.boardId, startedAt: sprints.startedAt })
    .from(sprints)
    .where(eq(sprints.id, sprintId))
    .limit(1);
  if (!sprint) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }

  if (sprint.startedAt) {
    const body = (await req.json().catch(() => ({}))) as { comment?: unknown };
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!comment) {
      return NextResponse.json(
        { error: "This sprint has started — a reason for removing the item is required." },
        { status: 400 }
      );
    }
    const session = await getServerSession(authOptions);
    const removedByName = session?.user?.name?.trim() || null;
    const [removed] = await db
      .update(sprintItems)
      .set({ removedAt: new Date(), removedBy: user.id, removedByName, removedComment: comment })
      .where(and(eq(sprintItems.id, itemId), eq(sprintItems.sprintId, sprintId), isNull(sprintItems.removedAt)))
      .returning({ id: sprintItems.id });
    if (!removed) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
  } else {
    const [deleted] = await db
      .delete(sprintItems)
      .where(and(eq(sprintItems.id, itemId), eq(sprintItems.sprintId, sprintId)))
      .returning({ id: sprintItems.id });
    if (!deleted) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
  }

  revalidateTag("sprints", "max");
  if (sprint.projectId) revalidateTag(`project:${sprint.projectId}`, "max");
  if (sprint.boardId) revalidateTag(`board:${sprint.boardId}`, "max");

  return NextResponse.json({ ok: true });
}

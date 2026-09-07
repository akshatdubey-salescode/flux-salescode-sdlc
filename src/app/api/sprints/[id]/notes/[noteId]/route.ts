import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { and, eq, isNull } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { sprints, sprintNotes } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { MAX_SPRINT_NOTE_LENGTH } from "@/lib/sprints/notes";

type Params = { params: Promise<{ id: string; noteId: string }> };

/** The sprint + note pair, or the response to return instead. */
async function loadNote(sprintId: string, noteId: string) {
  const [sprint] = await db
    .select({ id: sprints.id, projectId: sprints.projectId, boardId: sprints.boardId, deletedAt: sprints.deletedAt })
    .from(sprints)
    .where(eq(sprints.id, sprintId))
    .limit(1);
  if (!sprint || sprint.deletedAt) return { error: NextResponse.json({ error: "Sprint not found" }, { status: 404 }) };

  const [note] = await db
    .select({ id: sprintNotes.id, authorId: sprintNotes.authorId })
    .from(sprintNotes)
    .where(and(eq(sprintNotes.id, noteId), eq(sprintNotes.sprintId, sprintId), isNull(sprintNotes.deletedAt)))
    .limit(1);
  if (!note) return { error: NextResponse.json({ error: "Note not found" }, { status: 404 }) };

  return { sprint, note };
}

function revalidate(sprint: { projectId: string | null; boardId: string | null }) {
  revalidateTag("sprints", "max");
  if (sprint.projectId) revalidateTag(`project:${sprint.projectId}`, "max");
  if (sprint.boardId) revalidateTag(`board:${sprint.boardId}`, "max");
}

/**
 * Edit a note. Only its author — a note is signed with a name and a time, so
 * letting anyone else rewrite it would put words in that person's mouth. The
 * edit stamps edited_at, which the UI shows.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id: sprintId, noteId } = await params;
  if (!isValidUuid(sprintId) || !isValidUuid(noteId)) {
    return NextResponse.json({ error: "id and noteId must be valid UUIDs" }, { status: 400 });
  }

  let payload: { body?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body) {
    return NextResponse.json({ error: "body must be a non-empty string" }, { status: 400 });
  }
  if (body.length > MAX_SPRINT_NOTE_LENGTH) {
    return NextResponse.json(
      { error: `A note can be at most ${MAX_SPRINT_NOTE_LENGTH} characters` },
      { status: 400 }
    );
  }

  const loaded = await loadNote(sprintId, noteId);
  if ("error" in loaded) return loaded.error;
  if (loaded.note.authorId !== user.id) {
    return NextResponse.json({ error: "Only the author can edit a note" }, { status: 403 });
  }

  const now = new Date();
  await db
    .update(sprintNotes)
    .set({ body, editedAt: now, updatedAt: now })
    .where(eq(sprintNotes.id, noteId));

  revalidate(loaded.sprint);
  return NextResponse.json({ ok: true });
}

/**
 * Soft-delete a note — its author, or anyone who can manage the sprint (so a
 * note left by someone who has moved on can still be cleaned up). The row
 * stays for history; every read filters on deleted_at IS NULL.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id: sprintId, noteId } = await params;
  if (!isValidUuid(sprintId) || !isValidUuid(noteId)) {
    return NextResponse.json({ error: "id and noteId must be valid UUIDs" }, { status: 400 });
  }

  const loaded = await loadNote(sprintId, noteId);
  if ("error" in loaded) return loaded.error;
  if (loaded.note.authorId !== user.id && !canManageDeliveries(user)) {
    return NextResponse.json({ error: "Only the author or a sprint manager can delete a note" }, { status: 403 });
  }

  const session = await getServerSession(authOptions);
  const deletedByName = session?.user?.name?.trim() || null;

  await db
    .update(sprintNotes)
    .set({ deletedAt: new Date(), deletedBy: user.id, deletedByName, updatedAt: new Date() })
    .where(eq(sprintNotes.id, noteId));

  revalidate(loaded.sprint);
  return NextResponse.json({ ok: true });
}

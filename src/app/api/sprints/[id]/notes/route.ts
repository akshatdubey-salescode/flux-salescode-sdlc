import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { sprints, sprintNotes } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { MAX_SPRINT_NOTE_LENGTH } from "@/lib/sprints/notes";

type Params = { params: Promise<{ id: string }> };

/**
 * Add a note to a sprint's log.
 *
 * Deliberately NOT gated on canManageDeliveries: a note is additive team
 * context, not a change to the sprint's scope or lifecycle, and the same is
 * true of the per-issue Jira comment box next to it. Editing and deleting
 * ARE gated — see the [noteId] route.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
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

  const [sprint] = await db
    .select({ id: sprints.id, projectId: sprints.projectId, boardId: sprints.boardId, deletedAt: sprints.deletedAt })
    .from(sprints)
    .where(eq(sprints.id, id))
    .limit(1);
  if (!sprint || sprint.deletedAt) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }

  const session = await getServerSession(authOptions);
  const authorName = session?.user?.name?.trim() || null;

  const [note] = await db
    .insert(sprintNotes)
    .values({ sprintId: id, body, authorId: user.id, authorName })
    .returning({ id: sprintNotes.id });

  revalidateTag("sprints", "max");
  if (sprint.projectId) revalidateTag(`project:${sprint.projectId}`, "max");
  if (sprint.boardId) revalidateTag(`board:${sprint.boardId}`, "max");

  return NextResponse.json({ id: note.id }, { status: 201 });
}

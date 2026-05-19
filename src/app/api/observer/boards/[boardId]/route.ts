import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

type Params = { params: Promise<{ boardId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    await requireAuth();
    const { boardId } = await params;

    const [board] = await db
      .select()
      .from(observerBoards)
      .where(eq(observerBoards.id, boardId));

    if (!board) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const members = await db
      .select()
      .from(observerBoardMembers)
      .where(eq(observerBoardMembers.boardId, boardId));

    return NextResponse.json({ ...board, members });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { boardId } = await params;
    const body = await request.json();
    const { name, description, managerName, managerEmail } = body as {
      name?: string;
      description?: string;
      managerName?: string;
      managerEmail?: string;
    };

    const [existing] = await db
      .select({ id: observerBoards.id })
      .from(observerBoards)
      .where(and(eq(observerBoards.id, boardId), eq(observerBoards.createdBy, user.id)));

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updates: Partial<typeof observerBoards.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (managerName !== undefined) updates.managerName = managerName?.trim() || null;
    if (managerEmail !== undefined) updates.managerEmail = managerEmail?.trim() || null;

    const [updated] = await db
      .update(observerBoards)
      .set(updates)
      .where(eq(observerBoards.id, boardId))
      .returning();

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { boardId } = await params;

    const [existing] = await db
      .select({ id: observerBoards.id })
      .from(observerBoards)
      .where(and(eq(observerBoards.id, boardId), eq(observerBoards.createdBy, user.id)));

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.delete(observerBoards).where(eq(observerBoards.id, boardId));

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

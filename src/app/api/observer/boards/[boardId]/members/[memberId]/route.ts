import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

type Params = { params: Promise<{ boardId: string; memberId: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { boardId, memberId } = await params;

    const [board] = await db
      .select({ id: observerBoards.id })
      .from(observerBoards)
      .where(and(eq(observerBoards.id, boardId), eq(observerBoards.createdBy, user.id)));

    if (!board) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db
      .delete(observerBoardMembers)
      .where(
        and(
          eq(observerBoardMembers.id, memberId),
          eq(observerBoardMembers.boardId, boardId)
        )
      );

    await db
      .update(observerBoards)
      .set({ updatedAt: new Date() })
      .where(eq(observerBoards.id, boardId));

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

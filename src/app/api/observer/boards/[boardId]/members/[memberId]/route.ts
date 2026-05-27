import { NextResponse } from "next/server";
import { eq, and, or } from "drizzle-orm";
import { revalidateTag } from "next/cache";
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
      .where(
        and(
          eq(observerBoards.id, boardId),
          or(
            eq(observerBoards.createdBy, user.id),
            eq(observerBoards.managerEmail, user.email)
          )
        )
      );

    if (!board) {
      return NextResponse.json(
        { error: "You don't have permission to manage members on this board." },
        { status: 403 }
      );
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

    revalidateTag(`board:${boardId}`, "max");
    revalidateTag("boards", "max");
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

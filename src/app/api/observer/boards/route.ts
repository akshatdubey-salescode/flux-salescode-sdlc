import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

export async function GET() {
  try {
    const user = await requireAuth();

    const boards = await db
      .select({
        id: observerBoards.id,
        name: observerBoards.name,
        description: observerBoards.description,
        createdAt: observerBoards.createdAt,
        updatedAt: observerBoards.updatedAt,
      })
      .from(observerBoards)
      .where(eq(observerBoards.createdBy, user.id))
      .orderBy(desc(observerBoards.updatedAt));

    const boardIds = boards.map((b) => b.id);

    const memberCounts =
      boardIds.length > 0
        ? await db
            .select({
              boardId: observerBoardMembers.boardId,
              id: observerBoardMembers.id,
            })
            .from(observerBoardMembers)
            .where(
              boardIds.length === 1
                ? eq(observerBoardMembers.boardId, boardIds[0])
                : // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (eq as any)(observerBoardMembers.boardId, boardIds[0])
            )
        : [];

    // Build a count map
    const countMap: Record<string, number> = {};
    for (const bid of boardIds) {
      countMap[bid] = 0;
    }

    if (boardIds.length > 0) {
      const allMembers = await db
        .select({ boardId: observerBoardMembers.boardId })
        .from(observerBoardMembers);

      for (const m of allMembers) {
        if (m.boardId in countMap) {
          countMap[m.boardId]++;
        }
      }
    }

    return NextResponse.json(
      boards.map((b) => ({ ...b, memberCount: countMap[b.id] ?? 0 }))
    );
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { name, description } = body as { name: string; description?: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const [board] = await db
      .insert(observerBoards)
      .values({
        name: name.trim(),
        description: description?.trim() || null,
        createdBy: user.id,
      })
      .returning();

    return NextResponse.json(board, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

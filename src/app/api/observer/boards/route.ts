import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

export async function GET() {
  try {
    const user = await requireAuth();
    const boards = await fetchObserverBoards();
    return NextResponse.json(
      boards.map((b) => ({ ...b, isOwned: b.createdBy === user.id }))
    );
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

async function fetchObserverBoards() {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues");

  const boards = await db
    .select({
      id: observerBoards.id,
      name: observerBoards.name,
      description: observerBoards.description,
      managerName: observerBoards.managerName,
      managerEmail: observerBoards.managerEmail,
      createdBy: observerBoards.createdBy,
      createdAt: observerBoards.createdAt,
      updatedAt: observerBoards.updatedAt,
    })
    .from(observerBoards)
    .orderBy(desc(observerBoards.updatedAt));

  const allMembers = boards.length > 0
    ? await db.select({ boardId: observerBoardMembers.boardId }).from(observerBoardMembers)
    : [];

  const countMap: Record<string, number> = {};
  for (const b of boards) countMap[b.id] = 0;
  for (const m of allMembers) {
    if (m.boardId in countMap) countMap[m.boardId]++;
  }

  return boards.map((b) => ({ ...b, memberCount: countMap[b.id] ?? 0 }));
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { name, description, managerName, managerEmail } = body as {
      name: string;
      description?: string;
      managerName?: string;
      managerEmail?: string;
    };

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const [board] = await db
      .insert(observerBoards)
      .values({
        name: name.trim(),
        description: description?.trim() || null,
        managerName: managerName?.trim() || null,
        managerEmail: managerEmail?.trim() || null,
        createdBy: user.id,
      })
      .returning();

    revalidateTag("jira-issues", "max");
    return NextResponse.json(board, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

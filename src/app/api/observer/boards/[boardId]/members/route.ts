import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

type Params = { params: Promise<{ boardId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { boardId } = await params;

    const [board] = await db
      .select({ id: observerBoards.id })
      .from(observerBoards)
      .where(and(eq(observerBoards.id, boardId), eq(observerBoards.createdBy, user.id)));

    if (!board) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, email, jiraAccountId } = body as {
      name: string;
      email: string;
      jiraAccountId?: string;
    };

    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
    }

    const [member] = await db
      .insert(observerBoardMembers)
      .values({
        boardId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        jiraAccountId: jiraAccountId?.trim() || null,
      })
      .onConflictDoNothing()
      .returning();

    if (!member) {
      return NextResponse.json({ error: "Member already exists on this board" }, { status: 409 });
    }

    // Touch board updatedAt
    await db
      .update(observerBoards)
      .set({ updatedAt: new Date() })
      .where(eq(observerBoards.id, boardId));

    return NextResponse.json(member, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

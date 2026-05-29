import { NextResponse } from "next/server";
import { eq, and, or } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { ensureMemberJiraAccountId } from "@/lib/jira/identity";

type Params = { params: Promise<{ boardId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { boardId } = await params;

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

    // Resolve Jira accountId in the background when the caller didn't
    // supply one. This is what keeps unplanned/timeline views working for
    // members whose Atlassian profile hides emailAddress on issue payloads.
    if (!member.jiraAccountId) {
      void ensureMemberJiraAccountId(member.id);
    }

    // Touch board updatedAt
    await db
      .update(observerBoards)
      .set({ updatedAt: new Date() })
      .where(eq(observerBoards.id, boardId));

    revalidateTag(`board:${boardId}`, "max");
    revalidateTag("boards", "max");
    return NextResponse.json(member, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

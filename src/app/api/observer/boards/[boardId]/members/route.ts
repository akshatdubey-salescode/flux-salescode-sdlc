import { NextResponse } from "next/server";
import { eq, and, or } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { ensureMemberJiraAccountId } from "@/lib/jira/identity";
import { loadKekaDirectory } from "@/lib/keka/directory";

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

    // The Keka-only rule's write boundary (src/lib/keka/people.ts). The picker
    // that feeds this form can no longer offer a non-Keka person, but the
    // board's member list is durable — anything let in here outlives the UI
    // that added it and reappears on every tab built from board membership.
    // So the check lives on the API, not just in the picker.
    const dir = await loadKekaDirectory();
    const normalizedEmail = email.trim().toLowerCase();
    if (!dir.isActive(normalizedEmail)) {
      return NextResponse.json(
        {
          error:
            "Only current employees from the Keka directory can be added to a board. " +
            "If this person has just joined, run the Keka sync and try again.",
        },
        { status: 422 }
      );
    }

    const [member] = await db
      .insert(observerBoardMembers)
      .values({
        boardId,
        name: name.trim(),
        email: normalizedEmail,
        jiraAccountId: jiraAccountId?.trim() || null,
      })
      .onConflictDoNothing()
      .returning();

    if (!member) {
      const [existingMember] = await db
        .select({ id: observerBoardMembers.id })
        .from(observerBoardMembers)
        .where(
          and(
            eq(observerBoardMembers.boardId, boardId),
            eq(observerBoardMembers.email, normalizedEmail)
          )
        );
      return NextResponse.json(
        {
          error: "Member already exists on this board",
          memberId: existingMember?.id,
        },
        { status: 409 }
      );
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

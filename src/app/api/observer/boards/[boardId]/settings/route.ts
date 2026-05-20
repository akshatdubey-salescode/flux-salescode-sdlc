import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoards } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

type Params = { params: Promise<{ boardId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { boardId } = await params;

    const [owned] = await db
      .select({ id: observerBoards.id })
      .from(observerBoards)
      .where(and(eq(observerBoards.id, boardId), eq(observerBoards.createdBy, user.id)));

    if (!owned) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as { stalenessThresholdDays?: number };

    const { stalenessThresholdDays } = body;

    if (
      stalenessThresholdDays === undefined ||
      !Number.isInteger(stalenessThresholdDays) ||
      stalenessThresholdDays < 1 ||
      stalenessThresholdDays > 90
    ) {
      return NextResponse.json(
        { error: "stalenessThresholdDays must be an integer between 1 and 90" },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(observerBoards)
      .set({ stalenessThresholdDays, updatedAt: new Date() })
      .where(eq(observerBoards.id, boardId))
      .returning({ stalenessThresholdDays: observerBoards.stalenessThresholdDays });

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

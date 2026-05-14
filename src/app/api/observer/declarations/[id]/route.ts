import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { engineerWorkDeclarations } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const { comment, expectedCompletionDate } = (await request.json()) as {
      comment?: string | null;
      expectedCompletionDate?: string | null;
    };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (comment !== undefined) updates.comment = comment ?? null;
    if (expectedCompletionDate !== undefined)
      updates.expectedCompletionDate = expectedCompletionDate ?? null;

    const [updated] = await db
      .update(engineerWorkDeclarations)
      .set(updates)
      .where(
        and(
          eq(engineerWorkDeclarations.id, id),
          eq(engineerWorkDeclarations.engineerEmail, user.email)
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    const [deleted] = await db
      .delete(engineerWorkDeclarations)
      .where(
        and(
          eq(engineerWorkDeclarations.id, id),
          eq(engineerWorkDeclarations.engineerEmail, user.email)
        )
      )
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

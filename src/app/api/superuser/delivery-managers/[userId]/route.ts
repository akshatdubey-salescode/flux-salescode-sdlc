import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";

type Params = { params: Promise<{ userId: string }> };

/** Grant or revoke the canManageDeliveries flag for one user. */
export async function PATCH(req: NextRequest, { params }: Params) {
  await requireRole("SUPERUSER");
  const { userId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const canManageDeliveries = (body as { canManageDeliveries?: unknown })?.canManageDeliveries;
  if (typeof canManageDeliveries !== "boolean") {
    return NextResponse.json({ error: "canManageDeliveries must be a boolean" }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set({ canManageDeliveries, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (!updated) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

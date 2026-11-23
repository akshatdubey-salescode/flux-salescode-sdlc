import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuth } from "@/lib/auth/server";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { FEATURE_FLAGS, isEnabled } from "@/lib/feature-flags";
import { NotFoundError, deleteOwnershipEvent } from "@/lib/support/store";

type Params = { params: Promise<{ id: string; issueId: string; eventId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  if (!(await isEnabled(FEATURE_FLAGS.SUPPORT_REPORTS))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { id, issueId, eventId } = await params;
  if (!isValidUuid(id) || !isValidUuid(issueId) || !isValidUuid(eventId)) {
    return NextResponse.json({ error: "ids must be valid UUIDs" }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  try {
    await deleteOwnershipEvent(id, issueId, eventId, {
      id: user.id,
      name: session?.user?.name?.trim() || user.email,
    });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}

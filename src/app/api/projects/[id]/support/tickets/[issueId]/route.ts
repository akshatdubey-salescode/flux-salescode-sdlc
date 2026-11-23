import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuth } from "@/lib/auth/server";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { FEATURE_FLAGS, isEnabled } from "@/lib/feature-flags";
import { NotFoundError, updateSupportTicket, ValidationError } from "@/lib/support/store";
import { parseTicketPatch } from "@/lib/support/validate";

type Params = { params: Promise<{ id: string; issueId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  if (!(await isEnabled(FEATURE_FLAGS.SUPPORT_REPORTS))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { id, issueId } = await params;
  if (!isValidUuid(id) || !isValidUuid(issueId)) {
    return NextResponse.json({ error: "id and issueId must be valid UUIDs" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseTicketPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const session = await getServerSession(authOptions);
  try {
    await updateSupportTicket(id, issueId, parsed.value, {
      id: user.id,
      name: session?.user?.name?.trim() || user.email,
    });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { hasMinRole } from "@/lib/auth/types";
import { syncFreshdeskTickets } from "@/lib/freshdesk/sync";

export async function POST(
  _req: Request,
  props: { params: Promise<{ projectId: string }> }
) {
  const user = await requireAuth();
  if (!hasMinRole(user.role, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { projectId } = await props.params;

  try {
    const result = await syncFreshdeskTickets(projectId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { hasMinRole } from "@/lib/auth/types";
import { syncFreshdeskTickets } from "@/lib/freshdesk/sync";

export async function POST(
  req: Request,
  props: { params: Promise<{ projectId: string }> }
) {
  const user = await requireAuth();
  if (!hasMinRole(user.role, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { projectId } = await props.params;

  let startDate: Date | undefined;
  let endDate: Date | undefined;
  try {
    const body = await req.json();
    if (body.startDate) startDate = new Date(body.startDate);
    if (body.endDate) {
      endDate = new Date(body.endDate);
      endDate.setUTCHours(23, 59, 59, 999);
    }
  } catch {
    // no body or invalid JSON — sync all
  }

  try {
    const result = await syncFreshdeskTickets(projectId, { startDate, endDate });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

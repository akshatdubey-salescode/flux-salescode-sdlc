import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { approvalBlocker, approveAndSend, ConflictError } from "@/lib/support/send";
import { NotFoundError } from "@/lib/support/store";
import { displayName, guardReport, requireApprover } from "@/lib/support/route-guard";

type Params = { params: Promise<{ id: string; reportId: string }> };

// Also serves Retry (a failed report goes through the same guarded claim).
export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id, reportId } = await params;
  const g = await guardReport(id, reportId);
  if ("res" in g) return g.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).builtAt : undefined;
  const expectedBuiltAt = typeof raw === "string" && raw ? new Date(raw) : null;
  if (!expectedBuiltAt || Number.isNaN(expectedBuiltAt.getTime())) {
    return NextResponse.json({ error: "builtAt (ISO timestamp) is required" }, { status: 400 });
  }

  const gate = await requireApprover(user, id);
  if ("res" in gate) return gate.res;
  const blocker = approvalBlocker(g.report, gate.settings);
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });

  try {
    const result = await approveAndSend(
      reportId,
      { id: user.id, name: await displayName(user) },
      expectedBuiltAt,
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

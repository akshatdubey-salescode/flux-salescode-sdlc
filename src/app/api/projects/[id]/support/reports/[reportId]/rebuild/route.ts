import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { buildSupportReport } from "@/lib/support/build";
import { NotFoundError } from "@/lib/support/store";
import { displayName, guardReport, requireApprover } from "@/lib/support/route-guard";

type Params = { params: Promise<{ id: string; reportId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id, reportId } = await params;
  const g = await guardReport(id, reportId);
  if ("res" in g) return g.res;
  const gate = await requireApprover(user, id);
  if ("res" in gate) return gate.res;
  if (g.report.status !== "awaiting_approval") {
    return NextResponse.json({ error: "Only a report awaiting approval can be rebuilt" }, { status: 409 });
  }
  try {
    const result = await buildSupportReport(id, g.report.reportDate, {
      id: user.id,
      name: await displayName(user),
    });
    if ("blocked" in result) {
      return NextResponse.json({ error: "Report has already been sent or is being sent" }, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

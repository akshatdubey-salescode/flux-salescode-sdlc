import { NextRequest, NextResponse } from "next/server";
import { overrideItem, revokeOverride } from "@/lib/movement/service/service";
import { authActor, badIds, readJson, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string; issueId: string }> };

/** Admin only: override a blocked Jira with a mandatory reason (5-500 characters); `include: true` ticks it in the same step. */
export async function POST(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid, issueId } = await params;
  const bad = badIds({ id, mid, issueId });
  if (bad) return bad;
  return run(async () => {
    const body = await readJson(req);
    if (body.include !== undefined && typeof body.include !== "boolean") return NextResponse.json({ error: "include must be true or false" }, { status: 400 });
    return NextResponse.json(await overrideItem(id, mid, issueId, body.reason, actor, body.include === true));
  });
}

/** Admin only: revoke an override (reason required). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid, issueId } = await params;
  const bad = badIds({ id, mid, issueId });
  if (bad) return bad;
  return run(async () => {
    const body = await readJson(req);
    return NextResponse.json(await revokeOverride(id, mid, issueId, body.reason, actor));
  });
}

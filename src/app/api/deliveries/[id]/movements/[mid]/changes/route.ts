import { NextRequest, NextResponse } from "next/server";
import { getChangesSinceSigned } from "@/lib/movement/service/service";
import { authActor, badIds, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

/** What changed since the caller signed: the full diff against their signed snapshot, plus the capped diffs of the last resets. SIGNERS ONLY (the three slot holders); 403 for anybody else. */
export async function GET(_req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => NextResponse.json(await getChangesSinceSigned(id, mid, actor)));
}

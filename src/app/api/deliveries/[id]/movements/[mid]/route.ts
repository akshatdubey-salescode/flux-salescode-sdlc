import { NextRequest, NextResponse } from "next/server";
import { getMovementView } from "@/lib/movement/service/service";
import { authActor, badIds, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

/**
 * Everything the panel shows except the checklist sections; read from the database only, no Jira call.
 * Reads are open to any signed-in user (consistent with the deliveries routes: accepted); changes are
 * guarded per action. `needsRefresh` / `refreshError` say when approvals are blocked.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => NextResponse.json(await getMovementView(id, mid, actor)));
}

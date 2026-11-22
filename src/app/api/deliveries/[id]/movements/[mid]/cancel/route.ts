import { NextRequest, NextResponse } from "next/server";
import { cancelMovement } from "@/lib/movement/service/service";
import { authActor, badIds, readJson, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

/** Cancel a movement that is not done (frees the environment for a new one). Optional `{ reason }`. */
export async function POST(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => {
    const body = await readJson(req, false);
    return NextResponse.json(await cancelMovement(id, mid, body.reason, actor));
  });
}

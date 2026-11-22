import { NextRequest, NextResponse } from "next/server";
import { refreshForActor } from "@/lib/movement/service/service";
import { authActor, badIds, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

// Reads Jira for up to 200 Jiras (bounded fan-out, concurrency 5).
export const maxDuration = 300;

/** Re-read the Jira records now. 200 with a summary; `{refreshing:true}` when another refresh runs; 422 with a message when nothing could be refreshed. */
export async function POST(_req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => {
    const result = await refreshForActor(id, mid, actor);
    return NextResponse.json(result, { status: result.error ? 422 : 200 });
  });
}

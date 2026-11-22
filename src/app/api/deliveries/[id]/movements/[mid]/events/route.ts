import { NextRequest, NextResponse } from "next/server";
import { listEvents } from "@/lib/movement/service/service";
import { authActor, badIds, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

/** The event history, newest first: `?limit=` (<= 50, default 20) and `?before=` (the `nextBefore` of the previous page). */
export async function GET(req: NextRequest, { params }: Params) {
  await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => {
    const url = new URL(req.url);
    return NextResponse.json(await listEvents(id, mid, { limit: url.searchParams.get("limit") ?? undefined, before: url.searchParams.get("before") ?? undefined }));
  });
}

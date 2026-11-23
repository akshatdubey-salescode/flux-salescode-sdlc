import { NextRequest, NextResponse } from "next/server";
import { setIncluded } from "@/lib/movement/service/service";
import { authActor, badIds, readJson, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

/** Tick or untick Jiras: `{ issueIds: string[] (<= 200), included: boolean }`. A blocked Jira needs an override first (409). */
export async function PATCH(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => {
    const body = await readJson(req);
    if (Array.isArray(body.issueIds)) {
      const badId = badIds(Object.fromEntries((body.issueIds as unknown[]).slice(0, 200).map((v, i) => [`issueIds[${i}]`, String(v)])));
      if (badId) return badId;
    }
    return NextResponse.json(await setIncluded(id, mid, body.issueIds, body.included, actor));
  });
}

import { NextRequest, NextResponse } from "next/server";
import { signMovement } from "@/lib/movement/service/service";
import { authActor, badIds, readJson, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

/** Sign a slot you hold: `{ slot, hash }` where `hash` is the checklist hash you reviewed. 409 with the current hash when it changed. */
export async function POST(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => {
    const body = await readJson(req);
    return NextResponse.json(await signMovement(id, mid, body.slot, body.hash, actor));
  });
}

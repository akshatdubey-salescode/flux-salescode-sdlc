import { NextRequest, NextResponse } from "next/server";
import { setSigners } from "@/lib/movement/service/service";
import { authActor, badIds, readJson, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

/** Change who holds a slot (before everyone has signed): `{ deployer?, ba?, lead? }`, each an email or `{ email, name }`. A changed slot loses its sign-off. */
export async function PUT(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => {
    const body = await readJson(req);
    return NextResponse.json(await setSigners(id, mid, body, actor));
  });
}

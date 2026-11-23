import { NextRequest, NextResponse } from "next/server";
import { startMovement } from "@/lib/movement/service/service";
import { authActor, badIds, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

/** The deployer (or an admin) starts the deployment once all three sign-offs are on the current checklist. */
export async function POST(_req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => NextResponse.json(await startMovement(id, mid, actor)));
}

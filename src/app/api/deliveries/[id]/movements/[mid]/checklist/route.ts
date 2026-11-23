import { NextRequest, NextResponse } from "next/server";
import { getChecklist } from "@/lib/movement/service/service";
import { authActor, badIds, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

/** The merged checklist (all sections): the one big payload, so it has its own endpoint. */
export async function GET(_req: NextRequest, { params }: Params) {
  await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => NextResponse.json({ checklist: await getChecklist(id, mid) }));
}

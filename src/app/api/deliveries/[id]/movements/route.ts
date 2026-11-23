import { NextRequest, NextResponse } from "next/server";
import { createMovement, listMovements } from "@/lib/movement/service/service";
import { authActor, badIds, readJson, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string }> };

// Create runs the first refresh (Jira reads for up to 200 Jiras).
export const maxDuration = 300;

/** The movements of a delivery (light: no inputs, no checklist). */
export async function GET(_req: NextRequest, { params }: Params) {
  await authActor();
  const { id } = await params;
  const bad = badIds({ id });
  if (bad) return bad;
  return run(async () => NextResponse.json({ movements: await listMovements(id) }));
}

/** Create a movement of the delivery to one environment: `{ environment, signers: { deployer, ba, lead } }`. 409 when one is live. */
export async function POST(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id } = await params;
  const bad = badIds({ id });
  if (bad) return bad;
  return run(async () => {
    const body = await readJson(req);
    const out = await createMovement(id, body.environment, body.signers, actor);
    return NextResponse.json(out, { status: 201 });
  });
}

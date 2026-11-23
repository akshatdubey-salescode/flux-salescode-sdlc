import { NextRequest, NextResponse } from "next/server";
import { doneMovement } from "@/lib/movement/service/service";
import { authActor, badIds, readJson, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

/**
 * The deployer (or an admin) marks the deployment done: optional
 * `{ comment, results: [{ issueId, result: "moved"|"held", comment }] }` (<= 200); without it the
 * result is prefilled from the ticks (included = moved).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => {
    const body = await readJson(req, false);
    const results = Array.isArray(body.results) ? (body.results as Array<{ issueId: string; result: never; comment?: string | null }>) : undefined;
    if (body.results !== undefined && !results) return NextResponse.json({ error: "results must be an array" }, { status: 400 });
    return NextResponse.json(await doneMovement(id, mid, { results, comment: body.comment as string | null | undefined }, actor));
  });
}

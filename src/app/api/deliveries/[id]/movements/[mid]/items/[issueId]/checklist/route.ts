import { NextRequest, NextResponse } from "next/server";
import { getItemChecklistWithServices } from "@/lib/movement/service/service";
import { authActor, badIds, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string; issueId: string }> };

/**
 * The detailed checklist of ONE Jira: all its review comments merged into the 14 sections (Flux-side comment edits
 * applied), shown whatever the Jira's tick / override state, so a held Jira can be read too. `{ checklist, services }`, bounded
 * like the movement checklist, and `services`: the Jira's services (one entry per canonical service from its records' deploy / restart facts, plus
 * the "also" lines and what is not needed), computed with the helpers the movement roll-up uses. 404 when the Jira is not in the movement, 409 `inputs_stale` when a refresh is needed.
 * Reads are open to any signed-in user (like the other GETs).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  await authActor();
  const { id, mid, issueId } = await params;
  const bad = badIds({ id, mid, issueId });
  if (bad) return bad;
  return run(async () => NextResponse.json(await getItemChecklistWithServices(id, mid, issueId)));
}

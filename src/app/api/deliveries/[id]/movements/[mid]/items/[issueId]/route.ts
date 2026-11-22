import { NextRequest, NextResponse } from "next/server";
import { getItemDetail } from "@/lib/movement/service/service";
import { authActor, badIds, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string; issueId: string }> };

/**
 * One Jira's per-PR record detail (pointer, record status, reviewed / moved heads, stale flag, unknown
 * counts), loaded on demand; never the comment text. Reads are open to any signed-in user.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  await authActor();
  const { id, mid, issueId } = await params;
  const bad = badIds({ id, mid, issueId });
  if (bad) return bad;
  return run(async () => NextResponse.json(await getItemDetail(id, mid, issueId)));
}

import { NextRequest, NextResponse } from "next/server";
import { previewComment } from "@/lib/movement/service/comments";
import { authActor, badIds, readJson, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string; issueId: string }> };

/**
 * Read an edited text as a record WITHOUT saving it: `{ commentId, text }` gives
 * `{ preview: { status, covers, rows, unknowns, warnings } }`. 400 when the first DEPLOYMENT-RECORD line is gone or
 * the PRs changed. Same permissions and states as saving.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid, issueId } = await params;
  const bad = badIds({ id, mid, issueId });
  if (bad) return bad;
  return run(async () => NextResponse.json(await previewComment(id, mid, issueId, await readJson(req), actor)));
}

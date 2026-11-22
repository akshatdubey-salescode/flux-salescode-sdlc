import { NextRequest, NextResponse } from "next/server";
import { listComments, resetComment, saveComment } from "@/lib/movement/service/comments";
import { authActor, badIds, readJson, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string; issueId: string }> };

// One live, read-only Jira read of the comments (<= 200 per ticket).
export const maxDuration = 60;

/**
 * The review comments of one Jira: `{ comments: [{ commentId, scope, covers, version, status, updated, original,
 * edited, editedBy, editedAt, stale, current }], jiraAvailable, more }`. `original` is read live from Jira (read-only,
 * not cached); `edited` is the Flux-side text (an overlay). Open to any signed-in user.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  await authActor();
  const { id, mid, issueId } = await params;
  const bad = badIds({ id, mid, issueId });
  if (bad) return bad;
  return run(async () => NextResponse.json(await listComments(id, mid, issueId)));
}

/**
 * Save a Flux-side correction of one comment: `{ commentId, text }` (20 to 40,000 characters; it must still start with
 * the DEPLOYMENT-RECORD line and name the same PRs). Delivery managers and admins, while the movement is draft, ready
 * or signed_off. Jira is NOT written. It changes the checklist hash, so every sign-off is cleared.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid, issueId } = await params;
  const bad = badIds({ id, mid, issueId });
  if (bad) return bad;
  return run(async () => NextResponse.json(await saveComment(id, mid, issueId, await readJson(req), actor)));
}

/** Drop the Flux-side correction (`?commentId=`): the Jira text is used again. Same permissions and states as PUT. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid, issueId } = await params;
  const bad = badIds({ id, mid, issueId });
  if (bad) return bad;
  return run(async () => NextResponse.json(await resetComment(id, mid, issueId, new URL(req.url).searchParams.get("commentId"), actor)));
}

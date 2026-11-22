import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { confirmStatuses, proposeStatuses } from "@/lib/movement/service/service";
import { authActor, badIds, readJson, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

// Up to 200 items, each written through the shared status routine (gates + history).
export const maxDuration = 300;

/**
 * The statuses Flux proposes after "done" (PROD movements only; demo / uat return an empty list with a
 * `note`): included and moved = delivered, held or unticked = not delivered, never taking back a "delivered".
 * Reads are open to any signed-in user, like the deliveries routes.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => NextResponse.json(await proposeStatuses(id, mid)));
}

/** One-click confirm (optionally `{ issueIds }`), deployer or admin, prod only (409 `not_prod`): writes the statuses and their history through the shared routine. Idempotent. */
export async function POST(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => {
    const body = await readJson(req, false);
    if (Array.isArray(body.issueIds)) {
      const badId = badIds(Object.fromEntries((body.issueIds as unknown[]).slice(0, 200).map((v, i) => [`issueIds[${i}]`, String(v)])));
      if (badId) return badId;
    }
    // Same caches the item PATCH route refreshes: the Delivery column / badges embed these statuses. Done by the
    // service's `finally`, so it also happens when a later item failed after some were already written.
    const { results, counts } = await confirmStatuses(id, mid, body.issueIds, actor, {
      onWritten: ({ projectIds }) => {
        revalidateTag("deliveries", "max");
        for (const p of projectIds) revalidateTag(`project:${p}`, "max");
        revalidateTag("my-tasks", "max");
      },
    });
    const out = { results, counts };
    return NextResponse.json(out);
  });
}

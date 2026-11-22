import { NextRequest, NextResponse } from "next/server";
import { generateSummary, getSummary } from "@/lib/movement/service/summary";
import { authActor, badIds, readJson, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

// One AI call (60 s) plus the writes.
export const maxDuration = 120;

/**
 * The movement summary: `{ summary, status: "fresh"|"stale"|"none"|"rules_only", hash, source, generatedAt, generatedBy,
 * model, note, ai: { available, reason } }`. `fresh` = an AI summary of the CURRENT checklist; otherwise `summary` is the
 * deterministic roll-up of the current checklist. No AI or Jira call. Open to any signed-in user.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => NextResponse.json(await getSummary(id, mid)));
}

/**
 * Generate it (delivery managers and admins): optional `{ force: true }` regenerates even when a fresh AI summary
 * exists. Answers like GET. Never fails because the AI does: it then returns the deterministic summary with a plain
 * `note`. 429 when asked again within 20 s or more than 30 times a day for the movement.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => {
    const body = await readJson(req, false);
    if (body.force !== undefined && typeof body.force !== "boolean") return NextResponse.json({ error: "force must be true or false" }, { status: 400 });
    return NextResponse.json(await generateSummary(id, mid, actor, { force: body.force === true }));
  });
}

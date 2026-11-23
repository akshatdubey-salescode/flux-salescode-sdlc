import { NextRequest, NextResponse } from "next/server";
import { and, asc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { authActor, badIds, run } from "@/lib/movement/service/http";
import { MovementError } from "@/lib/movement/service/types";
import { likePatterns, SIGNER_CANDIDATES_LIMIT, shapeSignerCandidates, validateSignerQuery } from "@/lib/deliveries/signer-candidates";

type Params = { params: Promise<{ id: string }> };

/**
 * Flux users a movement signer can be: `?q=` (2 to 60 characters) matched against the e-mail (users.id) with escaped ILIKE, every
 * word of the text must match; at most 20 `{ email, name }`, the name derived from the address. Read-only, delivery managers only
 * (they are the ones who pick signers). Only users can be signers (the service refuses anyone else), so this is the right list;
 * the Jira assignee search it replaces offered people who are not Flux users.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id } = await params;
  const bad = badIds({ id });
  if (bad) return bad;
  return run(async () => {
    if (!actor.isManager) throw new MovementError(403, "Only delivery managers can choose signers", "forbidden");
    const check = validateSignerQuery(req.nextUrl.searchParams.get("q"));
    if (!check.ok) throw new MovementError(400, check.error, "bad_request");
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(...likePatterns(check.terms).map((p) => sql`${users.id} ilike ${p} escape '\\'`)))
      .orderBy(asc(users.id))
      .limit(SIGNER_CANDIDATES_LIMIT);
    return NextResponse.json({ candidates: shapeSignerCandidates(rows) });
  });
}

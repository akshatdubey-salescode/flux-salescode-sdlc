import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isValidUuid } from "@/lib/validation";
import { isResponse, requireTestCasesUser, toActor, readJsonObject } from "@/lib/test-cases/api";
import { addComment, getRoundContext } from "@/lib/test-cases/review-service";

/** Comment on the round as a whole, or on one test case (caseId). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roundId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;

  const { roundId } = await ctx.params;
  if (!isValidUuid(roundId)) return NextResponse.json({ error: "Invalid round id" }, { status: 400 });

  const parsedBody = await readJsonObject(req);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body as { caseId?: unknown; body?: unknown };
  const caseId = body.caseId === undefined || body.caseId === null ? null : body.caseId;
  if (caseId !== null && !isValidUuid(caseId)) return NextResponse.json({ error: "caseId must be a valid UUID" }, { status: 400 });

  const round = await getRoundContext(roundId);
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  const result = await addComment({ ctx: round, actor: toActor(user), caseId, body: body.body });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidateTag("test-cases", "max");
  return NextResponse.json({ id: result.id }, { status: 201 });
}

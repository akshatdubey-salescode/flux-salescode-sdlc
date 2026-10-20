import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isValidUuid } from "@/lib/validation";
import { isResponse, requireTestCasesUser, toActor, readJsonObject } from "@/lib/test-cases/api";
import { setCommentResolved } from "@/lib/test-cases/review-service";

/** Mark a comment resolved (or reopen it). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ commentId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;

  const { commentId } = await ctx.params;
  if (!isValidUuid(commentId)) return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });

  const parsedBody = await readJsonObject(req);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body as { resolved?: unknown };
  if (typeof body.resolved !== "boolean") return NextResponse.json({ error: "resolved must be true or false" }, { status: 400 });

  const result = await setCommentResolved({ commentId, actor: toActor(user), resolved: body.resolved });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidateTag("test-cases", "max");
  return NextResponse.json({ ok: true });
}

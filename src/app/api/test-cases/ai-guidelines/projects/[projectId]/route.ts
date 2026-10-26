import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/validation";
import { isResponse, readJsonObject, requireTestCasesUser, toActor } from "@/lib/test-cases/api";
import { setProjectGuidelines } from "@/lib/test-cases/ai-review/knowledge";

/** Replace the set of (non-general) library pages this project's reviews use. Admins only. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;
  if (!toActor(user).isAdmin) return NextResponse.json({ error: "Only an admin can choose a project's AI review guidelines." }, { status: 403 });
  const { projectId } = await ctx.params;
  if (!isValidUuid(projectId)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const ids = parsed.body.guidelineIds;
  if (!Array.isArray(ids) || ids.length > 100 || !ids.every((i) => isValidUuid(i))) return NextResponse.json({ error: "guidelineIds must be a list of page ids." }, { status: 400 });
  const result = await setProjectGuidelines({ projectId, guidelineIds: ids as string[], selectedBy: user.email });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

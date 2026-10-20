import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/validation";
import { errorResponse, isResponse, requireTestCasesUser } from "@/lib/test-cases/api";
import { fetchCaseDetail } from "@/lib/test-cases/service";

/** The long text of one test case, loaded when its row is expanded. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ caseId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;

  const { caseId } = await ctx.params;
  if (!isValidUuid(caseId)) return NextResponse.json({ error: "Invalid case id" }, { status: 400 });

  try {
    const detail = await fetchCaseDetail(caseId);
    if (!detail) return NextResponse.json({ error: "Test case not found" }, { status: 404 });
    return NextResponse.json(detail, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    return errorResponse(err);
  }
}

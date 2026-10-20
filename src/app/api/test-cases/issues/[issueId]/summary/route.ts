import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/validation";
import { XLSX_CONTENT_TYPE } from "@/lib/storage";
import { isResponse, requireTestCasesUser } from "@/lib/test-cases/api";
import { buildSummaryForIssue } from "@/lib/test-cases/summary-service";

export const maxDuration = 60;

/** The issue's analytics summary as a dated workbook, built fresh from the stored stats (not stored). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ issueId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;

  const { issueId } = await ctx.params;
  if (!isValidUuid(issueId)) return NextResponse.json({ error: "Invalid issue id" }, { status: 400 });

  const built = await buildSummaryForIssue(issueId, user.email);
  if (!built) return NextResponse.json({ error: "No test cases to summarise for this issue." }, { status: 404 });

  return new NextResponse(new Uint8Array(built.buffer), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${built.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

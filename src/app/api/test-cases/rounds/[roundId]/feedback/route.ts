import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/validation";
import { XLSX_CONTENT_TYPE } from "@/lib/storage";
import { isResponse, requireTestCasesUser } from "@/lib/test-cases/api";
import { istStamp } from "@/lib/test-cases/filenames";
import { buildFeedbackBundle, getRoundContext } from "@/lib/test-cases/review-service";
import { safeSegment } from "@/lib/test-cases/filenames";

/** The round's feedback so far, built fresh and dated (not stored). Decisions also store a copy automatically. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roundId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;

  const { roundId } = await ctx.params;
  if (!isValidUuid(roundId)) return NextResponse.json({ error: "Invalid round id" }, { status: 400 });
  const round = await getRoundContext(roundId);
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  const { buffer } = await buildFeedbackBundle(round);
  const name = `Feedback_r${round.roundNo}_${safeSegment(round.issue.jiraKey, 20)}_${istStamp(new Date())}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

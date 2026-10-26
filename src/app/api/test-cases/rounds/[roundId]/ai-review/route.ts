import { NextRequest, NextResponse, after } from "next/server";
import { revalidateTag } from "next/cache";
import { isValidUuid } from "@/lib/validation";
import { isLlmConfigured } from "@/lib/llm/minimax";
import { isResponse, requireTestCasesUser, toActor } from "@/lib/test-cases/api";
import { getRoundContext } from "@/lib/test-cases/review-service";
import { executeAiReview, getLatestAiRun, manualRunsLeft, startAiReview } from "@/lib/test-cases/ai-review/service";

// The review itself runs after the response and counts toward this limit.
export const maxDuration = 300;

/** The newest AI run on a round, for the page to poll while one is running. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roundId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;
  const { roundId } = await ctx.params;
  if (!isValidUuid(roundId)) return NextResponse.json({ error: "Invalid round id" }, { status: 400 });
  if (!isLlmConfigured()) return NextResponse.json({ enabled: false, run: null });
  const round = await getRoundContext(roundId);
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  const [run, limits] = await Promise.all([getLatestAiRun(roundId), manualRunsLeft(roundId)]);
  return NextResponse.json({ enabled: true, run, limits });
}

/** Run the AI review on the latest round (a reviewer, the submitter or an admin). Returns at once; poll GET. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ roundId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;
  const { roundId } = await ctx.params;
  if (!isValidUuid(roundId)) return NextResponse.json({ error: "Invalid round id" }, { status: 400 });

  const actor = toActor(user);
  const started = await startAiReview({ roundId, trigger: "manual", requestedBy: user.email, actor });
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });

  if (started.started) {
    after(async () => {
      try {
        await executeAiReview(started.run.id);
      } finally {
        revalidateTag("test-cases", "max");
      }
    });
  }
  return NextResponse.json({ run: started.run, started: started.started }, { status: started.started ? 202 : 200 });
}

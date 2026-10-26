import { NextRequest, NextResponse, after } from "next/server";
import { revalidateTag } from "next/cache";
import { isLlmConfigured } from "@/lib/llm/minimax";
import { isResponse, readJsonObject, requireTestCasesUser, toActor } from "@/lib/test-cases/api";
import { getHealth, probe, usageLast24h } from "@/lib/test-cases/ai-review/health";
import { countRoundsNeedingReview, rerunSkippedReviews } from "@/lib/test-cases/ai-review/service";

export const maxDuration = 300;

async function status() {
  const [health, usage, needingReview] = await Promise.all([getHealth(), usageLast24h(), countRoundsNeedingReview()]);
  return {
    configured: isLlmConfigured(),
    state: health.state,
    reason: health.reason,
    message: health.message,
    since: health.since.getTime() > 0 ? health.since.toISOString() : null,
    lastOkAt: health.lastOkAt?.toISOString() ?? null,
    lastFailureAt: health.lastFailureAt?.toISOString() ?? null,
    retryAt: health.retryAt?.toISOString() ?? null,
    usage,
    needingReview,
  };
}

/** The AI service's health, last-24h usage and how many reviews were skipped. Admins only. */
export async function GET() {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;
  if (!toActor(user).isAdmin) return NextResponse.json({ error: "Only an admin can see the AI status." }, { status: 403 });
  return NextResponse.json(await status());
}

/** { action: "check" } makes one small real call; { action: "rerun" } re-runs reviews that were skipped or failed. */
export async function POST(req: NextRequest) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;
  if (!toActor(user).isAdmin) return NextResponse.json({ error: "Only an admin can do this." }, { status: 403 });
  if (!isLlmConfigured()) return NextResponse.json({ error: "The AI review is not enabled (no API key is configured)." }, { status: 409 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;

  if (parsed.body.action === "check") {
    await probe();
    return NextResponse.json(await status());
  }
  if (parsed.body.action === "rerun") {
    const health = await getHealth();
    if (health.state === "paused") return NextResponse.json({ error: "The AI service is still on hold. Press Check now first; once it answers, re-run the skipped reviews." }, { status: 409 });
    const queued = await countRoundsNeedingReview();
    after(async () => {
      try {
        await rerunSkippedReviews(user.email);
      } finally {
        revalidateTag("test-cases", "max");
      }
    });
    return NextResponse.json({ queued: Math.min(queued, 25) }, { status: 202 });
  }
  return NextResponse.json({ error: "action must be check or rerun" }, { status: 400 });
}

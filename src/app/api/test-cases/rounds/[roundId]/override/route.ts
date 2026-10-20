import { NextRequest, NextResponse, after } from "next/server";
import { revalidateTag } from "next/cache";
import { isValidUuid } from "@/lib/validation";
import { appOrigin, isResponse, requireTestCasesUser, toActor, readJsonObject } from "@/lib/test-cases/api";
import { getRoundContext, overrideAndApprove } from "@/lib/test-cases/review-service";
import { buildDecisionEmail, sendEmail } from "@/lib/test-cases/notify";

/**
 * A reviewer waives the open feedback and approves, with a reason. The reason,
 * who did it and what was waived are recorded in the review history.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roundId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;

  const { roundId } = await ctx.params;
  if (!isValidUuid(roundId)) return NextResponse.json({ error: "Invalid round id" }, { status: 400 });

  const parsedBody = await readJsonObject(req);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body as { reason?: unknown };

  const round = await getRoundContext(roundId);
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  const actor = toActor(user);
  const result = await overrideAndApprove({ ctx: round, actor, reason: body.reason });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidateTag("test-cases", "max");
  revalidateTag(`project:${round.issue.projectId}`, "max");

  // Tell the submitter, after the response so a mail problem never affects the override.
  const origin = appOrigin(req);
  const reason = String(body.reason).trim();
  after(async () => {
    const email = buildDecisionEmail({
      issueKey: round.issue.jiraKey,
      issueSummary: round.issue.summary,
      projectName: round.issue.projectName,
      roundLabel: round.label,
      url: `${origin}/test-cases/${round.issue.id}?round=${round.roundNo}`,
      reviewerName: actor.name ?? actor.email,
      decision: "approved",
      comment: `Approved with the open feedback overridden. Reason: ${reason}`,
    });
    const sent = await sendEmail([round.committerEmail], email);
    if (!sent.ok) console.warn("[test-cases] override email not sent:", sent.error);
  });

  return NextResponse.json({
    status: result.status,
    waivedComments: result.waivedComments,
    overriddenReviewers: result.overriddenReviewers,
    feedbackFileId: result.feedbackFileId,
  });
}

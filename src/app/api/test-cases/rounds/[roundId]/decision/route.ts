import { NextRequest, NextResponse, after } from "next/server";
import { revalidateTag } from "next/cache";
import { isValidUuid } from "@/lib/validation";
import { appOrigin, isResponse, requireTestCasesUser, toActor, readJsonObject } from "@/lib/test-cases/api";
import { getRoundContext, recordDecision } from "@/lib/test-cases/review-service";
import { buildDecisionEmail, sendEmail } from "@/lib/test-cases/notify";

/** A reviewer approves, or requests changes with a note. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roundId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;

  const { roundId } = await ctx.params;
  if (!isValidUuid(roundId)) return NextResponse.json({ error: "Invalid round id" }, { status: 400 });

  const parsedBody = await readJsonObject(req);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body as { decision?: unknown; comment?: unknown };
  const comment = typeof body.comment === "string" ? body.comment : "";

  const round = await getRoundContext(roundId);
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  const actor = toActor(user);
  const result = await recordDecision({ ctx: round, actor, decision: String(body.decision ?? ""), comment });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidateTag("test-cases", "max");
  revalidateTag(`project:${round.issue.projectId}`, "max");

  // Tell the submitter, after the response so a mail problem never affects the decision.
  const origin = appOrigin(req);
  after(async () => {
    const email = buildDecisionEmail({
      issueKey: round.issue.jiraKey,
      issueSummary: round.issue.summary,
      projectName: round.issue.projectName,
      roundLabel: round.label,
      url: `${origin}/test-cases/${round.issue.id}?round=${round.roundNo}`,
      reviewerName: actor.name ?? actor.email,
      decision: body.decision as "approved" | "changes_requested",
      comment,
    });
    const sent = await sendEmail([round.committerEmail], email);
    if (!sent.ok) console.warn("[test-cases] decision email not sent:", sent.error);
  });

  return NextResponse.json({ status: result.status, feedbackFileId: result.feedbackFileId });
}

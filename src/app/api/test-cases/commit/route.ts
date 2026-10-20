import { NextRequest, NextResponse, after } from "next/server";
import { revalidateTag } from "next/cache";
import { isValidUuid, parseOptionalText } from "@/lib/validation";
import { appOrigin, errorResponse, isResponse, requireTestCasesUser, toActor } from "@/lib/test-cases/api";
import { roundLabel } from "@/lib/test-cases/filenames";
import { getItemLock } from "@/lib/test-cases/lock";
import { parseTabs } from "@/lib/test-cases/multi-tab";
import { buildAssignedEmail, sendEmail } from "@/lib/test-cases/notify";
import { readSource } from "@/lib/test-cases/source";
import { resolveSourceInput } from "@/lib/test-cases/source-request";
import { validateReviewers } from "@/lib/test-cases/reviewers";
import { commitRound, findIssue } from "@/lib/test-cases/service";

export const maxDuration = 60;

/**
 * Commit step. Everything is re-read and re-parsed here from the original
 * source — the preview the browser showed is never trusted — then the round,
 * its snapshot, the parsed cases and the reviewers are saved. The item's source
 * is fixed by its first submission (see lock.ts); a resubmission must use it.
 */
export async function POST(req: NextRequest) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a form submission." }, { status: 400 });
  }

  const issueId = form.get("issueId");
  if (!isValidUuid(issueId)) return NextResponse.json({ error: "issueId must be a valid UUID" }, { status: 400 });
  const lookup = await findIssue({ issueId });
  if (lookup.kind !== "found") return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  const issue = lookup.issue;

  let reviewersJson: unknown;
  try {
    reviewersJson = JSON.parse(String(form.get("reviewers") ?? "[]"));
  } catch {
    return NextResponse.json({ error: "Invalid reviewers." }, { status: 400 });
  }
  const reviewers = validateReviewers(reviewersJson, user.email);
  if (!reviewers.ok) return NextResponse.json({ error: reviewers.error }, { status: 400 });

  const notes = parseOptionalText(form.get("notes")) ?? null;
  if (notes && notes.length > 2000) return NextResponse.json({ error: "Notes are too long (max 2000 characters)." }, { status: 400 });

  const lock = await getItemLock(issueId);
  const resolved = await resolveSourceInput({ form, userId: user.id, jiraKey: issue.jiraKey, lock });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error, code: resolved.code }, { status: resolved.status });
  if (!resolved.input.tabs || resolved.input.tabs.length === 0) {
    return NextResponse.json({ error: "Choose at least one tab that holds this item's test cases." }, { status: 400 });
  }

  try {
    const read = await readSource(resolved.input);
    if (!read.grids || read.selectedTabs.length === 0) {
      return NextResponse.json({ error: "Choose at least one tab that holds this item's test cases." }, { status: 400 });
    }

    const parsed = parseTabs(read.grids);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const errors = parsed.issues.filter((i) => i.severity === "error");
    if (errors.length > 0) {
      return NextResponse.json(
        { error: `Fix ${errors.length} error${errors.length === 1 ? "" : "s"} first: ${errors[0].tab}: ${errors[0].message}` },
        { status: 400 },
      );
    }

    const result = await commitRound({
      issue,
      committer: { email: user.email, name: user.name },
      source: read.source,
      sheetUrl: read.sheetUrl,
      spreadsheetId: read.spreadsheetId,
      parsed,
      grids: read.grids,
      reviewers: reviewers.reviewers,
      notes,
      isAdmin: toActor(user).isAdmin,
      sourceHash: read.sourceHash,
    });

    revalidateTag("test-cases", "max");
    revalidateTag(`project:${issue.projectId}`, "max");

    // Ask only the reviewers who still have to act (new, or asked for changes before),
    // after the response: a mail problem must not fail the commit.
    const origin = appOrigin(req);
    const committerName = user.name ?? user.email;
    after(async () => {
      if (result.needsAction.length === 0) return;
      const email = buildAssignedEmail({
        issueKey: issue.jiraKey,
        issueSummary: issue.summary,
        projectName: issue.projectName,
        roundLabel: roundLabel(result.roundNo, new Date()),
        url: `${origin}/test-cases/${issue.id}?round=${result.roundNo}`,
        committerName,
        tcCount: parsed.cases.length,
        notes,
      });
      const sent = await sendEmail(result.needsAction.map((r) => r.email), email);
      if (!sent.ok) console.warn("[test-cases] reviewer email not sent:", sent.error);
    });
    return NextResponse.json({ ...result, detailUrl: `/test-cases/${issue.id}` }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

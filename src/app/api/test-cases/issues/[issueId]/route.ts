import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isValidUuid } from "@/lib/validation";
import { isResponse, requireTestCasesUser, toActor, readJsonObject } from "@/lib/test-cases/api";
import { deleteItemTestCases } from "@/lib/test-cases/delete-service";
import { findIssue } from "@/lib/test-cases/service";
import { validateDeleteRequest } from "@/lib/test-cases/state";

/**
 * Admin only: delete every test case, review, sign-off and file of one item
 * (a wrong sheet or link was submitted). Needs the typed Jira key and a reason.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ issueId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;

  const { issueId } = await ctx.params;
  if (!isValidUuid(issueId)) return NextResponse.json({ error: "Invalid issue id" }, { status: 400 });

  const parsedBody = await readJsonObject(req);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body as { confirm?: unknown; reason?: unknown };

  const lookup = await findIssue({ issueId });
  if (lookup.kind !== "found") return NextResponse.json({ error: "Issue not found." }, { status: 404 });

  const actor = toActor(user);
  const valid = validateDeleteRequest({ isAdmin: actor.isAdmin, issueKey: lookup.issue.jiraKey, confirm: body.confirm, reason: body.reason });
  if (!valid.ok) return NextResponse.json({ error: valid.reason }, { status: valid.status });

  const result = await deleteItemTestCases({ issue: lookup.issue, actor: { email: user.email, name: user.name }, reason: valid.reason });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidateTag("test-cases", "max");
  revalidateTag(`project:${lookup.issue.projectId}`, "max");
  return NextResponse.json({ deleted: result.counts, storageFailures: result.storageFailures });
}

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isValidUuid, parseOptionalText } from "@/lib/validation";
import { errorResponse, isResponse, requireTestCasesUser } from "@/lib/test-cases/api";
import { readSource, type SourceInput } from "@/lib/test-cases/source";
import { parseSheetGrid } from "@/lib/test-cases/template";
import { validateReviewers } from "@/lib/test-cases/reviewers";
import { MAX_XLSX_BYTES } from "@/lib/test-cases/xlsx";
import { commitRound, findIssue } from "@/lib/test-cases/service";

export const maxDuration = 60;

/**
 * Commit step. Everything is re-read and re-parsed here from the original
 * source — the preview the browser showed is never trusted — then the round,
 * its snapshot, the parsed cases and the reviewers are saved.
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

  const tab = typeof form.get("tab") === "string" ? (form.get("tab") as string) : "";
  if (!tab) return NextResponse.json({ error: "Choose the tab that holds this issue's test cases." }, { status: 400 });

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

  const source = form.get("source");
  const file = form.get("file");
  let input: SourceInput;
  if (source === "xlsx") {
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Attach the .xlsx file." }, { status: 400 });
    if (file.size > MAX_XLSX_BYTES) return NextResponse.json({ error: "That file is larger than 4 MB. Share it as a Google Sheet link instead." }, { status: 413 });
    input = { source: "xlsx", file: Buffer.from(await file.arrayBuffer()), tab, jiraKey: issue.jiraKey };
  } else if (source === "google_sheet") {
    const sheetUrl = String(form.get("sheetUrl") ?? "").trim();
    if (!sheetUrl) return NextResponse.json({ error: "Provide the Google Sheet link." }, { status: 400 });
    input = { source: "google_sheet", userId: user.id, sheetUrl, tab, jiraKey: issue.jiraKey };
  } else {
    return NextResponse.json({ error: "source must be google_sheet or xlsx" }, { status: 400 });
  }

  try {
    const read = await readSource(input);
    if (!read.grid || !read.selectedTab) return NextResponse.json({ error: "Choose the tab that holds this issue's test cases." }, { status: 400 });

    const parsed = parseSheetGrid(read.grid);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const errors = parsed.issues.filter((i) => i.severity === "error");
    if (errors.length > 0) {
      return NextResponse.json({ error: `Fix ${errors.length} error${errors.length === 1 ? "" : "s"} first: ${errors[0].message}` }, { status: 400 });
    }

    const result = await commitRound({
      issue,
      committer: { email: user.email, name: user.name },
      source: read.source,
      sheetUrl: read.sheetUrl,
      spreadsheetId: read.spreadsheetId,
      tab: read.selectedTab,
      parsed,
      grid: read.grid,
      reviewers: reviewers.reviewers,
      notes,
    });

    revalidateTag("test-cases", "max");
    revalidateTag(`project:${issue.projectId}`, "max");
    return NextResponse.json({ ...result, detailUrl: `/test-cases/${issue.id}` }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

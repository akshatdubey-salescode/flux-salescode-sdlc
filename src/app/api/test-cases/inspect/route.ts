import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/validation";
import { errorResponse, isResponse, requireTestCasesUser } from "@/lib/test-cases/api";
import { readSource, type SourceInput } from "@/lib/test-cases/source";
import { parseSheetGrid } from "@/lib/test-cases/template";
import { buildPreview } from "@/lib/test-cases/preview";
import { MAX_XLSX_BYTES } from "@/lib/test-cases/xlsx";
import { findIssue } from "@/lib/test-cases/service";

export const maxDuration = 60;

/** Validate step: read the sheet/file, pick the tab, and return a preview. Saves nothing. */
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

  const sheetUrl = typeof form.get("sheetUrl") === "string" ? (form.get("sheetUrl") as string).trim() : "";
  const file = form.get("file");
  const tab = typeof form.get("tab") === "string" && form.get("tab") ? (form.get("tab") as string) : null;

  let input: SourceInput;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_XLSX_BYTES) {
      return NextResponse.json({ error: "That file is larger than 4 MB. Share it as a Google Sheet link instead.", code: "too_large" }, { status: 413 });
    }
    input = { source: "xlsx", file: Buffer.from(await file.arrayBuffer()), tab, jiraKey: lookup.issue.jiraKey };
  } else if (sheetUrl) {
    input = { source: "google_sheet", userId: user.id, sheetUrl, tab, jiraKey: lookup.issue.jiraKey };
  } else {
    return NextResponse.json({ error: "Provide a Google Sheet link or an .xlsx file." }, { status: 400 });
  }

  try {
    const read = await readSource(input);
    const preview = read.grid ? buildPreview(parseSheetGrid(read.grid)) : null;
    return NextResponse.json({
      source: read.source,
      sheetUrl: read.sheetUrl,
      sheetTitle: read.sheetTitle,
      tabs: read.tabs,
      selectedTab: read.selectedTab,
      preview,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

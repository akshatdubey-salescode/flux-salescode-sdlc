import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/validation";
import { errorResponse, isResponse, requireTestCasesUser } from "@/lib/test-cases/api";
import { getItemLock } from "@/lib/test-cases/lock";
import { parseTabs } from "@/lib/test-cases/multi-tab";
import { buildPreview } from "@/lib/test-cases/preview";
import { latestContentHash, findIssue } from "@/lib/test-cases/service";
import { contentHash } from "@/lib/test-cases/content-hash";
import { readSource } from "@/lib/test-cases/source";
import { resolveSourceInput } from "@/lib/test-cases/source-request";

export const maxDuration = 60;

/** Validate step: read the sheet/file, pick the tabs, and return a preview. Saves nothing. */
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

  const lock = await getItemLock(issueId);
  const resolved = await resolveSourceInput({ form, userId: user.id, jiraKey: lookup.issue.jiraKey, lock });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error, code: resolved.code }, { status: resolved.status });

  try {
    const read = await readSource(resolved.input);
    const preview = read.grids ? buildPreview(parseTabs(read.grids)) : null;
    // Is this exactly what the latest round already holds? (Only said, never enforced: resubmitting is allowed.)
    const latest = read.grids ? await latestContentHash(issueId) : null;
    const sameAsRound = latest && read.grids && contentHash(read.grids) === latest.hash ? latest.roundNo : null;
    return NextResponse.json({
      source: read.source,
      sheetUrl: read.sheetUrl,
      sheetTitle: read.sheetTitle,
      tabs: read.tabs,
      selectedTabs: read.selectedTabs,
      missingPrevious: read.missingPrevious,
      sameAsRound,
      preview,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

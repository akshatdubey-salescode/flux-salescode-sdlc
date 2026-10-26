import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/validation";
import { errorResponse, isResponse, requireTestCasesUser } from "@/lib/test-cases/api";
import { getItemLock } from "@/lib/test-cases/lock";
import { parseTabs, type RealignAnchor } from "@/lib/test-cases/multi-tab";
import { buildPreview } from "@/lib/test-cases/preview";
import { latestContentHash, findIssue, findScopeOverlaps } from "@/lib/test-cases/service";
import { checkScope, defaultedNotice } from "@/lib/test-cases/submission";
import { scopedGrids } from "@/lib/test-cases/scoped-grid";
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
    const tabsInfo = { source: read.source, sheetUrl: read.sheetUrl, sheetTitle: read.sheetTitle, tabs: read.tabs, selectedTabs: read.selectedTabs, missingPrevious: read.missingPrevious };

    // No tab named and too many to take them all: nothing was read; the person ticks tabs.
    if (read.tooManyTabs !== null) {
      return NextResponse.json({ ...tabsInfo, defaulted: false, tooManyTabs: read.tooManyTabs, notice: null, sameAsRound: null, overlaps: [], preview: null });
    }
    if (!read.grids) return NextResponse.json({ ...tabsInfo, defaulted: false, tooManyTabs: null, notice: null, sameAsRound: null, overlaps: [], preview: null });

    const scope = checkScope(read, form.get("scope"));
    if (!scope.ok) return NextResponse.json({ ...tabsInfo, defaulted: read.defaulted, tooManyTabs: null, notice: null, sameAsRound: null, overlaps: [], preview: { ok: false, error: scope.error }, code: scope.code });

    // Rows move when someone inserts rows in the live sheet: remember where the previous round's test cases were.
    const anchors = new Map<string, RealignAnchor>();
    for (const e of lock?.scope?.tabs ?? []) {
      if (e.firstId && e.lastId && e.firstRow && e.lastRow && e.ranges && e.ranges.length === 1) anchors.set(e.tab, { firstId: e.firstId, lastId: e.lastId, firstRow: e.firstRow, lastRow: e.lastRow });
    }
    const parsed = parseTabs(read.grids, { scope: scope.scope, skipNonTc: read.defaulted, anchors });
    const preview = buildPreview(parsed);
    // Is this exactly what the latest round already holds? (Only said, never enforced: resubmitting is allowed.)
    let sameAsRound: number | null = null;
    let overlaps: Awaited<ReturnType<typeof findScopeOverlaps>> = [];
    if (parsed.ok) {
      const latest = await latestContentHash(issueId);
      sameAsRound = latest && contentHash(scopedGrids(read.grids, parsed)) === latest.hash ? latest.roundNo : null;
      // Other items of this project that review some of the same test cases of this sheet (a warning, never a block).
      overlaps = await findScopeOverlaps({ issueId, projectId: lookup.issue.projectId, spreadsheetId: read.spreadsheetId, tcKeys: parsed.cases.map((c) => c.tcKey) });
    }
    return NextResponse.json({
      ...tabsInfo,
      defaulted: read.defaulted,
      tooManyTabs: null,
      notice: parsed.ok ? defaultedNotice(read, parsed.skipped, lookup.issue.jiraKey) : null,
      sameAsRound,
      overlaps,
      preview,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

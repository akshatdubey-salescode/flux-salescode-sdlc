import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isValidUuid, parseOptionalText } from "@/lib/validation";
import { errorResponse, isResponse, requireTestCasesUser, toActor } from "@/lib/test-cases/api";
import { getRoundContext } from "@/lib/test-cases/review-service";
import { checkSignoffAllowed, commitSignoff, previewSignoff } from "@/lib/test-cases/signoff-service";
import { getItemLock } from "@/lib/test-cases/lock";
import { parseTabs } from "@/lib/test-cases/multi-tab";
import { readSource } from "@/lib/test-cases/source";
import { resolveSourceInput } from "@/lib/test-cases/source-request";
import { TC_SIGNOFF_ROLE_VALUES } from "@/lib/test-cases/values";

export const maxDuration = 60;

/**
 * Dev / tester sign-off for an approved round. `mode=preview` reads the sheet
 * and reports what would be recorded without saving; `mode=commit` re-reads it
 * (the preview is never trusted) and records the results.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roundId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;

  const { roundId } = await ctx.params;
  if (!isValidUuid(roundId)) return NextResponse.json({ error: "Invalid round id" }, { status: 400 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a form submission." }, { status: 400 });
  }

  const role = form.get("role");
  if (typeof role !== "string" || !(TC_SIGNOFF_ROLE_VALUES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: "role must be dev or tester" }, { status: 400 });
  }
  const signRole = role as (typeof TC_SIGNOFF_ROLE_VALUES)[number];
  const mode = form.get("mode") === "commit" ? "commit" : "preview";

  const round = await getRoundContext(roundId);
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  const actor = toActor(user);
  const allowed = await checkSignoffAllowed({ ctx: round, actor, role: signRole });
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  // Sign-off reads the item's own source (same sheet link or a workbook with the same tabs)
  // and exactly the tabs of the latest round; the user chooses neither.
  const lock = await getItemLock(round.issue.id);
  if (!lock) return NextResponse.json({ error: "No test cases have been submitted for this item." }, { status: 409 });
  const resolved = await resolveSourceInput({ form, userId: user.id, jiraKey: round.issue.jiraKey, lock, fixedTabs: lock.tabs, ignoreSourceLock: true });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error, code: resolved.code }, { status: resolved.status });

  try {
    const read = await readSource(resolved.input);
    const base = { sheetUrl: read.sheetUrl, sheetTitle: read.sheetTitle, tabs: read.tabs, selectedTabs: read.selectedTabs };
    if (!read.grids || read.selectedTabs.length === 0) {
      return NextResponse.json({ error: "This item has no tabs to read." }, { status: 400 });
    }
    // A shared sheet holds other features' cases too: read the whole tabs and match only this round's cases.
    const parsed = parseTabs(read.grids, { uncapped: true });
    if (!parsed.ok) {
      return mode === "commit"
        ? NextResponse.json({ error: parsed.error }, { status: 400 })
        : NextResponse.json({ ...base, preview: null, error: parsed.error });
    }

    if (mode === "preview") {
      return NextResponse.json({ ...base, preview: await previewSignoff(round, parsed, signRole, read.grids) });
    }

    const notes = parseOptionalText(form.get("notes")) ?? null;
    if (notes && notes.length > 2000) return NextResponse.json({ error: "Notes are too long (max 2000 characters)." }, { status: 400 });

    const result = await commitSignoff({
      ctx: round,
      actor: { email: user.email, name: user.name },
      role: signRole,
      source: read.source,
      sheetUrl: read.sheetUrl,
      spreadsheetId: read.spreadsheetId,
      tab: read.selectedTabs.join(", "),
      parsed,
      grids: read.grids,
      notes,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    revalidateTag("test-cases", "max");
    revalidateTag(`project:${round.issue.projectId}`, "max");
    return NextResponse.json({ signoffId: result.signoffId, fileName: result.fileName, detailUrl: `/test-cases/${round.issue.id}` }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

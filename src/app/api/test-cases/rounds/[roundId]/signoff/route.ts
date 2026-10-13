import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isValidUuid, parseOptionalText } from "@/lib/validation";
import { errorResponse, isResponse, requireTestCasesUser, toActor } from "@/lib/test-cases/api";
import { getRoundContext } from "@/lib/test-cases/review-service";
import { checkSignoffAllowed, commitSignoff, previewSignoff } from "@/lib/test-cases/signoff-service";
import { readSource, type SourceInput } from "@/lib/test-cases/source";
import { parseSheetGrid } from "@/lib/test-cases/template";
import { TC_SIGNOFF_ROLE_VALUES } from "@/lib/test-cases/values";
import { MAX_XLSX_BYTES } from "@/lib/test-cases/xlsx";

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

  const tab = typeof form.get("tab") === "string" && form.get("tab") ? (form.get("tab") as string) : null;
  const source = form.get("source");
  const file = form.get("file");
  let input: SourceInput;
  if (source === "xlsx") {
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Attach the .xlsx file." }, { status: 400 });
    if (file.size > MAX_XLSX_BYTES) return NextResponse.json({ error: "That file is larger than 4 MB. Share it as a Google Sheet link instead." }, { status: 413 });
    input = { source: "xlsx", file: Buffer.from(await file.arrayBuffer()), tab, jiraKey: round.issue.jiraKey };
  } else if (source === "google_sheet") {
    const sheetUrl = String(form.get("sheetUrl") ?? "").trim();
    if (!sheetUrl) return NextResponse.json({ error: "Provide the Google Sheet link." }, { status: 400 });
    input = { source: "google_sheet", userId: user.id, sheetUrl, tab, jiraKey: round.issue.jiraKey };
  } else {
    return NextResponse.json({ error: "source must be google_sheet or xlsx" }, { status: 400 });
  }

  try {
    const read = await readSource(input);
    const base = { sheetUrl: read.sheetUrl, sheetTitle: read.sheetTitle, tabs: read.tabs, selectedTab: read.selectedTab };
    if (!read.grid || !read.selectedTab) {
      if (mode === "commit") return NextResponse.json({ error: "Choose the tab that holds the test cases." }, { status: 400 });
      return NextResponse.json({ ...base, preview: null });
    }
    const parsed = parseSheetGrid(read.grid);
    if (!parsed.ok) {
      return mode === "commit"
        ? NextResponse.json({ error: parsed.error }, { status: 400 })
        : NextResponse.json({ ...base, preview: null, error: parsed.error });
    }

    if (mode === "preview") {
      return NextResponse.json({ ...base, preview: await previewSignoff(round, parsed, signRole) });
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
      tab: read.selectedTab,
      parsed,
      grid: read.grid,
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

import { NextRequest, NextResponse } from "next/server";
import { isResponse, readJsonObject, requireTestCasesUser, toActor } from "@/lib/test-cases/api";
import { parseSheetUrl } from "@/lib/test-cases/sheet-url";
import { getSharedReaderInfo, removeSharedReader } from "@/lib/google/shared-reader";
import { hasDedicatedSheetsClient, pinnedSheetsReaderEmail } from "@/lib/google/oauth";
import { probeWithSharedAccount } from "@/lib/google/sheets";

const DENIED = "Only an admin can manage the shared Google account.";

/** Which Google account Flux reads Sheets with. Admins only. */
export async function GET() {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;
  if (!toActor(user).isAdmin) return NextResponse.json({ error: DENIED }, { status: 403 });
  return NextResponse.json({ reader: await getSharedReaderInfo(), dedicatedClient: hasDedicatedSheetsClient(), pinnedEmail: pinnedSheetsReaderEmail() });
}

/** { action: "test", url }: does this sheet open with the shared account alone? */
export async function POST(req: NextRequest) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;
  if (!toActor(user).isAdmin) return NextResponse.json({ error: DENIED }, { status: 403 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  if (parsed.body.action !== "test") return NextResponse.json({ error: "action must be test" }, { status: 400 });
  const url = typeof parsed.body.url === "string" ? parsed.body.url.trim() : "";
  const ref = url ? parseSheetUrl(url) : null;
  if (!ref) return NextResponse.json({ error: "Paste a Google Sheets link (docs.google.com/spreadsheets/d/…)." }, { status: 400 });
  const t0 = Date.now();
  const result = await probeWithSharedAccount(ref.spreadsheetId);
  return NextResponse.json({ ...result, ms: Date.now() - t0 });
}

/** Disconnects the shared account (Sheets then fall back to each person's own Google connection). */
export async function DELETE() {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;
  if (!toActor(user).isAdmin) return NextResponse.json({ error: DENIED }, { status: 403 });
  await removeSharedReader();
  return NextResponse.json({ ok: true });
}

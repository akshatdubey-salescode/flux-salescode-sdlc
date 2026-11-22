import { NextRequest } from "next/server";
import { loadExportModel } from "@/lib/movement/export";
import { respondExport } from "@/lib/movement/export/respond";
import { authActor, badIds, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

/**
 * GET ...?format=xlsx|text|html (default xlsx, case-insensitive). Same access as viewing the movement
 * (a signed-in user; the movement must belong to the delivery). Everything is built from the stored
 * movement: no Jira or GitHub call. `html` is the print page: the browser's Print -> Save as PDF makes
 * the PDF. The response is built in lib/movement/export/respond.ts (tested there).
 */
export async function GET(req: NextRequest, { params }: Params) {
  await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(() => respondExport(req.nextUrl.searchParams.get("format"), () => loadExportModel(id, mid), req.signal));
}

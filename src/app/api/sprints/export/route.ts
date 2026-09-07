import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { buildSprintWorkbook } from "@/lib/sprints/report";
import type { SprintWithItems } from "@/lib/sprints/entries";

// Same rows-in-body pattern (and visual theme) as the deliveries export —
// the client sends the sprints it's showing, already filtered. The workbook
// itself is built in lib/sprints/report.ts, shared with the stakeholder
// email route.

type ExportBody = { sprints: SprintWithItems[] };

export async function POST(req: NextRequest) {
  await requireAuth();

  let body: ExportBody;
  try {
    body = (await req.json()) as ExportBody;
  } catch {
    return new Response("Invalid body", { status: 400 });
  }

  const sprints = Array.isArray(body.sprints) ? body.sprints : [];
  const buffer = await buildSprintWorkbook(sprints);

  const generatedOn = new Date().toISOString().split("T")[0];
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sprint-report-${generatedOn}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

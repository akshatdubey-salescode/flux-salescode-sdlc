import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { guardReport } from "@/lib/support/route-guard";
import { buildYtdWorkbook, XLSX_CONTENT_TYPE, ytdAttachmentFilename } from "@/lib/support/ytd-workbook";

/** RFC 5987 value: encodeURIComponent leaves ' ( ) * ! unescaped. */
const rfc5987 = (s: string) =>
  encodeURIComponent(s).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

type Params = { params: Promise<{ id: string; reportId: string }> };

/**
 * The report's year-to-date Excel attachment, generated from the stored
 * snapshot (`data.ytdTickets`) exactly as the email would carry it, so it can
 * be reviewed before approval. Any signed-in user, like the preview.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  await requireAuth();
  const { id, reportId } = await params;
  const g = await guardReport(id, reportId);
  if ("res" in g) return g.res;
  const { data } = g.report;
  if (!data.ytdTickets) {
    return NextResponse.json(
      { error: "This report was built before attachments existed — rebuild it" },
      { status: 404 },
    );
  }
  const buffer = await buildYtdWorkbook(data.ytdTickets, {
    projectName: data.projectName,
    reportDate: data.reportDate,
    timeZone: data.timeZone,
  });
  const filename = ytdAttachmentFilename(data.projectName, data.reportDate);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename*=UTF-8''${rfc5987(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

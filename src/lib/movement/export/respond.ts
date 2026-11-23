/**
 * The HTTP side of the export, separated from the route so it can be tested without a session: the
 * route authenticates, validates the ids and passes a loader; this builds the response. Headers are
 * final before the first byte; the Excel body is streamed.
 */
import { NextResponse } from "next/server";
import { CONTENT_TYPE, exportFilename, parseFormat } from "./filename";
import { HTML_CSP, renderHtml } from "./html";
import type { ExportModel } from "./model";
import { renderTextExport } from "./text";
import { xlsxReadable } from "./xlsx";

export async function respondExport(formatParam: string | null, load: () => Promise<ExportModel>, signal?: AbortSignal): Promise<NextResponse> {
  const format = parseFormat(formatParam);
  if (!format) return NextResponse.json({ error: "format must be xlsx, text or html" }, { status: 400 });
  const model = await load();
  const filename = exportFilename(model.delivery.name, model.movement.environment, model.delivery.date, format);
  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPE[format],
    // the name is ASCII-only [A-Za-z0-9._-] (exportFilename), so it needs no escaping
    "Content-Disposition": `${format === "html" ? "inline" : "attachment"}; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (format === "xlsx") return new NextResponse(xlsxReadable(model, { signal }), { headers });
  if (format === "text") return new NextResponse(renderTextExport(model), { headers });
  return new NextResponse(renderHtml(model), { headers: { ...headers, "Content-Security-Policy": HTML_CSP, "Referrer-Policy": "no-referrer" } });
}

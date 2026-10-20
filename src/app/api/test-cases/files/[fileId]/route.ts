import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/validation";
import { getStore, XLSX_CONTENT_TYPE } from "@/lib/storage";
import { isResponse, requireTestCasesUser } from "@/lib/test-cases/api";
import { getFileForDownload } from "@/lib/test-cases/service";

/**
 * Authenticated download. With S3 this mints a short-lived presigned URL and
 * redirects to it (the file never passes through the server); the local dev
 * store streams the bytes instead.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;

  const { fileId } = await ctx.params;
  if (!isValidUuid(fileId)) return NextResponse.json({ error: "Invalid file id" }, { status: 400 });

  const file = await getFileForDownload(fileId);
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  try {
    const dl = await getStore().download(file.storageKey, file.fileName);
    if (dl.kind === "redirect") return NextResponse.redirect(dl.url, 302);
    const safeName = file.fileName.replace(/[^A-Za-z0-9._-]+/g, "_");
    return new NextResponse(new Uint8Array(dl.body), {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[test-cases] download failed:", err);
    return NextResponse.json({ error: "Could not fetch the file." }, { status: 502 });
  }
}

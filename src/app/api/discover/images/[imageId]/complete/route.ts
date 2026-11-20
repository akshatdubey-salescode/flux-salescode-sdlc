import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { showcaseImages } from "@/lib/db/schema";
import { isValidUuid } from "@/lib/validation";
import { getImageStore } from "@/lib/discover/storage";

/**
 * Step 2 of an upload: the browser reports its upload finished (with the
 * ImageKit fileId it got back), and the server checks what actually landed in
 * storage instead of trusting the browser. A bad file is deleted with its row.
 * Body: { fileId?: string }.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ imageId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { imageId } = await ctx.params;
  if (!isValidUuid(imageId)) return NextResponse.json({ error: "Invalid image id" }, { status: 400 });
  const input = (await req.json().catch(() => null)) as { fileId?: unknown } | null;
  const fileId = typeof input?.fileId === "string" ? input.fileId : null;

  const [img] = await db.select().from(showcaseImages).where(eq(showcaseImages.id, imageId)).limit(1);
  if (!img || img.uploaderId !== user.id) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  if (img.uploadedAt) return NextResponse.json({ ok: true });

  try {
    const result = await getImageStore().verify(img, fileId);
    if (!result.ok) {
      await db.delete(showcaseImages).where(eq(showcaseImages.id, img.id));
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    await db
      .update(showcaseImages)
      .set({ uploadedAt: new Date(), sizeBytes: result.size, providerFileId: result.providerFileId })
      .where(eq(showcaseImages.id, img.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[discover] upload verification failed:", err);
    return NextResponse.json({ error: "Could not verify the upload." }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { showcaseImages } from "@/lib/db/schema";
import { isValidUuid } from "@/lib/validation";
import { getImageStore, VIEW_TTL_SECONDS } from "@/lib/discover/storage";

/**
 * Stable image URL used inside showcase markdown (ADR-0003). Signed-in users
 * only. Redirects to a short-lived signed ImageKit URL, so the bytes come from
 * ImageKit's CDN; the local dev store streams them instead.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ imageId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { imageId } = await ctx.params;
  if (!isValidUuid(imageId)) return NextResponse.json({ error: "Invalid image id" }, { status: 400 });

  const [img] = await db.select().from(showcaseImages).where(eq(showcaseImages.id, imageId)).limit(1);
  if (!img || !img.uploadedAt) return NextResponse.json({ error: "Image not found" }, { status: 404 });

  try {
    const store = getImageStore();
    const url = store.viewUrl(img);
    if (url) {
      const res = NextResponse.redirect(url, 302);
      // Cache the redirect for well under the signed URL's lifetime.
      res.headers.set("Cache-Control", `private, max-age=${Math.floor(VIEW_TTL_SECONDS / 2)}`);
      return res;
    }
    const body = await store.read(img.storageKey);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": img.contentType,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[discover] image fetch failed:", err);
    return NextResponse.json({ error: "Could not fetch the image." }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { showcaseImages } from "@/lib/db/schema";
import { isValidUuid } from "@/lib/validation";
import { IMAGE_MAX_BYTES } from "@/lib/discover/core";
import { getImageStore } from "@/lib/discover/storage";

/**
 * Dev-only upload target, used when R2 is not configured (the local store hands
 * out this URL instead of a presigned R2 URL). With R2 configured it is 404.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ imageId: string }> }) {
  const store = getImageStore();
  if (store.kind !== "local") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { imageId } = await ctx.params;
  if (!isValidUuid(imageId)) return NextResponse.json({ error: "Invalid image id" }, { status: 400 });

  const [img] = await db
    .select({ storageKey: showcaseImages.storageKey, uploaderId: showcaseImages.uploaderId, uploadedAt: showcaseImages.uploadedAt })
    .from(showcaseImages)
    .where(eq(showcaseImages.id, imageId))
    .limit(1);
  if (!img || img.uploaderId !== user.id || img.uploadedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > IMAGE_MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  await store.write(img.storageKey, body);
  return new NextResponse(null, { status: 200 });
}

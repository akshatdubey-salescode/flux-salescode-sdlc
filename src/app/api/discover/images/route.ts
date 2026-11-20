import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { showcaseImages, showcases } from "@/lib/db/schema";
import { isValidUuid } from "@/lib/validation";
import { IMAGE_MAX_BYTES, imageExtension, imageUrl, isAllowedImageType } from "@/lib/discover/core";
import { getImageStore, ImageStorageNotConfiguredError } from "@/lib/discover/storage";

/**
 * Step 1 of an upload (ADR-0004): registers the image and returns where the
 * browser sends the bytes (ImageKit's upload API with signed auth params, or
 * the local dev route). Only the showcase's author can add images.
 * Body: { showcaseId, contentType, size }.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const input = (await req.json().catch(() => null)) as
    | { showcaseId?: unknown; contentType?: unknown; size?: unknown }
    | null;
  const showcaseId = input?.showcaseId;
  const contentType = input?.contentType;
  const size = input?.size;

  if (!isValidUuid(showcaseId)) return NextResponse.json({ error: "Invalid showcase" }, { status: 400 });
  if (typeof contentType !== "string" || !isAllowedImageType(contentType)) {
    return NextResponse.json({ error: "Only PNG, JPEG, WebP or GIF images are allowed." }, { status: 415 });
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return NextResponse.json({ error: "Invalid file size" }, { status: 400 });
  }
  if (size > IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "Images must be 5 MB or smaller." }, { status: 413 });
  }

  const [showcase] = await db
    .select({ authorId: showcases.authorId })
    .from(showcases)
    .where(eq(showcases.id, showcaseId))
    .limit(1);
  if (!showcase) return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
  if (showcase.authorId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const store = getImageStore();
    const [row] = await db
      .insert(showcaseImages)
      .values({ showcaseId, uploaderId: user.id, storageKey: "pending", contentType, sizeBytes: size })
      .returning({ id: showcaseImages.id });
    const storageKey = `/discover/${showcaseId}/${row.id}.${imageExtension(contentType)}`;
    await db.update(showcaseImages).set({ storageKey }).where(eq(showcaseImages.id, row.id));
    const upload = store.uploadTarget({ id: row.id, storageKey, contentType, providerFileId: null });
    return NextResponse.json({ id: row.id, upload, url: imageUrl(row.id) });
  } catch (err) {
    if (err instanceof ImageStorageNotConfiguredError) {
      return NextResponse.json({ error: "Image uploads are not configured yet." }, { status: 503 });
    }
    console.error("[discover] upload start failed:", err);
    return NextResponse.json({ error: "Could not start the upload." }, { status: 502 });
  }
}

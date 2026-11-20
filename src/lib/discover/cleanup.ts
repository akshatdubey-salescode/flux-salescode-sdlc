// Nightly removal of orphan Showcase Images (ADR-0004). Runs inside the
// existing /api/cron/scheduled-processes job and never throws.

import { deleteImageRows, findOrphanImages } from "./service";
import { getImageStore } from "./storage";
import { db } from "@/lib/db";
import { showcaseImages } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export type ImageCleanupStats = { deleted: number; failed: number; error?: string };

export async function cleanupOrphanImages(now = new Date()): Promise<ImageCleanupStats> {
  const stats: ImageCleanupStats = { deleted: 0, failed: 0 };
  try {
    const orphans = await findOrphanImages(now);
    if (!orphans.length) return stats;
    const rows = await db
      .select({ id: showcaseImages.id, storageKey: showcaseImages.storageKey, providerFileId: showcaseImages.providerFileId })
      .from(showcaseImages)
      .where(inArray(showcaseImages.id, orphans.map((o) => o.id)));

    const store = getImageStore();
    const done: string[] = [];
    for (const r of rows) {
      try {
        await store.delete(r);
        done.push(r.id);
      } catch (err) {
        stats.failed++;
        console.error("[discover] orphan image delete failed:", r.id, err);
      }
    }
    await deleteImageRows(done);
    stats.deleted = done.length;
  } catch (err) {
    stats.error = err instanceof Error ? err.message : String(err);
    console.error("[discover] orphan image cleanup failed:", err);
  }
  return stats;
}

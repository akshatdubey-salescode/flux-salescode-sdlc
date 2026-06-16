import { cacheLife, cacheTag } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { releaseNotes } from "@/lib/db/schema";
import { RELEASE_NOTES_TAG } from "./cache-tags";

/**
 * A release note as exposed to every signed-in user via the bell. Dates are
 * serialised to ISO strings so the shape survives the JSON API boundary.
 */
export type PublicReleaseNote = {
  id: string;
  title: string;
  body: string;
  type: "INFO" | "ALERT";
  linkLabel: string | null;
  linkHref: string | null;
  publishedAt: string | null;
};

/**
 * Published notes, newest first. Cached and tagged so the read path is cheap;
 * mutations bust {@link RELEASE_NOTES_TAG}.
 */
export async function getPublishedReleaseNotes(): Promise<PublicReleaseNote[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(RELEASE_NOTES_TAG);

  const rows = await db
    .select({
      id: releaseNotes.id,
      title: releaseNotes.title,
      body: releaseNotes.body,
      type: releaseNotes.type,
      linkLabel: releaseNotes.linkLabel,
      linkHref: releaseNotes.linkHref,
      publishedAt: releaseNotes.publishedAt,
    })
    .from(releaseNotes)
    .where(eq(releaseNotes.isPublished, true))
    .orderBy(desc(releaseNotes.publishedAt), desc(releaseNotes.createdAt));

  return rows.map((r) => ({
    ...r,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
  }));
}

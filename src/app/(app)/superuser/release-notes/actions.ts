"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { releaseNotes } from "@/lib/db/schema";
import { RELEASE_NOTES_TAG } from "@/lib/release-notes/cache-tags";

const RELEASE_NOTES_PATH = "/superuser/release-notes";

export type ReleaseNoteInput = {
  title: string;
  body: string;
  type: "INFO" | "ALERT";
  linkLabel: string;
  linkHref: string;
  isPublished: boolean;
};

type Result = { error?: string };

function clean(input: ReleaseNoteInput) {
  const title = input.title.trim();
  const body = input.body.trim();
  const linkLabel = input.linkLabel.trim();
  const linkHref = input.linkHref.trim();
  const type: "INFO" | "ALERT" = input.type === "ALERT" ? "ALERT" : "INFO";

  if (!title) return { error: "Title is required." as const };
  if (!body) return { error: "Body is required." as const };
  if (linkHref && !/^(\/|https?:\/\/)/.test(linkHref)) {
    return {
      error:
        "Link must be a relative path (e.g. /settings) or a full URL." as const,
    };
  }
  // A label without a target (or vice-versa) renders a dead link.
  if (Boolean(linkLabel) !== Boolean(linkHref)) {
    return { error: "Provide both a link label and a link, or neither." as const };
  }

  return {
    values: {
      title,
      body,
      type,
      linkLabel: linkLabel || null,
      linkHref: linkHref || null,
      isPublished: input.isPublished,
    },
  };
}

function bust() {
  revalidateTag(RELEASE_NOTES_TAG, "max");
  revalidatePath(RELEASE_NOTES_PATH);
}

export async function createReleaseNote(input: ReleaseNoteInput): Promise<Result> {
  const user = await requireRole("SUPERUSER");
  const parsed = clean(input);
  if ("error" in parsed) return { error: parsed.error };

  await db.insert(releaseNotes).values({
    ...parsed.values,
    createdBy: user.id,
    publishedAt: parsed.values.isPublished ? new Date() : null,
  });

  bust();
  return {};
}

export async function updateReleaseNote(
  id: string,
  input: ReleaseNoteInput
): Promise<Result> {
  await requireRole("SUPERUSER");
  const parsed = clean(input);
  if ("error" in parsed) return { error: parsed.error };

  const [existing] = await db
    .select({ isPublished: releaseNotes.isPublished, publishedAt: releaseNotes.publishedAt })
    .from(releaseNotes)
    .where(eq(releaseNotes.id, id))
    .limit(1);
  if (!existing) return { error: "Note not found." };

  // Stamp publishedAt the first time a note goes live; preserve it thereafter.
  const publishedAt = parsed.values.isPublished
    ? existing.publishedAt ?? new Date()
    : null;

  await db
    .update(releaseNotes)
    .set({ ...parsed.values, publishedAt, updatedAt: new Date() })
    .where(eq(releaseNotes.id, id));

  bust();
  return {};
}

export async function setReleaseNotePublished(
  id: string,
  isPublished: boolean
): Promise<void> {
  await requireRole("SUPERUSER");
  await db
    .update(releaseNotes)
    .set({
      isPublished,
      publishedAt: isPublished ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(releaseNotes.id, id));
  bust();
}

export async function deleteReleaseNote(id: string): Promise<void> {
  await requireRole("SUPERUSER");
  await db.delete(releaseNotes).where(eq(releaseNotes.id, id));
  bust();
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { showcaseComments, showcaseImages, showcases, showcaseUpvotes } from "@/lib/db/schema";
import { isValidUuid } from "@/lib/validation";
import {
  canPublish,
  cleanUrl,
  COMMENT_MAX,
  commentRecipients,
  generateShortId,
  normalizeTags,
  showcasePath,
  slugify,
  TAGLINE_MAX,
  TAKEDOWN_REASON_MAX,
  TITLE_MAX,
} from "@/lib/discover/core";
import { DISCOVER_PATH, displayNames, isDiscoverAdmin } from "@/lib/discover/service";
import { buildCommentEmail, buildTakedownEmail, sendEmail } from "@/lib/discover/notify";

type Result = { error?: string };

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

function bust() {
  revalidatePath(DISCOVER_PATH, "layout");
}

async function loadShowcase(id: string) {
  if (!isValidUuid(id)) return null;
  const [s] = await db.select().from(showcases).where(eq(showcases.id, id)).limit(1);
  return s ?? null;
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

/**
 * Creates a draft once the author has named their tool (so uploads have a
 * showcase to attach to) and opens the editor. An empty name creates nothing.
 */
export async function createShowcase(_prev: Result, formData: FormData): Promise<Result> {
  const user = await requireAuth();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give your tool a name to continue." };
  if (title.length > TITLE_MAX) return { error: `Name must be ${TITLE_MAX} characters or fewer.` };

  const slug = slugify(title);
  let shortId = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateShortId();
    const inserted = await db
      .insert(showcases)
      .values({ shortId: candidate, slug, title, authorId: user.id })
      .onConflictDoNothing({ target: showcases.shortId })
      .returning({ shortId: showcases.shortId });
    if (inserted.length) {
      shortId = inserted[0].shortId;
      break;
    }
  }
  if (!shortId) return { error: "Could not create the showcase. Please try again." };
  redirect(`${showcasePath({ slug, shortId })}/edit`);
}

export type ShowcaseInput = {
  title: string;
  tagline: string;
  body: string;
  coverImageId: string | null;
  repoUrl: string;
  liveUrl: string;
  demoVideoUrl: string;
  tags: string[];
};

export type SaveResult = Result & { path?: string; updatedAt?: string };

/**
 * Saves the author's edits. Drafts accept incomplete content (autosave);
 * a published showcase must stay publishable.
 */
export async function saveShowcase(id: string, input: ShowcaseInput): Promise<SaveResult> {
  const user = await requireAuth();
  const s = await loadShowcase(id);
  if (!s || s.authorId !== user.id) return { error: "Showcase not found." };

  const title = input.title.trim().slice(0, TITLE_MAX);
  const tagline = input.tagline.trim();
  if (tagline.length > TAGLINE_MAX) return { error: `Tagline must be ${TAGLINE_MAX} characters or fewer.` };
  const body = input.body;

  let repoUrl: string | null, liveUrl: string | null, demoVideoUrl: string | null;
  try {
    repoUrl = cleanUrl(input.repoUrl, "Repository URL");
    liveUrl = cleanUrl(input.liveUrl, "App URL");
    demoVideoUrl = cleanUrl(input.demoVideoUrl, "Demo video URL");
  } catch (e) {
    return { error: (e as Error).message };
  }

  let coverImageId: string | null = null;
  if (input.coverImageId) {
    if (!isValidUuid(input.coverImageId)) return { error: "Invalid cover image." };
    const [img] = await db
      .select({ id: showcaseImages.id })
      .from(showcaseImages)
      .where(
        and(
          eq(showcaseImages.id, input.coverImageId),
          eq(showcaseImages.showcaseId, id),
          isNotNull(showcaseImages.uploadedAt),
        ),
      )
      .limit(1);
    if (!img) return { error: "Cover image not found. Please upload it again." };
    coverImageId = img.id;
  }

  if (s.status === "published") {
    const check = canPublish({ title, tagline, body });
    if (!check.ok) return { error: `${check.error} (Unpublish first to save an incomplete version.)` };
  }

  const slug = slugify(title);
  const updatedAt = new Date();
  await db
    .update(showcases)
    .set({
      title,
      tagline,
      body,
      coverImageId,
      repoUrl,
      liveUrl,
      demoVideoUrl,
      tags: normalizeTags(input.tags),
      slug,
      updatedAt,
    })
    .where(eq(showcases.id, id));

  // Draft autosaves only affect the author's own editor; skip the re-render.
  if (s.status === "published") bust();
  return { path: showcasePath({ slug, shortId: s.shortId }), updatedAt: updatedAt.toISOString() };
}

export async function publishShowcase(id: string): Promise<Result & { path?: string }> {
  const user = await requireAuth();
  const s = await loadShowcase(id);
  if (!s || s.authorId !== user.id) return { error: "Showcase not found." };
  const check = canPublish(s);
  if (!check.ok) return { error: check.error };

  await db
    .update(showcases)
    .set({
      status: "published",
      publishedAt: s.publishedAt ?? new Date(),
      takenDownReason: null,
      takenDownBy: null,
      takenDownAt: null,
    })
    .where(eq(showcases.id, id));
  bust();
  return { path: showcasePath(s) };
}

export async function unpublishShowcase(id: string): Promise<Result> {
  const user = await requireAuth();
  const s = await loadShowcase(id);
  if (!s || s.authorId !== user.id) return { error: "Showcase not found." };
  await db.update(showcases).set({ status: "draft" }).where(eq(showcases.id, id));
  bust();
  return {};
}

/** Author or admin. Images are detached (SET NULL) and removed by the nightly cleanup. */
export async function deleteShowcase(id: string): Promise<Result> {
  const user = await requireAuth();
  const s = await loadShowcase(id);
  if (!s || (s.authorId !== user.id && !isDiscoverAdmin(user))) return { error: "Showcase not found." };
  await db.delete(showcases).where(eq(showcases.id, id));
  bust();
  return {};
}

/** Admin take-down: back to draft with a reason, and the author is emailed (ADR-0002). */
export async function takeDownShowcase(id: string, reason: string): Promise<Result> {
  const user = await requireAuth();
  if (!isDiscoverAdmin(user)) return { error: "Only admins can take down a showcase." };
  const s = await loadShowcase(id);
  if (!s) return { error: "Showcase not found." };
  const why = reason.trim();
  if (!why) return { error: "Give a reason, it is sent to the author." };
  if (why.length > TAKEDOWN_REASON_MAX) return { error: `Keep the reason under ${TAKEDOWN_REASON_MAX} characters.` };

  await db
    .update(showcases)
    .set({ status: "draft", takenDownReason: why, takenDownBy: user.id, takenDownAt: new Date() })
    .where(eq(showcases.id, id));
  bust();

  if (s.authorId !== user.id) {
    const url = `${appUrl()}${showcasePath(s)}`;
    after(async () => {
      const res = await sendEmail([s.authorId], buildTakedownEmail({ showcaseTitle: s.title || "Untitled", reason: why, url }));
      if (!res.ok) console.error("[discover] take-down email failed:", res.error);
    });
  }
  return {};
}

// ---------------------------------------------------------------------------
// Upvotes
// ---------------------------------------------------------------------------

export async function toggleUpvote(id: string): Promise<Result & { upvoted?: boolean; count?: number }> {
  const user = await requireAuth();
  const s = await loadShowcase(id);
  if (!s || s.status !== "published") return { error: "Showcase not found." };

  const removed = await db
    .delete(showcaseUpvotes)
    .where(and(eq(showcaseUpvotes.showcaseId, id), eq(showcaseUpvotes.userId, user.id)))
    .returning({ userId: showcaseUpvotes.userId });
  if (!removed.length) {
    await db.insert(showcaseUpvotes).values({ showcaseId: id, userId: user.id }).onConflictDoNothing();
  }
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(showcaseUpvotes)
    .where(eq(showcaseUpvotes.showcaseId, id));
  bust();
  return { upvoted: !removed.length, count };
}

// ---------------------------------------------------------------------------
// Comments (one level of replies)
// ---------------------------------------------------------------------------

function cleanComment(body: string): { body: string } | { error: string } {
  const b = body.trim();
  if (!b) return { error: "Write something first." };
  if (b.length > COMMENT_MAX) return { error: `Comments are limited to ${COMMENT_MAX} characters.` };
  return { body: b };
}

export async function addComment(showcaseId: string, body: string, parentId: string | null): Promise<Result> {
  const user = await requireAuth();
  const s = await loadShowcase(showcaseId);
  if (!s || s.status !== "published") return { error: "Showcase not found." };
  const cleaned = cleanComment(body);
  if ("error" in cleaned) return cleaned;

  let parentAuthorId: string | null = null;
  if (parentId) {
    if (!isValidUuid(parentId)) return { error: "Comment not found." };
    const [parent] = await db.select().from(showcaseComments).where(eq(showcaseComments.id, parentId)).limit(1);
    if (!parent || parent.showcaseId !== showcaseId) return { error: "Comment not found." };
    if (parent.parentId) return { error: "Replies can't be replied to. Reply to the original comment instead." };
    parentAuthorId = parent.authorId;
  }

  await db.insert(showcaseComments).values({ showcaseId, parentId, authorId: user.id, body: cleaned.body });
  bust();

  const recipients = commentRecipients({ actorId: user.id, showcaseAuthorId: s.authorId, parentAuthorId });
  if (recipients.length) {
    const url = `${appUrl()}${showcasePath(s)}#comments`;
    after(async () => {
      const names = await displayNames([user.id]);
      const actorName = names.get(user.id) ?? user.email;
      for (const to of recipients) {
        const res = await sendEmail(
          [to],
          buildCommentEmail({
            actorName,
            showcaseTitle: s.title || "Untitled",
            commentBody: cleaned.body,
            isReply: Boolean(parentId),
            recipientIsParentAuthor: to === parentAuthorId?.toLowerCase(),
            url,
          }),
        );
        if (!res.ok) console.error("[discover] comment email failed:", res.error);
      }
    });
  }
  return {};
}

export async function editComment(id: string, body: string): Promise<Result> {
  const user = await requireAuth();
  if (!isValidUuid(id)) return { error: "Comment not found." };
  const cleaned = cleanComment(body);
  if ("error" in cleaned) return cleaned;
  const updated = await db
    .update(showcaseComments)
    .set({ body: cleaned.body, editedAt: new Date() })
    .where(and(eq(showcaseComments.id, id), eq(showcaseComments.authorId, user.id)))
    .returning({ id: showcaseComments.id });
  if (!updated.length) return { error: "Comment not found." };
  bust();
  return {};
}

/** Author or admin. Deleting a top-level comment deletes its replies. */
export async function deleteComment(id: string): Promise<Result> {
  const user = await requireAuth();
  if (!isValidUuid(id)) return { error: "Comment not found." };
  const [c] = await db.select().from(showcaseComments).where(eq(showcaseComments.id, id)).limit(1);
  if (!c || (c.authorId !== user.id && !isDiscoverAdmin(user))) return { error: "Comment not found." };
  await db.delete(showcaseComments).where(eq(showcaseComments.id, id));
  bust();
  return {};
}

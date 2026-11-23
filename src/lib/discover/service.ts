// Server-side reads and permission checks for Discover (Tool Showcases).

import { and, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { showcaseComments, showcaseImages, showcases } from "@/lib/db/schema";
import type { AuthUser } from "@/lib/auth/server";
import { hasMinRole } from "@/lib/auth/types";
import { nameFromEmail } from "./core";

export const DISCOVER_PATH = "/discover";

export function isDiscoverAdmin(user: Pick<AuthUser, "role">): boolean {
  return hasMinRole(user.role, "ADMIN");
}

/** Keka display name for an email, falling back to a prettified local part. */
const nameSql = (emailCol: SQL | typeof showcases.authorId | typeof showcaseComments.authorId) =>
  sql<string | null>`(select k.display_name from keka_employees k where k.email = ${emailCol} and k.display_name is not null order by k.employment_status nulls last limit 1)`;

export function displayName(email: string, kekaName: string | null | undefined): string {
  return kekaName?.trim() || nameFromEmail(email);
}

export async function displayNames(emails: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(emails.map((e) => e.toLowerCase()))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const rows = await db.execute<{ email: string; display_name: string | null }>(sql`
    select u.id as email,
      (select k.display_name from keka_employees k where k.email = u.id and k.display_name is not null
        order by k.employment_status nulls last limit 1) as display_name
    from users u where u.id in (${sql.join(unique.map((e) => sql`${e}`), sql`, `)})`);
  for (const r of rows.rows) out.set(r.email, displayName(r.email, r.display_name));
  for (const e of unique) if (!out.has(e)) out.set(e, nameFromEmail(e));
  return out;
}

const upvoteCountSql = sql<number>`(select count(*)::int from showcase_upvotes v where v.showcase_id = ${showcases.id})`;
const commentCountSql = sql<number>`(select count(*)::int from showcase_comments c where c.showcase_id = ${showcases.id})`;
const viewerUpvotedSql = (viewerId: string) =>
  sql<boolean>`exists(select 1 from showcase_upvotes v where v.showcase_id = ${showcases.id} and v.user_id = ${viewerId})`;

const cardColumns = (viewerId: string) => ({
  id: showcases.id,
  shortId: showcases.shortId,
  slug: showcases.slug,
  title: showcases.title,
  tagline: showcases.tagline,
  coverImageId: showcases.coverImageId,
  tags: showcases.tags,
  status: showcases.status,
  takenDownReason: showcases.takenDownReason,
  authorId: showcases.authorId,
  authorKekaName: nameSql(showcases.authorId),
  publishedAt: showcases.publishedAt,
  updatedAt: showcases.updatedAt,
  createdAt: showcases.createdAt,
  upvoteCount: upvoteCountSql,
  commentCount: commentCountSql,
  viewerUpvoted: viewerUpvotedSql(viewerId),
});

export type ShowcaseCard = {
  id: string;
  shortId: string;
  slug: string;
  title: string;
  tagline: string;
  coverImageId: string | null;
  tags: string[];
  status: "draft" | "published";
  takenDownReason: string | null;
  authorId: string;
  authorName: string;
  publishedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  upvoteCount: number;
  commentCount: number;
  viewerUpvoted: boolean;
};

function toCard(r: Omit<ShowcaseCard, "authorName"> & { authorKekaName: string | null }): ShowcaseCard {
  const { authorKekaName, ...rest } = r;
  return { ...rest, authorName: displayName(r.authorId, authorKekaName) };
}

export type FeedSort = "newest" | "popular";

export async function listPublishedShowcases(opts: {
  viewerId: string;
  q?: string;
  tag?: string;
  sort?: FeedSort;
  limit?: number;
}): Promise<ShowcaseCard[]> {
  const conditions: SQL[] = [eq(showcases.status, "published")];
  const q = opts.q?.trim();
  if (q) {
    conditions.push(
      or(
        sql`${showcases.searchVector} @@ websearch_to_tsquery('english', ${q})`,
        sql`${showcases.title} ilike ${`%${q.replace(/[%_\\]/g, "\\$&")}%`}`,
      )!,
    );
  }
  if (opts.tag) conditions.push(sql`${showcases.tags} @> array[${opts.tag}]::text[]`);

  const order: SQL[] = [];
  if (q) order.push(sql`ts_rank(${showcases.searchVector}, websearch_to_tsquery('english', ${q})) desc`);
  if (opts.sort === "popular") order.push(sql`${upvoteCountSql} desc`);
  order.push(desc(showcases.publishedAt), desc(showcases.createdAt));

  const rows = await db
    .select(cardColumns(opts.viewerId))
    .from(showcases)
    .where(and(...conditions))
    .orderBy(...order)
    .limit(opts.limit ?? 120);
  return rows.map(toCard);
}

export async function listMyShowcases(userId: string): Promise<ShowcaseCard[]> {
  const rows = await db
    .select(cardColumns(userId))
    .from(showcases)
    .where(eq(showcases.authorId, userId))
    .orderBy(desc(showcases.updatedAt));
  return rows.map(toCard);
}

/** Tags in use on published showcases, most-used first. */
export async function listTags(limit = 200): Promise<{ tag: string; count: number }[]> {
  const res = await db.execute<{ tag: string; count: number }>(sql`
    select t.tag, count(*)::int as count
    from showcases s, unnest(s.tags) as t(tag)
    where s.status = 'published'
    group by t.tag
    order by count desc, t.tag asc
    limit ${limit}`);
  return res.rows;
}

export type ShowcaseDetail = ShowcaseCard & {
  body: string;
  repoUrl: string | null;
  liveUrl: string | null;
  demoVideoUrl: string | null;
};

export async function getShowcaseByShortId(shortId: string, viewerId: string): Promise<ShowcaseDetail | null> {
  const [r] = await db
    .select({
      ...cardColumns(viewerId),
      body: showcases.body,
      repoUrl: showcases.repoUrl,
      liveUrl: showcases.liveUrl,
      demoVideoUrl: showcases.demoVideoUrl,
    })
    .from(showcases)
    .where(eq(showcases.shortId, shortId))
    .limit(1);
  if (!r) return null;
  const { body, repoUrl, liveUrl, demoVideoUrl, ...card } = r;
  return { ...toCard(card), body, repoUrl, liveUrl, demoVideoUrl };
}

/** Drafts (including taken-down ones) are visible to their author and admins only. */
export function canView(user: AuthUser, s: { status: string; authorId: string }): boolean {
  return s.status === "published" || s.authorId === user.id || isDiscoverAdmin(user);
}

export function canEdit(user: AuthUser, s: { authorId: string }): boolean {
  return s.authorId === user.id;
}

export type CommentView = {
  id: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  replies: CommentView[];
};

export async function listComments(showcaseId: string): Promise<CommentView[]> {
  const rows = await db
    .select({
      id: showcaseComments.id,
      parentId: showcaseComments.parentId,
      authorId: showcaseComments.authorId,
      authorKekaName: nameSql(showcaseComments.authorId),
      body: showcaseComments.body,
      createdAt: showcaseComments.createdAt,
      editedAt: showcaseComments.editedAt,
    })
    .from(showcaseComments)
    .where(eq(showcaseComments.showcaseId, showcaseId))
    .orderBy(showcaseComments.createdAt);

  const top: CommentView[] = [];
  const byId = new Map<string, CommentView>();
  for (const r of rows) {
    const { authorKekaName, ...rest } = r;
    const view: CommentView = { ...rest, authorName: displayName(r.authorId, authorKekaName), replies: [] };
    byId.set(r.id, view);
  }
  for (const c of byId.values()) {
    if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId)!.replies.push(c);
    else if (!c.parentId) top.push(c);
  }
  return top;
}

// ---------------------------------------------------------------------------
// Orphan image cleanup (ADR-0004)
// ---------------------------------------------------------------------------

export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Picks image rows older than the grace period that nothing references any more:
 * never finished uploading, detached from a deleted showcase, or no longer in
 * their showcase's body or cover.
 */
export async function findOrphanImages(now: Date, limit = 500): Promise<{ id: string }[]> {
  const cutoff = new Date(now.getTime() - ORPHAN_GRACE_MS);
  // The "still referenced" test runs in SQL, so old referenced images never
  // crowd orphans out of the batch. Bodies reference images by their id.
  return db
    .select({ id: showcaseImages.id })
    .from(showcaseImages)
    .leftJoin(showcases, eq(showcases.id, showcaseImages.showcaseId))
    .where(
      and(
        lt(showcaseImages.createdAt, cutoff),
        sql`(${showcaseImages.uploadedAt} is null
          or ${showcaseImages.showcaseId} is null
          or ${showcases.id} is null
          or (${showcases.coverImageId} is distinct from ${showcaseImages.id}
              and strpos(lower(${showcases.body}), ${showcaseImages.id}::text) = 0))`,
      ),
    )
    .orderBy(showcaseImages.createdAt)
    .limit(limit);
}

export async function deleteImageRows(ids: string[]): Promise<void> {
  if (ids.length) await db.delete(showcaseImages).where(inArray(showcaseImages.id, ids));
}

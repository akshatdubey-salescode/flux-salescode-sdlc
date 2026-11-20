// Pure helpers for Discover (Tool Showcases). No server imports, so client
// components and tests can share them. Design: docs/discover/CONTEXT.md.

export const TAGLINE_MAX = 120;
export const TITLE_MAX = 120;
export const TAGS_MAX = 8;
export const TAG_MAX_LEN = 32;
export const COMMENT_MAX = 5000;
export const TAKEDOWN_REASON_MAX = 500;

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Raster formats only. SVG is never allowed (it can carry script). */
export const IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export function isAllowedImageType(t: string): t is ImageContentType {
  return (IMAGE_CONTENT_TYPES as readonly string[]).includes(t);
}

// ---------------------------------------------------------------------------
// URLs: /discover/<slug>-<shortId>
// ---------------------------------------------------------------------------

const SHORT_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l
export const SHORT_ID_LEN = 6;

export function generateShortId(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < SHORT_ID_LEN; i++) {
    out += SHORT_ID_ALPHABET[Math.floor(random() * SHORT_ID_ALPHABET.length)];
  }
  return out;
}

export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

export function showcasePath(s: { slug: string; shortId: string }): string {
  return `/discover/${s.slug}-${s.shortId}`;
}

/**
 * Pulls the authoritative short id off the end of a URL segment. The slug part
 * is ignored (it may be stale after a rename). A bare short id also works.
 */
export function parseShowcaseParam(param: string): { shortId: string; slug: string } | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(param).toLowerCase();
  } catch {
    return null;
  }
  const re = new RegExp(`^(?:(.+)-)?([${SHORT_ID_ALPHABET}]{${SHORT_ID_LEN}})$`);
  const m = decoded.match(re);
  if (!m) return null;
  return { slug: m[1] ?? "", shortId: m[2] };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** "AI Agent" → "ai-agent". Empty string when nothing usable remains. */
export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9+.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TAG_MAX_LEN)
    .replace(/-+$/g, "");
}

/** Normalises, de-duplicates (order-preserving) and caps the tag list. */
export function normalizeTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const t = normalizeTag(r);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= TAGS_MAX) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Links & demo video
// ---------------------------------------------------------------------------

/** Returns the trimmed URL if it is http(s), null if empty, or throws a user-facing message. */
export function cleanUrl(raw: string | null | undefined, label: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`${label} must be a full URL (https://…).`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`${label} must start with http:// or https://.`);
  }
  return u.toString();
}

export type VideoEmbed = { provider: "youtube" | "loom" | "gdrive"; src: string };

/**
 * Allow-listed embeds. The iframe src is rebuilt from a parsed id, never taken
 * from the user's URL, so nothing else can be framed.
 */
export function videoEmbed(url: string | null | undefined): VideoEmbed | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const ID = /^[A-Za-z0-9_-]+$/;

  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);
      id = m?.[1] ?? null;
    }
    return id && ID.test(id) ? { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${id}` } : null;
  }

  if (host === "loom.com") {
    const m = u.pathname.match(/^\/(?:share|embed)\/([^/]+)/);
    const id = m?.[1];
    return id && ID.test(id) ? { provider: "loom", src: `https://www.loom.com/embed/${id}` } : null;
  }

  if (host === "drive.google.com") {
    const m = u.pathname.match(/^\/file\/d\/([^/]+)/);
    const id = m?.[1] ?? u.searchParams.get("id");
    return id && ID.test(id) ? { provider: "gdrive", src: `https://drive.google.com/file/d/${id}/preview` } : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export function imageUrl(id: string): string {
  return `/api/discover/images/${id}`;
}

export function imageExtension(t: ImageContentType): string {
  return { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[t];
}

// ---------------------------------------------------------------------------
// Comment notifications
// ---------------------------------------------------------------------------

/**
 * Who gets emailed about a new comment: the showcase author, plus the parent
 * comment's author for a reply. Never the actor; each person at most once.
 */
export function commentRecipients(a: {
  actorId: string;
  showcaseAuthorId: string;
  parentAuthorId?: string | null;
}): string[] {
  const out = new Set<string>();
  for (const id of [a.showcaseAuthorId, a.parentAuthorId]) {
    if (id && id.toLowerCase() !== a.actorId.toLowerCase()) out.add(id.toLowerCase());
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** "akshat.dubey@salescode.ai" → "Akshat Dubey". Fallback when no Keka name. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

export type PublishCheck = { ok: true } | { ok: false; error: string };

/** Required to publish: title, tagline (≤120), body. Drafts can be incomplete. */
export function canPublish(s: { title: string; tagline: string; body: string }): PublishCheck {
  if (!s.title.trim()) return { ok: false, error: "Add a title before publishing." };
  if (!s.tagline.trim()) return { ok: false, error: "Add a tagline before publishing." };
  if (s.tagline.trim().length > TAGLINE_MAX) {
    return { ok: false, error: `Tagline must be ${TAGLINE_MAX} characters or fewer.` };
  }
  if (!s.body.trim()) return { ok: false, error: "Write something in the body before publishing." };
  return { ok: true };
}

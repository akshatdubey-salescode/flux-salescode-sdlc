// Reading one Confluence Cloud page: parse its URL, fetch it with the project's Jira credentials (the same
// Atlassian site serves both), and turn Confluence's storage XHTML into compact text for the AI review.

export type PageRef = { pageId: string };

export class ConfluenceError extends Error {
  constructor(
    message: string,
    readonly code: "bad_url" | "foreign_host" | "no_access" | "not_found" | "failed",
  ) {
    super(message);
  }
}

/**
 * The page id from a Confluence URL, only when the URL is on the project's own Atlassian site: a link can never
 * point the server at another host. Short links (/wiki/x/...) carry no id and are rejected with a hint.
 */
export function parsePageUrl(url: string, jiraBaseUrl: string): PageRef {
  let u: URL;
  let base: URL;
  try {
    u = new URL(url.trim());
    base = new URL(jiraBaseUrl);
  } catch {
    throw new ConfluenceError("That doesn't look like a link.", "bad_url");
  }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== base.hostname.toLowerCase()) {
    throw new ConfluenceError(`Only pages on ${base.hostname} can be linked.`, "foreign_host");
  }
  const byPath = u.pathname.match(/\/wiki\/spaces\/[^/]+\/pages\/(\d+)(?:\/|$)/);
  const byQuery = u.pathname.endsWith("/wiki/pages/viewpage.action") ? u.searchParams.get("pageId") : null;
  const id = byPath?.[1] ?? (byQuery && /^\d+$/.test(byQuery) ? byQuery : null);
  if (!id) {
    throw new ConfluenceError("Use the page's full link (…/wiki/spaces/<space>/pages/<number>/…), not a short link.", "bad_url");
  }
  return { pageId: id };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: "...", eacute: "é" };

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Confluence storage format -> plain text that keeps headings, lists and tables readable. */
export function storageToText(xhtml: string): string {
  let s = xhtml ?? "";
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, code: string) => `\n${code}\n`);
  // Macro parameters and attachments are configuration, not content.
  s = s.replace(/<ac:parameter[\s\S]*?<\/ac:parameter>/g, "");
  s = s.replace(/<ac:image[\s\S]*?<\/ac:image>|<ac:image[^>]*\/>/g, "");
  s = s.replace(/<ri:[^>]*\/>/g, "");
  s = s.replace(/<h([1-6])[^>]*>/g, (_, n: string) => `\n\n${"#".repeat(Number(n))} `);
  s = s.replace(/<\/h[1-6]>/g, "\n");
  s = s.replace(/<li[^>]*>/g, "\n- ");
  s = s.replace(/<\/t[dh]>\s*<t[dh][^>]*>/g, " | ");
  s = s.replace(/<tr[^>]*>/g, "\n");
  s = s.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/ul>|<\/ol>|<\/table>/g, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decode(s);
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const MAX_PAGE_CHARS = 60_000;

export type FetchedPage = { title: string; version: number; text: string; truncated: boolean };

export async function fetchPage(args: { baseUrl: string; email: string; apiToken: string; pageId: string }): Promise<FetchedPage> {
  const base = args.baseUrl.replace(/\/+$/, "");
  const auth = Buffer.from(`${args.email}:${args.apiToken}`).toString("base64");
  let res: Response;
  try {
    res = await fetch(`${base}/wiki/rest/api/content/${encodeURIComponent(args.pageId)}?expand=body.storage,version`, {
      headers: { authorization: `Basic ${auth}`, accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ConfluenceError("Could not reach Confluence.", "failed");
  }
  if (res.status === 401 || res.status === 403) {
    throw new ConfluenceError("This project's Jira account can't read that page. Share it with that account, or link another page.", "no_access");
  }
  if (res.status === 404) throw new ConfluenceError("That page was not found.", "not_found");
  if (!res.ok) throw new ConfluenceError(`Confluence answered with an error (${res.status}).`, "failed");

  const json = (await res.json().catch(() => null)) as { title?: string; version?: { number?: number }; body?: { storage?: { value?: string } } } | null;
  const storage = json?.body?.storage?.value;
  if (!json || typeof storage !== "string") throw new ConfluenceError("Confluence returned a page without content.", "failed");
  const full = storageToText(storage);
  const truncated = full.length > MAX_PAGE_CHARS;
  return {
    title: (json.title ?? "Untitled").slice(0, 200),
    version: Number(json.version?.number ?? 0),
    text: truncated ? `${full.slice(0, MAX_PAGE_CHARS).trimEnd()}\n[…shortened]` : full,
    truncated,
  };
}

type Site = { baseUrl: string; email: string; apiToken: string };

const authHeaders = (site: Site) => ({ authorization: `Basic ${Buffer.from(`${site.email}:${site.apiToken}`).toString("base64")}`, accept: "application/json" });

/**
 * Turns whatever link a person copied into a page id: a full page link, or a short share link (/wiki/x/AbCd), which is
 * followed (same host only, a few hops) using the project's Jira account until it reaches a page URL.
 */
export async function resolvePageRef(url: string, site: Site): Promise<PageRef> {
  let current = url.trim();
  for (let hop = 0; hop < 4; hop++) {
    try {
      return parsePageUrl(current, site.baseUrl);
    } catch (err) {
      const isShort = /\/wiki\/x\/[^/]+|\/wiki\/pages\/tinyurl\.action/.test(current);
      if (!(err instanceof ConfluenceError) || err.code !== "bad_url" || !isShort) throw err;
    }
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      throw new ConfluenceError("That doesn't look like a link.", "bad_url");
    }
    if (u.hostname.toLowerCase() !== new URL(site.baseUrl).hostname.toLowerCase()) throw new ConfluenceError(`Only pages on ${new URL(site.baseUrl).hostname} can be linked.`, "foreign_host");
    let res: Response;
    try {
      res = await fetch(current, { headers: authHeaders(site), redirect: "manual", signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ConfluenceError("Could not reach Confluence.", "failed");
    }
    const loc = res.headers.get("location");
    if (res.status === 401 || res.status === 403) throw new ConfluenceError("This project's Jira account can't open that link.", "no_access");
    if (res.status < 300 || res.status >= 400 || !loc) throw new ConfluenceError("That share link could not be followed. Open the page and copy its full address.", "bad_url");
    current = loc.startsWith("http") ? loc : new URL(loc, site.baseUrl).toString();
  }
  throw new ConfluenceError("That share link could not be followed. Open the page and copy its full address.", "bad_url");
}

export type ChildPage = { id: string; title: string };

/** The pages below a page (children, then theirs, to `maxDepth`), in reading order, up to `maxPages`. */
export async function listDescendants(site: Site, pageId: string, opts: { maxDepth?: number; maxPages?: number } = {}): Promise<ChildPage[]> {
  const maxDepth = opts.maxDepth ?? 3;
  const maxPages = opts.maxPages ?? 30;
  const out: ChildPage[] = [];
  const walk = async (id: string, depth: number): Promise<void> => {
    if (depth > maxDepth || out.length >= maxPages) return;
    let res: Response;
    try {
      res = await fetch(`${site.baseUrl.replace(/\/+$/, "")}/wiki/rest/api/content/${encodeURIComponent(id)}/child/page?limit=100`, { headers: authHeaders(site), signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new ConfluenceError("Could not reach Confluence.", "failed");
    }
    if (res.status === 401 || res.status === 403) throw new ConfluenceError("This project's Jira account can't read that page's children.", "no_access");
    if (!res.ok) throw new ConfluenceError(`Confluence answered with an error (${res.status}).`, "failed");
    const json = (await res.json().catch(() => null)) as { results?: { id?: string; title?: string }[] } | null;
    for (const r of json?.results ?? []) {
      if (!r.id || out.length >= maxPages) continue;
      out.push({ id: String(r.id), title: String(r.title ?? "Untitled") });
      await walk(String(r.id), depth + 1);
    }
  };
  await walk(pageId, 1);
  return out;
}

import { NextRequest, NextResponse } from "next/server";
import { Resvg } from "@resvg/resvg-js";
import { eq } from "drizzle-orm";
import path from "node:path";
import { db } from "@/lib/db";
import { jiraIssues } from "@/lib/db/schema";
import { extractCandidateJiraKeys } from "@/lib/github/loc-sync";

// Public on purpose — no requireAuth() here. GitHub fetches this URL directly
// (embedded as a markdown image in a PR comment on a completely different
// repo/account), so it can never carry Flux's own session/auth. Nothing
// sensitive is rendered: just the repo name, PR number, and PR title the
// caller already put in the URL's own query string, plus a Jira summary
// that's already visible to anyone with Jira access.
//
// One call does everything on purpose (a reviewer's ask, to avoid the
// workflow needing a separate "does this key exist" round-trip before it
// can even pick which banner to request): parses the key using the exact
// same function LOC-sync itself uses (imported directly, not hand-copied —
// the GitHub Actions workflow no longer carries its own regex at all), looks
// it up in the DB, renders whichever of the three banners applies, and
// reports the result via a response header so the caller's own pass/fail
// decision comes from this same request instead of a second one.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const repo = truncate(searchParams.get("repo") ?? "unknown/repo", 70);
  const pr = searchParams.get("pr") ?? "?";
  const title = truncate(searchParams.get("title") ?? "", 90);
  const branch = searchParams.get("branch") ?? "";
  const repoLine = `${repo} — PR #${pr}`;

  // Title first, branch as fallback, first match only — same precedence the
  // workflow used to enforce itself before this call replaced that logic.
  const key = extractCandidateJiraKeys(title)[0] ?? extractCandidateJiraKeys(branch)[0] ?? null;

  let result: "no-key" | "not-found" | "credited";
  let svg: string;
  let jiraSummary: string | null = null;

  if (!key) {
    result = "no-key";
    svg = bannerNoKey({ repoLine, titleLine: title });
  } else {
    const [row] = await db
      .select({ summary: jiraIssues.summary })
      .from(jiraIssues)
      .where(eq(jiraIssues.jiraKey, key))
      .limit(1);

    if (!row) {
      result = "not-found";
      svg = bannerNotFound({ repoLine, titleLine: title, key });
    } else {
      result = "credited";
      jiraSummary = row.summary;
      svg = bannerCredited({ repoLine, titleLine: title, key, jiraSummary });
    }
  }

  console.log(`✨✨ [jira-ticket-check badge] repo=${repo} | pr=${pr} | key=${key ?? "none"} | result=${result} | jiraSummary=${jiraSummary ?? "n/a"}`);

  const png = rasterize(svg);

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // Same URL always renders the same content (fully determined by its
      // own query params) — short caching just spares repeat fetches of an
      // already-resolved PR from re-rendering/re-querying every time, not a
      // staleness workaround like the old hosted-PNG approach needed.
      "Cache-Control": "public, max-age=300",
      // "pass"/"fail" is the actual check result (a valid, existent Jira
      // key is the only passing case); "result" carries which of the three
      // banners was rendered, for anything that wants more than a boolean.
      "X-Jira-Check": result === "credited" ? "pass" : "fail",
      "X-Jira-Check-Result": result,
    },
  });
}

/**
 * Rasterizes to PNG on our own server, rather than returning the raw SVG for
 * the viewer to render — GitHub's web page renders an <img> SVG using the
 * viewer's own browser (fine, has real fonts), but an email client shows the
 * same image through its own server-side pipeline (e.g. Gmail's image
 * proxy), whose SVG rasterizer turned out not to support @font-face/embedded
 * web fonts at all (confirmed by direct comparison: same URL, visibly
 * different fonts between the GitHub comment and the delivered email). A
 * plain PNG has no font (or WebP image, see LOGO_PNG below) to resolve at
 * all for the viewer — the text is already pixels — so there is nothing left
 * for any rendering environment to get inconsistent about.
 */
function rasterize(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    font: {
      // resvg's font engine (fontdb/ttf-parser) rejected both fonts as
      // "malformed" when they were WOFF2 (Brotli-compressed) — only
      // TTF/OTF/plain-WOFF are supported, so these are checked-in as
      // decompressed .ttf files specifically for this renderer. Inter is
      // also checked in as two separate static-weight instances (not the
      // original variable font) -- resvg does not interpolate a variable
      // font's weight axis, so every font-weight request against a single
      // variable file silently rendered at whatever its default instance
      // was (Regular), ignoring font-weight="700" entirely.
      fontFiles: [
        path.join(process.cwd(), "public/inter-regular.ttf"),
        path.join(process.cwd(), "public/inter-bold.ttf"),
        path.join(process.cwd(), "public/jetbrains-mono-700.ttf"),
      ],
      loadSystemFonts: false,
    },
  });
  return resvg.render().asPng();
}

/** Escapes text for safe embedding inside SVG/XML — PR titles (and Jira
 * summaries) are arbitrary strings; anyone can open a PR with any title. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// JetBrains Mono Bold's actual advance width at font-size 19, pixel-measured
// directly against the rendered font (not assumed) -- 282px for a 25-char
// string and 77px for a 7-char one both land within a percent of this same
// per-character ratio, confirming a monospace font really does have a fixed
// advance regardless of which characters it is. Used so the credited
// banner's key pill sizes itself to whatever key it is given (Jira keys
// vary in length) with the same ~24px padding the other pill has, instead
// of a fixed width that leaves excess padding around a short key.
const MONO_CHAR_WIDTH_RATIO = 0.59; // px per unit font-size, at font-size 19
const PILL_PADDING = 24;

function pillWidthFor(text: string, fontSize = 19): number {
  return Math.round(text.length * fontSize * MONO_CHAR_WIDTH_RATIO) + PILL_PADDING * 2;
}

// The credited banner's pill starts at a fixed x=395 inside a 1040-wide box
// with a 36px right margin, leaving 609px to the box's edge. Solving
// pillWidthFor(n) <= 609 for n gives ~50 -- truncating the pill's text to
// that many characters (key included) keeps it inside the box regardless of
// how long the real Jira summary is, without needing the summary summarized.
const PILL_MAX_CHARS = 50;

// Shared chrome (background, ambient glows, teal accent bar) all three
// banners use — glow2Color is the only thing that varies: teal for the
// passing/credited banner, red for either failure case.
function chrome(glow2Color: string): string {
  return `
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#082B4B"/>
      <stop offset="100%" stop-color="#053029"/>
    </linearGradient>
    <linearGradient id="tealGlow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00c6b1"/>
      <stop offset="100%" stop-color="#11D6C5"/>
    </linearGradient>
    <radialGradient id="glow1" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#11D6C5" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#11D6C5" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${glow2Color}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${glow2Color}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="518" fill="url(#bg)"/>
  <circle cx="980" cy="8" r="340" fill="url(#glow1)"/>
  <circle cx="160" cy="448" r="300" fill="url(#glow2)"/>
  <rect x="0" y="0" width="10" height="518" fill="url(#tealGlow)"/>`;
}

function xIcon(): string {
  return `
    <circle cx="46" cy="46" r="46" fill="#E0231B" fill-opacity="0.14"/>
    <circle cx="46" cy="46" r="46" fill="none" stroke="#E0231B" stroke-width="3"/>
    <line x1="24" y1="24" x2="68" y2="68" stroke="#FF5A52" stroke-width="7" stroke-linecap="round"/>
    <line x1="68" y1="24" x2="24" y2="68" stroke="#FF5A52" stroke-width="7" stroke-linecap="round"/>`;
}

function checkIcon(): string {
  return `
    <circle cx="46" cy="46" r="46" fill="#00c6b1" fill-opacity="0.14"/>
    <circle cx="46" cy="46" r="46" fill="none" stroke="#0A8F86" stroke-width="3"/>
    <path d="M 25 47 L 40 62 L 68 28" fill="none" stroke="#11D6C5" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/**
 * The banner's layout constants (padding, gaps, positions) were pixel-measured
 * against a static render, not hand-derived from font-metric formulas alone —
 * see salescode-jenkins-pipelines PR #189 for that process. Whenever a zone's
 * height changes, the four gaps (top/icon-section→box/box→bottom) get
 * recomputed to stay equal. The credited/not-found banners deliberately
 * reuse the exact same zone heights/positions as the no-key one (box 166,
 * icon-section translate(80,48), box translate(80,301)) — only the icon,
 * headline, description, and box contents differ.
 */
function bannerNoKey({ repoLine, titleLine }: { repoLine: string; titleLine: string }): string {
  const repoLineSafe = escapeXml(repoLine);
  const titleLineSafe = titleLine ? `&quot;${escapeXml(titleLine)}&quot;` : "";

  return `<svg width="1200" height="518" viewBox="0 0 1200 518" xmlns="http://www.w3.org/2000/svg">
  ${chrome("#E0231B")}
  <g transform="translate(80, 48)">
    ${xIcon()}
    <text x="112" y="46" dominant-baseline="central" font-family="Inter" font-size="46" font-weight="700" fill="#ffffff">No Jira Ticket Referenced!</text>
    <text x="0" y="130" font-family="Inter" font-size="22" fill="#DCEAF2">This PR doesn't reference a Jira ticket key in its title or branch name.</text>
    <text x="0" y="166" font-family="JetBrains Mono" font-size="18" font-weight="700" fill="#11D6C5">${repoLineSafe}</text>
    ${titleLineSafe ? `<text x="0" y="198" font-family="Inter" font-size="20" fill="#9DB2C6">${titleLineSafe}</text>` : ""}
  </g>
  <g transform="translate(80, 301)">
    <rect width="1040" height="166" rx="18" fill="#ffffff" fill-opacity="0.06" stroke="#11D6C5" stroke-opacity="0.4" stroke-width="1.5"/>
    <text x="36" y="39" font-family="Inter" font-size="20" font-weight="700" fill="#11D6C5">QUICK FIX</text>
    <text x="36" y="90" font-family="Inter" font-size="24" fill="#ffffff">Retitle the PR to include a Jira ticket key — e.g.</text>
    <g transform="translate(586, 63)">
      <rect width="330" height="38" rx="8" fill="#00c6b1" fill-opacity="0.16"/>
      <text x="165" y="19" text-anchor="middle" dominant-baseline="central" font-family="JetBrains Mono" font-size="19" font-weight="700" fill="#11D6C5">PROJ-123: your title here</text>
    </g>
    <text x="36" y="139" font-family="Inter" font-size="18" fill="#9DB2C6">Retitling the PR re-runs this check automatically.</text>
  </g>
</svg>`;
}

function bannerNotFound({ repoLine, titleLine, key }: { repoLine: string; titleLine: string; key: string }): string {
  return `<svg width="1200" height="518" viewBox="0 0 1200 518" xmlns="http://www.w3.org/2000/svg">
  ${chrome("#E0231B")}
  <g transform="translate(80, 48)">
    ${xIcon()}
    <text x="112" y="46" dominant-baseline="central" font-family="Inter" font-size="46" font-weight="700" fill="#ffffff">Jira Ticket Doesn't Exist!</text>
    <text x="0" y="130" font-family="Inter" font-size="22" fill="#DCEAF2">${escapeXml(`No Jira ticket exists with the key "${key}".`)}</text>
    <text x="0" y="166" font-family="JetBrains Mono" font-size="18" font-weight="700" fill="#11D6C5">${escapeXml(repoLine)}</text>
    <text x="0" y="198" font-family="Inter" font-size="20" fill="#9DB2C6">${escapeXml(`"${titleLine}"`)}</text>
  </g>
  <g transform="translate(80, 301)">
    <rect width="1040" height="166" rx="18" fill="#ffffff" fill-opacity="0.06" stroke="#11D6C5" stroke-opacity="0.4" stroke-width="1.5"/>
    <text x="36" y="39" font-family="Inter" font-size="20" font-weight="700" fill="#11D6C5">QUICK FIX</text>
    <text x="36" y="90" font-family="Inter" font-size="24" fill="#ffffff">Retitle the PR with a valid Jira ticket key — e.g.</text>
    <g transform="translate(586, 63)">
      <rect width="330" height="38" rx="8" fill="#00c6b1" fill-opacity="0.16"/>
      <text x="165" y="19" text-anchor="middle" dominant-baseline="central" font-family="JetBrains Mono" font-size="19" font-weight="700" fill="#11D6C5">PROJ-123: your title here</text>
    </g>
    <text x="36" y="139" font-family="Inter" font-size="18" fill="#9DB2C6">Retitling the PR re-runs this check automatically.</text>
  </g>
</svg>`;
}

function bannerCredited({
  repoLine,
  titleLine,
  key,
  jiraSummary,
}: {
  repoLine: string;
  titleLine: string;
  key: string;
  jiraSummary: string | null;
}): string {
  // Same "key: description" shape the QUICK FIX pill's example already uses
  // ("PROJ-123: your title here") -- just with the real key and the real
  // summary, length-trimmed (not summarized) to fit the pill's box.
  const pillText = truncate(jiraSummary ? `${key}: ${jiraSummary}` : key, PILL_MAX_CHARS);

  return `<svg width="1200" height="518" viewBox="0 0 1200 518" xmlns="http://www.w3.org/2000/svg">
  ${chrome("#11D6C5")}
  <g transform="translate(80, 48)">
    ${checkIcon()}
    <text x="112" y="46" dominant-baseline="central" font-family="Inter" font-size="46" font-weight="700" fill="#ffffff">Jira Ticket Check Passed!</text>
    <text x="0" y="130" font-family="Inter" font-size="22" fill="#DCEAF2">This PR will be credited to the Jira ticket below — not correct? Retitle to fix it.</text>
    <text x="0" y="166" font-family="JetBrains Mono" font-size="18" font-weight="700" fill="#11D6C5">${escapeXml(repoLine)}</text>
    <text x="0" y="198" font-family="Inter" font-size="20" fill="#9DB2C6">${escapeXml(`"${titleLine}"`)}</text>
  </g>
  <g transform="translate(80, 301)">
    <rect width="1040" height="166" rx="18" fill="#ffffff" fill-opacity="0.06" stroke="#11D6C5" stroke-opacity="0.4" stroke-width="1.5"/>
    <text x="36" y="39" font-family="Inter" font-size="20" font-weight="700" fill="#11D6C5">CREDITED TO</text>
    <text x="36" y="90" font-family="Inter" font-size="24" fill="#ffffff">This PR is being credited to —</text>
    <g transform="translate(395, 63)">
      <rect width="${pillWidthFor(pillText)}" height="38" rx="8" fill="#00c6b1" fill-opacity="0.16"/>
      <text x="${pillWidthFor(pillText) / 2}" y="19" text-anchor="middle" dominant-baseline="central" font-family="JetBrains Mono" font-size="19" font-weight="700" fill="#11D6C5">${escapeXml(pillText)}</text>
    </g>
    <text x="36" y="139" font-family="Inter" font-size="18" fill="#9DB2C6">Retitling the PR re-runs this check automatically.</text>
  </g>
</svg>`;
}

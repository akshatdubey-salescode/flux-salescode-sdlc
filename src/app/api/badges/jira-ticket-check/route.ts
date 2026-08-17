import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

// Public on purpose — no requireAuth() here. GitHub fetches this URL directly
// (embedded as a markdown image in a PR comment on a completely different
// repo/account), so it can never carry Flux's own session/auth. Nothing
// sensitive is rendered: just the repo name, PR number, and PR title the
// caller already put in the URL's own query string.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const repo = truncate(searchParams.get("repo") ?? "unknown/repo", 70);
  const pr = searchParams.get("pr") ?? "?";
  const title = truncate(searchParams.get("title") ?? "", 90);

  console.log(`✨✨ [jira-ticket-check badge] repo=${repo} | pr=${pr}`);

  const svg = renderBanner({ repoLine: `${repo} · PR #${pr}`, titleLine: title });

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      // Same URL always renders the same content (fully determined by its
      // own query params) — short caching just spares repeat fetches of an
      // already-failed PR from re-rendering every time, not a staleness
      // workaround like the old hosted-PNG approach needed.
      "Cache-Control": "public, max-age=300",
    },
  });
}

/** Escapes text for safe embedding inside SVG/XML — PR titles are arbitrary,
 * attacker-influenced strings (anyone can open a PR with any title). */
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

const LOGO_DATA_URI = (() => {
  const bytes = fs.readFileSync(path.join(process.cwd(), "public/salescode-logo.webp"));
  return `data:image/webp;base64,${bytes.toString("base64")}`;
})();

/**
 * The banner's layout constants (padding, gaps, positions) were pixel-measured
 * against a static render, not hand-derived from font-metric formulas alone —
 * see salescode-jenkins-pipelines PR #189 for that process. Adding the
 * repo/PR#/title lines grew the middle "section" zone from 135 to 205, so the
 * four gaps (top/logo→section/section→box/box→bottom) were recomputed to stay
 * equal: (630 - 64 - 205 - 166) / 4 ≈ 49px each.
 */
function renderBanner({ repoLine, titleLine }: { repoLine: string; titleLine: string }): string {
  const repoLineSafe = escapeXml(repoLine);
  const titleLineSafe = titleLine ? `&quot;${escapeXml(titleLine)}&quot;` : "";

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
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
      <stop offset="0%" stop-color="#E0231B" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#E0231B" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="980" cy="120" r="340" fill="url(#glow1)"/>
  <circle cx="160" cy="560" r="300" fill="url(#glow2)"/>

  <rect x="0" y="0" width="10" height="630" fill="url(#tealGlow)"/>

  <g transform="translate(80, 49)">
    <rect width="152" height="64" rx="14" fill="#ffffff"/>
    <image href="${LOGO_DATA_URI}" x="16" y="16" width="120" height="32" preserveAspectRatio="xMidYMid meet"/>
  </g>

  <g transform="translate(80, 162)">
    <circle cx="46" cy="46" r="46" fill="#E0231B" fill-opacity="0.14"/>
    <circle cx="46" cy="46" r="46" fill="none" stroke="#E0231B" stroke-width="3"/>
    <line x1="24" y1="24" x2="68" y2="68" stroke="#FF5A52" stroke-width="7" stroke-linecap="round"/>
    <line x1="68" y1="24" x2="24" y2="68" stroke="#FF5A52" stroke-width="7" stroke-linecap="round"/>

    <text x="112" y="46" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="800" fill="#ffffff">Jira Ticket Check Failed</text>

    <text x="0" y="130" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="#DCEAF2">This PR doesn't reference a Jira ticket key in its title or branch name.</text>

    <text x="0" y="166" font-family="Menlo, Consolas, monospace" font-size="18" font-weight="700" fill="#11D6C5">${repoLineSafe}</text>
    ${titleLineSafe ? `<text x="0" y="198" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#9DB2C6">${titleLineSafe}</text>` : ""}
  </g>

  <g transform="translate(80, 416)">
    <rect width="1040" height="166" rx="18" fill="#ffffff" fill-opacity="0.06" stroke="#11D6C5" stroke-opacity="0.4" stroke-width="1.5"/>
    <text x="36" y="39" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#11D6C5">QUICK FIX</text>
    <text x="36" y="90" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#ffffff">Retitle the PR to include one — e.g.</text>
    <g transform="translate(435, 63)">
      <rect width="330" height="38" rx="8" fill="#00c6b1" fill-opacity="0.16"/>
      <text x="16" y="19" dominant-baseline="central" font-family="Menlo, Consolas, monospace" font-size="19" font-weight="700" fill="#11D6C5">PROJ-123: your title here</text>
    </g>
    <text x="36" y="138" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#9DB2C6">This check re-runs automatically in a few seconds.</text>
  </g>
</svg>`;
}

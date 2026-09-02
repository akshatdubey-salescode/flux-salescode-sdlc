import type { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";

// Runs the Jira ticket check without any GitHub Actions workflow or
// self-hosted runner at all -- GitHub calls this route directly via a
// repo/org webhook on the pull_request event, and this route does
// everything a workflow job used to: fetch the same public badge route
// (unchanged, still the single source of truth for parsing + DB lookup +
// banner rendering), then post/update the PR comment itself via GitHub's
// REST API. Zero GitHub Actions minutes, zero runner capacity used --
// this is just one more serverless function call on infrastructure Flux
// already runs 24/7 for everything else.
//
// Setup this route can't do itself (needs repo/org admin access):
// 1. Settings -> Webhooks -> Add webhook on each target repo (or an org-wide
//    webhook), Payload URL = this route's deployed URL, Content type =
//    application/json, Secret = GITHUB_WEBHOOK_SECRET's value below,
//    "Let me select individual events" -> Pull requests only.
// 2. Three env vars on this Vercel project: GITHUB_WEBHOOK_SECRET,
//    GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, and GITHUB_APP_PRIVATE_KEY
//    (the App's .pem content -- Vercel's dashboard accepts a real multi-line
//    value directly; \n-escaped is also handled below, just in case).
//    Authenticates as the installed GitHub App itself, not a static PAT --
//    whatever permissions the App was granted at install time (e.g.
//    Issues: Read & write, see the App's own permissions page) are what
//    this route actually gets; there's no separate token to rotate by hand.

const HANDLED_ACTIONS = new Set(["opened", "edited", "synchronize", "reopened"]);

/** A fresh installation access token per request -- these are cheap to mint
 * and short-lived by design (~1h), and a serverless function has no
 * reliable warm memory to cache one across invocations anyway. */
async function getInstallationToken(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !installationId || !rawKey) {
    throw new Error("GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, or GITHUB_APP_PRIVATE_KEY is not set");
  }
  // Some env-var UIs only accept single-line values, so a \n-escaped key is
  // a common workaround -- normalize back to real newlines either way.
  const privateKey = rawKey.includes("\n") ? rawKey : rawKey.replace(/\\n/g, "\n");

  const auth = createAppAuth({ appId, privateKey, installationId });
  const { token } = await auth({ type: "installation" });
  return token;
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  // timingSafeEqual throws on length mismatch rather than returning false --
  // check first so a wrong-length header doesn't crash the request instead
  // of just failing verification.
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

type PullRequestPayload = {
  action: string;
  repository: { full_name: string };
  pull_request: {
    number: number;
    title: string;
    head: { ref: string };
  };
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifySignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  if (req.headers.get("x-github-event") !== "pull_request") {
    return Response.json({ ok: true, skipped: "not a pull_request event" });
  }

  const payload = JSON.parse(rawBody) as PullRequestPayload;
  if (!HANDLED_ACTIONS.has(payload.action)) {
    return Response.json({ ok: true, skipped: `action=${payload.action}` });
  }

  const repo = payload.repository.full_name;
  const prNumber = payload.pull_request.number;
  const title = payload.pull_request.title ?? "";
  const branch = payload.pull_request.head.ref ?? "";

  const badgeParams = new URLSearchParams({ repo, pr: String(prNumber), title, branch });
  const imageUrl = `${req.nextUrl.origin}/api/badges/jira-ticket-check?${badgeParams}`;

  const badgeRes = await fetch(imageUrl);
  if (!badgeRes.ok) {
    return Response.json({ ok: false, error: `badge fetch failed: ${badgeRes.status}` }, { status: 502 });
  }
  const result = badgeRes.headers.get("x-jira-check-result");
  const passed = badgeRes.headers.get("x-jira-check") === "pass";

  let installationToken: string;
  try {
    installationToken = await getInstallationToken();
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "auth failed" }, { status: 500 });
  }

  const [owner, repoName] = repo.split("/");
  const api = `https://api.github.com/repos/${owner}/${repoName}`;
  const headers = {
    Authorization: `Bearer ${installationToken}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const marker = "<!-- jira-ticket-check -->";
  const body = `${marker}\n![Jira Ticket Check](${imageUrl})`;

  const listRes = await fetch(`${api}/issues/${prNumber}/comments?per_page=100`, { headers });
  if (!listRes.ok) {
    return Response.json({ ok: false, error: `list comments failed: ${listRes.status}` }, { status: 502 });
  }
  const comments = (await listRes.json()) as { id: number; body?: string }[];
  // findLast: one persistent comment per PR, same reasoning as the GitHub
  // Actions version of this check -- update the most recent marker comment
  // if one exists, only create new if none does yet at all.
  const existing = comments.findLast((c) => c.body?.includes(marker));

  const commentRes = existing
    ? await fetch(`${api}/issues/comments/${existing.id}`, { method: "PATCH", headers, body: JSON.stringify({ body }) })
    : await fetch(`${api}/issues/${prNumber}/comments`, { method: "POST", headers, body: JSON.stringify({ body }) });

  if (!commentRes.ok) {
    return Response.json(
      { ok: false, error: `${existing ? "update" : "create"} comment failed: ${commentRes.status}` },
      { status: 502 }
    );
  }

  console.log(`✨✨ [jira-ticket-check webhook] repo=${repo} | pr=${prNumber} | result=${result} | passed=${passed}`);

  return Response.json({ ok: true, result, passed });
}

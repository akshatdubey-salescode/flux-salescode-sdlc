// GitHub App authentication — replaces a long-lived, personally-owned PAT
// with an org-level installation token minted on demand. Two steps:
//   1. Sign a short-lived JWT as the App itself (proves "I am this App",
//      no user in the loop) using the App's RS256 private key.
//   2. Exchange that JWT for a per-installation access token (~1hr), the
//      credential GitHubClient actually calls the API with — everything
//      downstream of that (GitHubClient, sync logic) is unchanged.
// This is the one place in the GitHub integration that makes a non-GET
// call, so it deliberately stays outside GitHubClient's GET-only client.
import { createSign } from "crypto";
import { db } from "@/lib/db";
import { githubAppCredentials } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";

const GITHUB_API_BASE = "https://api.github.com";
// GitHub rejects a JWT with exp more than 10 minutes out; 9 leaves margin.
const JWT_TTL_SECONDS = 9 * 60;
// Backdate iat by a minute to tolerate clock drift between us and GitHub —
// GitHub otherwise rejects a JWT whose iat looks like it's in the future.
const CLOCK_DRIFT_SECONDS = 60;
// Stop trusting a cached installation token this long before its real
// expiry, so an in-flight sync never gets a 401 mid-run from a token that
// expired seconds ago.
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Signs a GitHub App JWT (RS256) asserting "I am App <appId>". Pure/testable:
 * `now` defaults to the real clock but can be overridden for deterministic tests.
 */
export function signAppJwt(appId: string, privateKeyPem: string, now: number = Date.now()): string {
  const iat = Math.floor(now / 1000) - CLOCK_DRIFT_SECONDS;
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat, exp: iat + JWT_TTL_SECONDS, iss: appId };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

export type CachedToken = { token: string; expiresAtMs: number };
// Keyed by installationId — module-level cache, fine for a single serverless
// instance's lifetime; worst case a cold instance re-mints one extra token.
const tokenCache = new Map<string, CachedToken>();

/**
 * Whether a cached token is still safe to hand out `now`, i.e. its real
 * expiry is more than the buffer away. Extracted as its own pure function
 * (rather than inlined in getInstallationToken) so this arithmetic — easy to
 * get subtly backwards — is unit-testable without a DB or a live fetch.
 */
export function isTokenFresh(cached: CachedToken | undefined, now: number = Date.now()): boolean {
  return cached !== undefined && cached.expiresAtMs - TOKEN_EXPIRY_BUFFER_MS > now;
}

async function loadAppCredentials(): Promise<{ appId: string; privateKey: string }> {
  const [row] = await db.select().from(githubAppCredentials).limit(1);
  if (!row) {
    throw new Error("No GitHub App credentials configured — add one under GitHub Orgs first.");
  }
  return { appId: row.appId, privateKey: decrypt(row.privateKey) };
}

/**
 * A valid installation access token for `installationId`, minted fresh via
 * the App JWT when the cache is empty/stale. This is the token
 * loadActiveOrgs()/buildOrgClients() hand to GitHubClient for authMode='app'
 * orgs — from that point on the rest of the integration doesn't know or
 * care that it isn't a PAT.
 */
export async function getInstallationToken(installationId: string): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (isTokenFresh(cached)) {
    return (cached as CachedToken).token;
  }

  const { appId, privateKey } = await loadAppCredentials();
  const jwt = signAppJwt(appId, privateKey);

  const res = await fetch(
    `${GITHUB_API_BASE}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub App installation token exchange failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  tokenCache.set(installationId, { token: data.token, expiresAtMs: new Date(data.expires_at).getTime() });
  return data.token;
}

/** Verifies the App's own credentials + one installation, without touching the cache. */
export async function testInstallation(installationId: string): Promise<string | null> {
  try {
    const { appId, privateKey } = await loadAppCredentials();
    const jwt = signAppJwt(appId, privateKey);
    const res = await fetch(
      `${GITHUB_API_BASE}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (res.ok) return null;
    if (res.status === 404) return "Installation not found — check the installation id.";
    if (res.status === 401) return "App credentials (App ID / private key) are invalid.";
    return `GitHub returned ${res.status} ${res.statusText}.`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Drops the cached token for one installation — used after credentials rotate. */
export function clearInstallationTokenCache(installationId?: string): void {
  if (installationId) tokenCache.delete(installationId);
  else tokenCache.clear();
}

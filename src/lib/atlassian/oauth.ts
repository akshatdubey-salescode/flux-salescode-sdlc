import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";

const ATLASSIAN_AUTH_URL = "https://auth.atlassian.com/authorize";
const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const ATLASSIAN_ME_URL = "https://api.atlassian.com/me";

// Scopes: create issues + read user identity + offline access for refresh tokens
const SCOPES = "read:jira-user write:jira-work offline_access";

function clientId(): string {
  const id = process.env.ATLASSIAN_CLIENT_ID;
  if (!id) throw new Error("ATLASSIAN_CLIENT_ID is not set");
  return id;
}

function clientSecret(): string {
  const secret = process.env.ATLASSIAN_CLIENT_SECRET;
  if (!secret) throw new Error("ATLASSIAN_CLIENT_SECRET is not set");
  return secret;
}

function callbackUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return `${appUrl}/api/auth/atlassian/callback`;
}

// ---------------------------------------------------------------------------
// Build the authorization URL to redirect the user to
// ---------------------------------------------------------------------------

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: clientId(),
    scope: SCOPES,
    redirect_uri: callbackUrl(),
    state,
    response_type: "code",
    prompt: "consent",
  });
  return `${ATLASSIAN_AUTH_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Exchange authorization code for access + refresh tokens
// ---------------------------------------------------------------------------

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  token_type: string;
};

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(ATLASSIAN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      redirect_uri: callbackUrl(),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Atlassian token exchange failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<TokenResponse>;
}

// ---------------------------------------------------------------------------
// Refresh an access token using the stored refresh token
// ---------------------------------------------------------------------------

async function refreshAccessToken(encryptedRefreshToken: string): Promise<TokenResponse> {
  const refreshToken = decrypt(encryptedRefreshToken);

  const res = await fetch(ATLASSIAN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Atlassian token refresh failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<TokenResponse>;
}

// ---------------------------------------------------------------------------
// Fetch Atlassian user identity with an access token
// ---------------------------------------------------------------------------

export type AtlassianIdentity = {
  account_id: string;
  email: string;
  name: string;
};

export async function getAtlassianIdentity(accessToken: string): Promise<AtlassianIdentity> {
  const res = await fetch(ATLASSIAN_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Atlassian identity (${res.status})`);
  }

  return res.json() as Promise<AtlassianIdentity>;
}

// ---------------------------------------------------------------------------
// Persist tokens for a user (upsert)
// ---------------------------------------------------------------------------

export async function saveIntegration(params: {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number; // seconds
  accountId: string;
  email: string;
}): Promise<void> {
  const tokenExpiresAt = new Date(Date.now() + params.expiresIn * 1000);

  await db
    .insert(userIntegrations)
    .values({
      userId: params.userId,
      provider: "atlassian",
      accessToken: encrypt(params.accessToken),
      refreshToken: params.refreshToken ? encrypt(params.refreshToken) : null,
      tokenExpiresAt,
      atlassianAccountId: params.accountId,
      atlassianEmail: params.email,
    })
    .onConflictDoUpdate({
      target: [userIntegrations.userId, userIntegrations.provider],
      set: {
        accessToken: encrypt(params.accessToken),
        refreshToken: params.refreshToken ? encrypt(params.refreshToken) : null,
        tokenExpiresAt,
        atlassianAccountId: params.accountId,
        atlassianEmail: params.email,
        updatedAt: new Date(),
      },
    });
}

// ---------------------------------------------------------------------------
// Get a valid (non-expired) access token for a user, auto-refreshing if needed
// Returns null if the user has no Atlassian integration or refresh fails.
// ---------------------------------------------------------------------------

export async function getValidAccessToken(userId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.provider, "atlassian")
      )
    )
    .limit(1);

  if (!row) return null;

  // Check if the token is still valid (with 60s buffer)
  const isExpired =
    row.tokenExpiresAt !== null &&
    row.tokenExpiresAt.getTime() - 60_000 < Date.now();

  if (!isExpired) {
    return decrypt(row.accessToken);
  }

  // Token expired — try to refresh
  if (!row.refreshToken) return null;

  try {
    const refreshed = await refreshAccessToken(row.refreshToken);
    const tokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

    await db
      .update(userIntegrations)
      .set({
        accessToken: encrypt(refreshed.access_token),
        refreshToken: refreshed.refresh_token
          ? encrypt(refreshed.refresh_token)
          : row.refreshToken,
        tokenExpiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.provider, "atlassian")
        )
      );

    return refreshed.access_token;
  } catch (err) {
    console.error("[atlassian-oauth] Token refresh failed:", err);
    return null;
  }
}

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

// openid/email/profile — identify the user. calendar.readonly — list events.
// offline access is requested via access_type=offline (Google's equivalent of
// Atlassian's offline_access scope).
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

function clientId(): string {
  const id = process.env.GLOBAL_AUTH_GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GLOBAL_AUTH_GOOGLE_CLIENT_ID is not set");
  return id;
}

function clientSecret(): string {
  const secret = process.env.GLOBAL_AUTH_GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GLOBAL_AUTH_GOOGLE_CLIENT_SECRET is not set");
  return secret;
}

function callbackUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return `${appUrl}/api/google/callback`;
}

// ---------------------------------------------------------------------------
// Build the authorization URL.
// access_type=offline + prompt=consent forces Google to return a refresh
// token even when the user has previously consented to the same scopes.
// Without prompt=consent, additive scopes on an already-authorized app skip
// the consent screen and Google withholds the refresh token.
// ---------------------------------------------------------------------------

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange / refresh
// ---------------------------------------------------------------------------

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: callbackUrl(),
    grant_type: "authorization_code",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export class GoogleRefreshRevoked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleRefreshRevoked";
  }
}

async function refreshAccessToken(encryptedRefreshToken: string): Promise<TokenResponse> {
  const refreshToken = decrypt(encryptedRefreshToken);

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Google returns 400 + {"error":"invalid_grant"} when the user has
    // revoked access or the refresh token has otherwise been invalidated.
    // Caller must clear the stored row so we stop trying.
    if (res.status === 400 && text.includes("invalid_grant")) {
      throw new GoogleRefreshRevoked(text);
    }
    throw new Error(`Google token refresh failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
}

// ---------------------------------------------------------------------------
// Userinfo
// ---------------------------------------------------------------------------

export type GoogleIdentity = {
  sub: string; // Google's stable user ID
  email: string;
  email_verified?: boolean;
  name?: string;
};

export async function getGoogleIdentity(accessToken: string): Promise<GoogleIdentity> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch Google userinfo (${res.status})`);
  return res.json() as Promise<GoogleIdentity>;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function saveIntegration(params: {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  googleEmail: string;
}): Promise<void> {
  const tokenExpiresAt = new Date(Date.now() + params.expiresIn * 1000);

  await db
    .insert(userIntegrations)
    .values({
      userId: params.userId,
      provider: "google",
      accessToken: encrypt(params.accessToken),
      refreshToken: params.refreshToken ? encrypt(params.refreshToken) : null,
      tokenExpiresAt,
      googleEmail: params.googleEmail,
    })
    .onConflictDoUpdate({
      target: [userIntegrations.userId, userIntegrations.provider],
      set: {
        accessToken: encrypt(params.accessToken),
        // Google only re-issues a refresh token on re-consent. Preserve the
        // existing one if a new one isn't returned.
        ...(params.refreshToken
          ? { refreshToken: encrypt(params.refreshToken) }
          : {}),
        tokenExpiresAt,
        googleEmail: params.googleEmail,
        // Reset sync state on (re)connect so the first post-connect sync is a
        // clean full pull rather than trying to use a token from a prior
        // session that may have been invalidated.
        googleSyncToken: null,
        updatedAt: new Date(),
      },
    });
}

export async function deleteIntegration(userId: string): Promise<void> {
  await db
    .delete(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.provider, "google")
      )
    );
}

// ---------------------------------------------------------------------------
// Get a valid access token for a user, refreshing if needed.
// Returns null when the integration is missing or the refresh token has been
// revoked (in which case the row is cleared so callers can prompt re-connect).
// ---------------------------------------------------------------------------

export async function getValidAccessToken(userId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.provider, "google")
      )
    )
    .limit(1);

  if (!row) return null;

  const isExpired =
    row.tokenExpiresAt !== null &&
    row.tokenExpiresAt.getTime() - 60_000 < Date.now();

  if (!isExpired) return decrypt(row.accessToken);
  if (!row.refreshToken) return null;

  try {
    const refreshed = await refreshAccessToken(row.refreshToken);
    const tokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    await db
      .update(userIntegrations)
      .set({
        accessToken: encrypt(refreshed.access_token),
        // Google rarely rotates refresh tokens, but persist a new one if returned.
        ...(refreshed.refresh_token
          ? { refreshToken: encrypt(refreshed.refresh_token) }
          : {}),
        tokenExpiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.provider, "google")
        )
      );
    return refreshed.access_token;
  } catch (err) {
    if (err instanceof GoogleRefreshRevoked) {
      console.warn(`[google-oauth] Refresh revoked for ${userId}; clearing integration`);
      await deleteIntegration(userId);
      return null;
    }
    console.error("[google-oauth] Token refresh failed:", err);
    return null;
  }
}

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";

const ATLASSIAN_AUTH_URL = "https://auth.atlassian.com/authorize";
const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const ATLASSIAN_ME_URL = "https://api.atlassian.com/me";
const ATLASSIAN_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";

// read:me      — required for /me endpoint (accountId, email)
// read:jira-user — view Jira user info
// write:jira-work — create/edit issues
// offline_access — get a refresh token
const SCOPES = "read:me read:jira-user write:jira-work offline_access";

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
  return `${appUrl}/api/atlassian/callback`;
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
// Atlassian uses rotating refresh tokens — the old token is immediately
// invalidated; always persist the new one from the response.
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
// Requires read:me scope.
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
// Fetch the list of Atlassian cloud sites the user has access to.
// Returns the cloudId needed to call:
//   https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...
// OAuth tokens CANNOT be used against org.atlassian.net directly —
// they must go through api.atlassian.com with the cloudId.
// ---------------------------------------------------------------------------

export type AtlassianResource = {
  id: string;       // cloudId
  name: string;     // org display name
  url: string;      // e.g. https://your-org.atlassian.net
  scopes: string[];
};

export async function getAccessibleResources(accessToken: string): Promise<AtlassianResource[]> {
  const res = await fetch(ATLASSIAN_RESOURCES_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Atlassian accessible resources (${res.status})`);
  }

  return res.json() as Promise<AtlassianResource[]>;
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
  cloudId: string;
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
      atlassianCloudId: params.cloudId,
    })
    .onConflictDoUpdate({
      target: [userIntegrations.userId, userIntegrations.provider],
      set: {
        accessToken: encrypt(params.accessToken),
        refreshToken: params.refreshToken ? encrypt(params.refreshToken) : null,
        tokenExpiresAt,
        atlassianAccountId: params.accountId,
        atlassianEmail: params.email,
        atlassianCloudId: params.cloudId,
        updatedAt: new Date(),
      },
    });
}

// ---------------------------------------------------------------------------
// Get a valid (non-expired) access token + cloudId for a user.
// Auto-refreshes the access token if expired (rotating refresh tokens —
// the new refresh token is always persisted immediately).
// Returns null if the user has no Atlassian integration or refresh fails.
// ---------------------------------------------------------------------------

export type AtlassianCredentials = {
  accessToken: string;
  cloudId: string;
  accountId: string;
};

// Coalesce refreshes within a server process. Atlassian rotates refresh tokens,
// so two requests must never try to redeem the same token concurrently.
const pendingRefreshes = new Map<
  string,
  Promise<AtlassianCredentials | null>
>();

async function clearIntegrationIfUnchanged(
  userId: string,
  refreshToken: string | null,
  accessToken: string
): Promise<void> {
  const conditions = [
    eq(userIntegrations.userId, userId),
    eq(userIntegrations.provider, "atlassian"),
    eq(userIntegrations.accessToken, accessToken),
  ];

  if (refreshToken) {
    conditions.push(eq(userIntegrations.refreshToken, refreshToken));
  }

  await db.delete(userIntegrations).where(and(...conditions));
}

async function refreshCredentials(
  userId: string,
  row: typeof userIntegrations.$inferSelect
): Promise<AtlassianCredentials | null> {
  if (
    !row.refreshToken ||
    !row.atlassianCloudId ||
    !row.atlassianAccountId
  ) {
    await clearIntegrationIfUnchanged(
      userId,
      row.refreshToken,
      row.accessToken
    );
    return null;
  }

  try {
    const refreshed = await refreshAccessToken(row.refreshToken);
    const tokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

    // Update only if this is still the refresh token we redeemed. This avoids
    // overwriting a newer rotating token persisted by another request.
    const updated = await db
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
          eq(userIntegrations.provider, "atlassian"),
          eq(userIntegrations.refreshToken, row.refreshToken)
        )
      )
      .returning({ userId: userIntegrations.userId });

    if (updated.length === 0) {
      // A concurrent request changed the integration. Read its result instead
      // of returning credentials that may not have been persisted.
      const [latest] = await db
        .select()
        .from(userIntegrations)
        .where(
          and(
            eq(userIntegrations.userId, userId),
            eq(userIntegrations.provider, "atlassian")
          )
        )
        .limit(1);

      if (
        latest?.atlassianCloudId &&
        latest.atlassianAccountId &&
        latest.tokenExpiresAt &&
        latest.tokenExpiresAt.getTime() - 60_000 >= Date.now()
      ) {
        return {
          accessToken: decrypt(latest.accessToken),
          cloudId: latest.atlassianCloudId,
          accountId: latest.atlassianAccountId,
        };
      }
      return null;
    }

    return {
      accessToken: refreshed.access_token,
      cloudId: row.atlassianCloudId,
      accountId: row.atlassianAccountId,
    };
  } catch (err) {
    console.error("[atlassian-oauth] Token refresh failed:", err);

    // An invalid refresh token means this is no longer a usable connection.
    // Delete only the row that still contains the failed token; a concurrent
    // successful refresh must remain connected.
    await clearIntegrationIfUnchanged(
      userId,
      row.refreshToken,
      row.accessToken
    );
    return null;
  }
}

export async function getValidCredentials(userId: string): Promise<AtlassianCredentials | null> {
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

  if (!row || !row.atlassianCloudId || !row.atlassianAccountId) return null;

  // Check if the token is still valid (with 60s buffer)
  const isExpired =
    row.tokenExpiresAt !== null &&
    row.tokenExpiresAt.getTime() - 60_000 < Date.now();

  if (!isExpired) {
    return {
      accessToken: decrypt(row.accessToken),
      cloudId: row.atlassianCloudId,
      accountId: row.atlassianAccountId,
    };
  }

  const existingRefresh = pendingRefreshes.get(userId);
  if (existingRefresh) return existingRefresh;

  const refresh = refreshCredentials(userId, row).finally(() => {
    pendingRefreshes.delete(userId);
  });
  pendingRefreshes.set(userId, refresh);
  return refresh;
}

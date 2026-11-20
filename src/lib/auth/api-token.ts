import { createHash, randomBytes } from "crypto";
import { NextResponse, after } from "next/server";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiTokens } from "@/lib/db/schema";

// External API tokens: long-lived bearer tokens for the curated /api/v1
// endpoints. Format: "flx_" + 32 random bytes (base64url). Only the SHA-256
// hash is stored, so a DB leak doesn't leak usable tokens.

const TOKEN_PREFIX = "flx_";
/** Characters of the token kept in plaintext for display ("flx_" + 8). */
const DISPLAY_PREFIX_LEN = TOKEN_PREFIX.length + 8;
/** Only record last-used once per window to avoid a write on every call. */
const LAST_USED_THROTTLE = sql`interval '5 minutes'`;

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashApiToken(token), prefix: token.slice(0, DISPLAY_PREFIX_LEN) };
}

export type ApiTokenPrincipal = {
  id: string;
  name: string;
  scopes: string[];
  /** null = every project. */
  projectIds: string[] | null;
};

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/**
 * Authenticates a request against `Authorization: Bearer flx_…`, then checks
 * the token grants `scope` and (when given) `projectId`. Deliberately never
 * cached: a revoked token must stop working on the very next request.
 * Returns a ready-to-send 401/403 response on failure.
 */
export async function authenticateApiToken(
  request: Request,
  scope: string,
  projectId?: string
): Promise<{ ok: true; token: ApiTokenPrincipal } | { ok: false; response: NextResponse }> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const raw = match?.[1];
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) {
    return {
      ok: false,
      response: jsonError(401, "unauthorized", "Missing or malformed 'Authorization: Bearer <token>' header."),
    };
  }

  const [row] = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      scopes: apiTokens.scopes,
      projectIds: apiTokens.projectIds,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hashApiToken(raw)), isNull(apiTokens.revokedAt)))
    .limit(1);

  if (!row) {
    return { ok: false, response: jsonError(401, "unauthorized", "Invalid or revoked token.") };
  }
  if (!row.scopes.includes(scope)) {
    return {
      ok: false,
      response: jsonError(403, "forbidden", `This token is not allowed to call this endpoint (needs scope '${scope}').`),
    };
  }
  if (projectId && row.projectIds && !row.projectIds.includes(projectId)) {
    return { ok: false, response: jsonError(403, "forbidden", "This token is not allowed to read this project.") };
  }

  after(async () => {
    try {
      await db
        .update(apiTokens)
        .set({ lastUsedAt: new Date() })
        .where(
          and(
            eq(apiTokens.id, row.id),
            or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, sql`now() - ${LAST_USED_THROTTLE}`))
          )
        );
    } catch (err) {
      console.error("api token last-used update failed:", err instanceof Error ? err.message : err);
    }
  });

  return { ok: true, token: row };
}

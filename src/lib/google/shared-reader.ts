// The shared Google account Flux reads Sheets with. Connected once by an admin (see the callback route's "shared"
// mode); this module stores it, keeps its access token fresh and reports its state. Never logs tokens.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { googleSharedReader } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { GoogleRefreshRevoked, refreshAccessTokenFor } from "./oauth";

const ID = "sheets";
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export type SharedReaderInfo = {
  email: string;
  connectedBy: string;
  connectedAt: string;
  lastOkAt: string | null;
  /** Set when Google no longer accepts the saved connection; the admin must reconnect. */
  problem: string | null;
};

export async function getSharedReaderInfo(): Promise<SharedReaderInfo | null> {
  const [row] = await db.select().from(googleSharedReader).where(eq(googleSharedReader.id, ID)).limit(1);
  if (!row) return null;
  return {
    email: row.email,
    connectedBy: row.connectedBy,
    connectedAt: row.connectedAt.toISOString(),
    lastOkAt: row.lastOkAt?.toISOString() ?? null,
    problem: row.lastError,
  };
}

export async function saveSharedReader(args: {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string;
  connectedBy: string;
}): Promise<void> {
  const values = {
    id: ID,
    email: args.email.toLowerCase(),
    accessToken: encrypt(args.accessToken),
    refreshToken: encrypt(args.refreshToken),
    tokenExpiresAt: new Date(Date.now() + args.expiresIn * 1000),
    scopes: args.scopes,
    connectedBy: args.connectedBy,
    connectedAt: new Date(),
    lastError: null,
  };
  await db.insert(googleSharedReader).values(values).onConflictDoUpdate({ target: googleSharedReader.id, set: values });
}

export async function removeSharedReader(): Promise<void> {
  await db.delete(googleSharedReader).where(eq(googleSharedReader.id, ID));
}

export async function markSharedReaderOk(): Promise<void> {
  await db.update(googleSharedReader).set({ lastOkAt: new Date(), lastError: null }).where(eq(googleSharedReader.id, ID)).catch(() => {});
}

/** A usable access token for the shared account, refreshed when needed; null if none is connected or Google revoked it. */
export async function getSharedAccessToken(): Promise<{ token: string; email: string } | null> {
  const [row] = await db.select().from(googleSharedReader).where(eq(googleSharedReader.id, ID)).limit(1);
  if (!row || row.lastError) return null;
  if (row.tokenExpiresAt && row.tokenExpiresAt.getTime() - 60_000 > Date.now()) return { token: decrypt(row.accessToken), email: row.email };
  try {
    const refreshed = await refreshAccessTokenFor(row.refreshToken, "sheets");
    await db
      .update(googleSharedReader)
      .set({
        accessToken: encrypt(refreshed.access_token),
        ...(refreshed.refresh_token ? { refreshToken: encrypt(refreshed.refresh_token) } : {}),
        tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      })
      .where(eq(googleSharedReader.id, ID));
    return { token: refreshed.access_token, email: row.email };
  } catch (err) {
    if (err instanceof GoogleRefreshRevoked) {
      await db.update(googleSharedReader).set({ lastError: "Google no longer accepts the saved connection. Connect the account again." }).where(eq(googleSharedReader.id, ID));
    } else {
      console.error("[google-shared-reader] token refresh failed");
    }
    return null;
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { apiTokens, jiraProjects } from "@/lib/db/schema";
import { generateApiToken } from "@/lib/auth/api-token";
import { EXPOSED_SCOPES } from "@/lib/external-api/endpoints";
import { isValidUuid } from "@/lib/validation";

const PAGE_PATH = "/superuser/api-tokens";
const MAX_NAME_LEN = 100;

/**
 * Mint a new no-expiry API token. The plaintext is returned once, here, and
 * never stored or shown again (only its hash + display prefix are kept).
 * projectIds null = every project.
 */
export async function createApiToken(input: {
  name: string;
  scopes: string[];
  projectIds: string[] | null;
}): Promise<{ error: string } | { token: string; prefix: string }> {
  const user = await requireRole("SUPERUSER");

  const name = input.name.trim();
  if (!name) return { error: "Give the token a name, e.g. the app that will use it." };
  if (name.length > MAX_NAME_LEN) return { error: `Name must be at most ${MAX_NAME_LEN} characters.` };

  const scopes = [...new Set(input.scopes)];
  if (scopes.length === 0) return { error: "Pick at least one endpoint." };
  if (scopes.some((s) => !EXPOSED_SCOPES.has(s))) return { error: "Unknown endpoint scope." };

  let projectIds: string[] | null = null;
  if (input.projectIds !== null) {
    const ids = [...new Set(input.projectIds)];
    if (ids.length === 0) return { error: "Pick at least one project, or allow all projects." };
    if (!ids.every(isValidUuid)) return { error: "One of the selected projects no longer exists." };
    const found = await db
      .select({ id: jiraProjects.id })
      .from(jiraProjects)
      .where(inArray(jiraProjects.id, ids));
    if (found.length !== ids.length) return { error: "One of the selected projects no longer exists." };
    projectIds = ids;
  }

  const { token, hash, prefix } = generateApiToken();
  await db.insert(apiTokens).values({
    name,
    tokenHash: hash,
    tokenPrefix: prefix,
    scopes,
    projectIds,
    createdBy: user.id,
  });

  revalidatePath(PAGE_PATH);
  return { token, prefix };
}

/** Revoke a token. Takes effect on the next request (lookups aren't cached). */
export async function revokeApiToken(id: string): Promise<{ error?: string }> {
  const user = await requireRole("SUPERUSER");
  if (!isValidUuid(id)) return { error: "Token not found." };
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date(), revokedBy: user.id })
    .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)));
  revalidatePath(PAGE_PATH);
  return {};
}

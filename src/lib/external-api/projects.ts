import { asc, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import type { ApiTokenPrincipal } from "@/lib/auth/api-token";
import { resolveProjectRefs } from "./bugs-params";

export type ExternalProject = {
  id: string;
  key: string;
  name: string;
  jiraBaseUrl: string;
  isActive: boolean;
};

/** Every project the token may read (its allow-list, or all projects). */
export async function loadTokenProjects(token: ApiTokenPrincipal): Promise<ExternalProject[]> {
  if (token.projectIds && token.projectIds.length === 0) return [];
  return db
    .select({
      id: jiraProjects.id,
      key: jiraProjects.jiraProjectKey,
      name: jiraProjects.name,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
      isActive: jiraProjects.isActive,
    })
    .from(jiraProjects)
    .where(token.projectIds ? inArray(jiraProjects.id, token.projectIds) : undefined)
    .orderBy(desc(jiraProjects.isActive), asc(jiraProjects.name));
}

/**
 * The projects a request covers: those named in `projects=` (Jira keys and/or
 * ids, resolved against the token's own projects so a restricted token can't
 * probe which others exist), or every active one the token can read.
 */
export async function selectTokenProjects(
  token: ApiTokenPrincipal,
  rawProjects: string | null
): Promise<{ ok: true; projects: ExternalProject[] } | { ok: false; message: string }> {
  const allowed = await loadTokenProjects(token);
  if (rawProjects === null) return { ok: true, projects: allowed.filter((p) => p.isActive) };
  const resolved = resolveProjectRefs(rawProjects, allowed);
  if (!resolved.ok) return resolved;
  const ids = new Set(resolved.ids);
  return { ok: true, projects: allowed.filter((p) => ids.has(p.id)) };
}

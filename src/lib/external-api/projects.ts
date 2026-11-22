import { asc, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import type { ApiTokenPrincipal } from "@/lib/auth/api-token";

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

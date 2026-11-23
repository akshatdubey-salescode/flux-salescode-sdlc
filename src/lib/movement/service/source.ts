/**
 * Jira access of a movement: one JiraSource per Jira project, built from the project's own stored
 * credentials. The API token is decrypted in memory for the length of the call and is never logged,
 * returned or kept anywhere else. Injectable: tests pass a FakeJira (or a provider function).
 */
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { JiraClient } from "@/lib/jira/client";
import type { JiraSource } from "../jira-source";

/** A single source for every project (tests), or a function that makes one per project. */
export type SourceInput = JiraSource | ((projectId: string) => JiraSource | Promise<JiraSource>);

/** Used when a project's credentials are missing or unreadable: every call fails, so readiness fails CLOSED. */
export function unavailableSource(reason: string): JiraSource {
  const fail = async (): Promise<never> => {
    throw new Error(reason);
  };
  return { searchByJql: fail, fetchIssueComments: fail };
}

async function realSource(projectId: string): Promise<JiraSource> {
  try {
    const [p] = await db
      .select({ baseUrl: jiraProjects.jiraBaseUrl, email: jiraProjects.jiraEmail, token: jiraProjects.jiraApiToken })
      .from(jiraProjects)
      .where(inArray(jiraProjects.id, [projectId]))
      .limit(1);
    if (!p) return unavailableSource("Jira project not found");
    // The client satisfies JiraSource structurally (see jira-source.test.ts).
    return new JiraClient({ baseUrl: p.baseUrl, email: p.email, apiToken: decrypt(p.token) });
  } catch {
    // The message could echo configuration; say only that the credentials could not be used.
    return unavailableSource("Jira credentials could not be used for this project");
  }
}

/** One source per distinct project id, in the order given. */
export async function sourcesByProject(projectIds: readonly string[], input?: SourceInput): Promise<Map<string, JiraSource>> {
  const out = new Map<string, JiraSource>();
  for (const id of new Set(projectIds)) {
    let src: JiraSource;
    try {
      src = typeof input === "function" ? await input(id) : (input ?? (await realSource(id)));
    } catch {
      src = unavailableSource("Jira source could not be created");
    }
    out.set(id, src);
  }
  return out;
}

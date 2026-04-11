import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraProjects,
  projectStatusMappings,
  type CanonicalStatus,
} from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";
import { JiraClient } from "@/lib/jira/client";

const CANONICAL_VALUES: readonly string[] = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "IN_QA",
  "DONE",
  "CANCELLED",
];

function isCanonicalStatus(v: unknown): v is CanonicalStatus {
  return typeof v === "string" && CANONICAL_VALUES.includes(v);
}

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/projects/[id]/status-mappings">
) {
  await requireRole("ADMIN");
  const { id } = await ctx.params;

  const [project] = await db
    .select()
    .from(jiraProjects)
    .where(eq(jiraProjects.id, id))
    .limit(1);

  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  // Fetch live statuses from Jira — fails gracefully
  let discoveredStatuses: { name: string; statusCategory: string }[] = [];
  try {
    const client = new JiraClient({
      baseUrl: project.jiraBaseUrl,
      email: project.jiraEmail,
      apiToken: project.jiraApiToken,
    });
    discoveredStatuses = await client.fetchProjectStatuses(
      project.jiraProjectKey
    );
  } catch {
    // Non-fatal — editor renders with existing DB mappings only
  }

  const mappings = await db
    .select()
    .from(projectStatusMappings)
    .where(eq(projectStatusMappings.projectId, id));

  return Response.json({ discoveredStatuses, mappings });
}

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/projects/[id]/status-mappings">
) {
  await requireRole("ADMIN");
  const { id } = await ctx.params;

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, id))
    .limit(1);

  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body)) {
    return Response.json(
      { error: "Body must be an array of { rawStatus, canonicalStatus }" },
      { status: 400 }
    );
  }

  const entries: { rawStatus: string; canonicalStatus: CanonicalStatus }[] = [];
  for (const item of body) {
    const row = item as Record<string, unknown>;
    if (
      typeof row.rawStatus !== "string" ||
      !isCanonicalStatus(row.canonicalStatus)
    ) {
      return Response.json(
        {
          error:
            "Each entry must have rawStatus (string) and canonicalStatus (valid enum value)",
        },
        { status: 400 }
      );
    }
    entries.push({
      rawStatus: row.rawStatus,
      canonicalStatus: row.canonicalStatus,
    });
  }

  // Replace all mappings for this project atomically
  await db.transaction(async (tx) => {
    await tx
      .delete(projectStatusMappings)
      .where(eq(projectStatusMappings.projectId, id));

    if (entries.length > 0) {
      await tx.insert(projectStatusMappings).values(
        entries.map((e) => ({
          projectId: id,
          rawStatus: e.rawStatus,
          canonicalStatus: e.canonicalStatus,
        }))
      );
    }
  });

  return Response.json({ saved: entries.length });
}

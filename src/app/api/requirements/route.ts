import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirements, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

export async function GET(request: Request) {
  const user = await requireAuth();
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  const where = projectId
    ? and(eq(requirements.createdBy, user.id), eq(requirements.projectId, projectId))
    : eq(requirements.createdBy, user.id);

  const rows = await db
    .select({
      id: requirements.id,
      title: requirements.title,
      priority: requirements.priority,
      status: requirements.status,
      createdAt: requirements.createdAt,
      projectId: requirements.projectId,
      projectName: jiraProjects.name,
      projectKey: jiraProjects.jiraProjectKey,
    })
    .from(requirements)
    .leftJoin(jiraProjects, eq(jiraProjects.id, requirements.projectId))
    .where(where)
    .orderBy(desc(requirements.createdAt));

  return Response.json(rows);
}

export async function POST(request: Request) {
  const user = await requireAuth();

  let body: {
    projectId: string;
    title: string;
    description: string;
    acceptanceCriteria?: string;
    priority?: "low" | "medium" | "high" | "critical";
    status?: "draft" | "published";
    charjanContext?: {
      answer: string;
      citations: { id: string; title: string; snippet: string; relevance_score: number }[];
    };
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, title, description, acceptanceCriteria, priority, status, charjanContext } =
    body;

  if (!projectId || !title || !description) {
    return Response.json(
      { error: "projectId, title, and description are required" },
      { status: 400 }
    );
  }

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, projectId), eq(jiraProjects.isActive, true)))
    .limit(1);

  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const [row] = await db
    .insert(requirements)
    .values({
      projectId,
      title,
      description,
      acceptanceCriteria: acceptanceCriteria ?? null,
      priority: priority ?? "medium",
      status: status ?? "draft",
      charjanContext: charjanContext ?? null,
      createdBy: user.id,
    })
    .returning();

  return Response.json(row, { status: 201 });
}

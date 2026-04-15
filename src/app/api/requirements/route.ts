import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirements } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

export async function GET() {
  const user = await requireAuth();

  const rows = await db
    .select({
      id: requirements.id,
      title: requirements.title,
      priority: requirements.priority,
      status: requirements.status,
      createdAt: requirements.createdAt,
      githubRepoName: requirements.githubRepoName,
    })
    .from(requirements)
    .where(eq(requirements.createdBy, user.id))
    .orderBy(desc(requirements.createdAt));

  return Response.json(rows);
}

export async function POST(request: Request) {
  const user = await requireAuth();

  let body: {
    githubRepoName: string;
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

  const { githubRepoName, title, description, acceptanceCriteria, priority, status, charjanContext } = body;

  if (!githubRepoName || !title || !description) {
    return Response.json(
      { error: "githubRepoName, title, and description are required" },
      { status: 400 }
    );
  }

  const [row] = await db
    .insert(requirements)
    .values({
      githubRepoName,
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

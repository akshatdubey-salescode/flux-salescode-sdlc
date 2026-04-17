import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirements } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await props.params;

  const [req] = await db
    .select({
      id: requirements.id,
      jiraIssueKey: requirements.jiraIssueKey,
      createdBy: requirements.createdBy,
    })
    .from(requirements)
    .where(and(eq(requirements.id, id), eq(requirements.createdBy, user.id)))
    .limit(1);

  if (!req) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (req.jiraIssueKey) {
    return Response.json(
      { error: "Cannot edit a requirement that has been pushed to Jira." },
      { status: 403 }
    );
  }

  let body: {
    title?: string;
    description?: string;
    acceptanceCriteria?: string | null;
    priority?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if ("acceptanceCriteria" in body)
    updates.acceptanceCriteria = body.acceptanceCriteria || null;
  if (body.priority !== undefined) updates.priority = body.priority;

  await db.update(requirements).set(updates).where(eq(requirements.id, id));

  return Response.json({ success: true });
}

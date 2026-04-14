import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectStakeholders, jiraProjects } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  await requireRole("ADMIN");
  const { id } = await ctx.params;

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, id), eq(jiraProjects.isActive, true)))
    .limit(1);

  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  const stakeholders = await db
    .select()
    .from(projectStakeholders)
    .where(eq(projectStakeholders.projectId, id))
    .orderBy(projectStakeholders.createdAt);

  return Response.json(stakeholders);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  await requireRole("ADMIN");
  const { id } = await ctx.params;

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, id), eq(jiraProjects.isActive, true)))
    .limit(1);

  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  let body: { name: string; email: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();

  if (!name || !email) {
    return Response.json({ error: "name and email are required" }, { status: 400 });
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Invalid email address" }, { status: 400 });
  }

  const [stakeholder] = await db
    .insert(projectStakeholders)
    .values({ projectId: id, name, email })
    .onConflictDoNothing()
    .returning();

  if (!stakeholder) {
    return Response.json({ error: "Stakeholder with this email already exists" }, { status: 409 });
  }

  return Response.json(stakeholder, { status: 201 });
}

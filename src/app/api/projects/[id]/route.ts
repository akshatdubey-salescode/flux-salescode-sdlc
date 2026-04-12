import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/projects/[id]">
) {
  await requireRole("SUPERUSER");

  const { id } = await ctx.params;
  const action = req.nextUrl.searchParams.get("action");

  if (action !== "deactivate" && action !== "delete") {
    return Response.json(
      { error: "action must be 'deactivate' or 'delete'" },
      { status: 400 }
    );
  }

  // Verify project exists
  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, id))
    .limit(1);

  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  if (action === "deactivate") {
    await db
      .update(jiraProjects)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(jiraProjects.id, id));

    return Response.json({ ok: true, action: "deactivated" });
  }

  // action === "delete" — single delete; all child rows cascade automatically
  await db.delete(jiraProjects).where(eq(jiraProjects.id, id));

  return Response.json({ ok: true, action: "deleted" });
}

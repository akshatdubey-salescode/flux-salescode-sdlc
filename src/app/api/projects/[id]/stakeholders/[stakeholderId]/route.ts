import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectStakeholders } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; stakeholderId: string }> }
) {
  await requireRole("ADMIN");
  const { id, stakeholderId } = await ctx.params;

  const [existing] = await db
    .select({ id: projectStakeholders.id })
    .from(projectStakeholders)
    .where(
      and(
        eq(projectStakeholders.id, stakeholderId),
        eq(projectStakeholders.projectId, id)
      )
    )
    .limit(1);

  if (!existing) {
    return Response.json({ error: "Stakeholder not found" }, { status: 404 });
  }

  await db
    .delete(projectStakeholders)
    .where(
      and(
        eq(projectStakeholders.id, stakeholderId),
        eq(projectStakeholders.projectId, id)
      )
    );

  return new Response(null, { status: 204 });
}

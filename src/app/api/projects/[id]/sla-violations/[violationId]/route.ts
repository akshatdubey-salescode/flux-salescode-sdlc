import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { slaViolations, slaRules } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";

export async function PATCH(
  _req: Request,
  ctx: RouteContext<"/api/projects/[id]/sla-violations/[violationId]">
) {
  await requireRole("ADMIN");
  const { id, violationId } = await ctx.params;

  // Verify the violation belongs to this project via rule join
  const [existing] = await db
    .select({ id: slaViolations.id })
    .from(slaViolations)
    .innerJoin(slaRules, eq(slaViolations.ruleId, slaRules.id))
    .where(and(eq(slaViolations.id, violationId), eq(slaRules.projectId, id)))
    .limit(1);

  if (!existing) return Response.json({ error: "Violation not found" }, { status: 404 });

  const [updated] = await db
    .update(slaViolations)
    .set({ resolvedAt: new Date(), resolvedReason: "manual_dismiss" })
    .where(eq(slaViolations.id, violationId))
    .returning();

  return Response.json(updated);
}

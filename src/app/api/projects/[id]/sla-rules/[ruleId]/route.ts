import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { slaRules } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";

export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/projects/[id]/sla-rules/[ruleId]">
) {
  await requireRole("ADMIN");
  const { id, ruleId } = await ctx.params;

  const [existing] = await db
    .select({ id: slaRules.id })
    .from(slaRules)
    .where(and(eq(slaRules.id, ruleId), eq(slaRules.projectId, id)))
    .limit(1);

  if (!existing) return Response.json({ error: "Rule not found" }, { status: 404 });

  let body: Partial<{
    name: string;
    description: string | null;
    conditionField: string;
    conditionOperator: string;
    conditionValue: string;
    thresholdHours: number;
    notifyAssignee: boolean;
    notifyReporter: boolean;
    additionalEmails: string[];
    isActive: boolean;
  }>;

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description?.trim() ?? null;
  if (body.conditionField !== undefined) patch.conditionField = body.conditionField;
  if (body.conditionOperator !== undefined) patch.conditionOperator = body.conditionOperator;
  if (body.conditionValue !== undefined) patch.conditionValue = body.conditionValue.trim();
  if (body.thresholdHours !== undefined) patch.thresholdHours = String(body.thresholdHours);
  if (body.notifyAssignee !== undefined) patch.notifyAssignee = body.notifyAssignee;
  if (body.notifyReporter !== undefined) patch.notifyReporter = body.notifyReporter;
  if (body.additionalEmails !== undefined) patch.additionalEmails = body.additionalEmails;
  if (body.isActive !== undefined) patch.isActive = body.isActive;

  const [updated] = await db
    .update(slaRules)
    .set(patch)
    .where(and(eq(slaRules.id, ruleId), eq(slaRules.projectId, id)))
    .returning();

  return Response.json(updated);
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/projects/[id]/sla-rules/[ruleId]">
) {
  await requireRole("ADMIN");
  const { id, ruleId } = await ctx.params;

  const [existing] = await db
    .select({ id: slaRules.id })
    .from(slaRules)
    .where(and(eq(slaRules.id, ruleId), eq(slaRules.projectId, id)))
    .limit(1);

  if (!existing) return Response.json({ error: "Rule not found" }, { status: 404 });

  await db
    .delete(slaRules)
    .where(and(eq(slaRules.id, ruleId), eq(slaRules.projectId, id)));

  return new Response(null, { status: 204 });
}

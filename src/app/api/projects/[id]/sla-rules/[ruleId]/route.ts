import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { slaRules, type SlaConditionTree } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";

const VALID_FIELDS = ["status", "status_category", "issue_type", "priority"] as const;
const VALID_OPERATORS = ["equals", "not_equals", "in"] as const;

function validateConditionTree(tree: unknown): tree is SlaConditionTree {
  if (!tree || typeof tree !== "object") return false;
  const t = tree as Record<string, unknown>;
  if (t.operator !== "OR") return false;
  if (!Array.isArray(t.groups) || t.groups.length === 0) return false;

  for (const group of t.groups as unknown[]) {
    if (!group || typeof group !== "object") return false;
    const g = group as Record<string, unknown>;
    if (g.operator !== "AND") return false;
    if (!Array.isArray(g.conditions) || g.conditions.length === 0) return false;

    for (const cond of g.conditions as unknown[]) {
      if (!cond || typeof cond !== "object") return false;
      const c = cond as Record<string, unknown>;
      if (!(VALID_FIELDS as readonly string[]).includes(c.field as string)) return false;
      if (!(VALID_OPERATORS as readonly string[]).includes(c.operator as string)) return false;
      if (typeof c.value !== "string" || !c.value.trim()) return false;
    }
  }
  return true;
}

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
    conditions: unknown;
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
  if (body.conditions !== undefined) {
    if (!validateConditionTree(body.conditions)) {
      return Response.json(
        { error: "conditions must be a valid OR-of-AND-groups structure" },
        { status: 400 }
      );
    }
    patch.conditions = body.conditions;
  }
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

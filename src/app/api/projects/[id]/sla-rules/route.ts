import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { slaRules, jiraProjects, type SlaConditionTree } from "@/lib/db/schema";
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

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/projects/[id]/sla-rules">
) {
  await requireRole("ADMIN");
  const { id } = await ctx.params;

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, id), eq(jiraProjects.isActive, true)))
    .limit(1);

  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  const rules = await db
    .select()
    .from(slaRules)
    .where(eq(slaRules.projectId, id))
    .orderBy(slaRules.createdAt);

  return Response.json(rules);
}

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/projects/[id]/sla-rules">
) {
  const user = await requireRole("ADMIN");
  const { id } = await ctx.params;

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, id), eq(jiraProjects.isActive, true)))
    .limit(1);

  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  let body: {
    name: string;
    description?: string | null;
    conditions: unknown;
    thresholdHours: number;
    notifyAssignee?: boolean;
    notifyReporter?: boolean;
    additionalEmails?: string[];
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, description, conditions, thresholdHours } = body;

  if (!name?.trim()) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  if (!validateConditionTree(conditions)) {
    return Response.json(
      { error: "conditions must be a valid OR-of-AND-groups structure" },
      { status: 400 }
    );
  }

  if (typeof thresholdHours !== "number" || thresholdHours <= 0) {
    return Response.json({ error: "thresholdHours must be a positive number" }, { status: 400 });
  }

  const [rule] = await db
    .insert(slaRules)
    .values({
      projectId: id,
      name: name.trim(),
      description: description?.trim() ?? null,
      conditions,
      thresholdHours: String(thresholdHours),
      notifyAssignee: body.notifyAssignee ?? true,
      notifyReporter: body.notifyReporter ?? false,
      additionalEmails: body.additionalEmails ?? [],
      isActive: true,
      createdBy: user.id,
    })
    .returning();

  return Response.json(rule, { status: 201 });
}

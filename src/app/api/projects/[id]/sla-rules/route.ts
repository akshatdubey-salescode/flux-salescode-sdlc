import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { slaRules, jiraProjects } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";

const VALID_FIELDS = ["status", "status_category", "issue_type", "priority"] as const;
const VALID_OPERATORS = ["equals", "not_equals", "in"] as const;

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
    conditionField: string;
    conditionOperator: string;
    conditionValue: string;
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

  const { name, description, conditionField, conditionOperator, conditionValue, thresholdHours } = body;

  if (!name?.trim() || !conditionField || !conditionOperator || !conditionValue?.trim() || !thresholdHours) {
    return Response.json({ error: "Required fields missing" }, { status: 400 });
  }

  if (!(VALID_FIELDS as readonly string[]).includes(conditionField)) {
    return Response.json({ error: "Invalid condition field" }, { status: 400 });
  }

  if (!(VALID_OPERATORS as readonly string[]).includes(conditionOperator)) {
    return Response.json({ error: "Invalid condition operator" }, { status: 400 });
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
      conditionField,
      conditionOperator,
      conditionValue: conditionValue.trim(),
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

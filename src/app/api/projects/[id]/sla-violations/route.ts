import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { slaViolations, slaRules, jiraIssues } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";

export async function GET(
  req: Request,
  ctx: RouteContext<"/api/projects/[id]/sla-violations">
) {
  await requireRole("ADMIN");
  const { id } = await ctx.params;

  const showResolved = new URL(req.url).searchParams.get("resolved") === "true";

  const whereCondition = showResolved
    ? eq(slaRules.projectId, id)
    : and(eq(slaRules.projectId, id), isNull(slaViolations.resolvedAt));

  const violations = await db
    .select({
      id: slaViolations.id,
      ruleId: slaViolations.ruleId,
      ruleName: slaRules.name,
      issueId: slaViolations.issueId,
      issueKey: jiraIssues.jiraKey,
      issueSummary: jiraIssues.summary,
      issueStatus: jiraIssues.status,
      issuePriority: jiraIssues.priority,
      enteredConditionAt: slaViolations.enteredConditionAt,
      violatedAt: slaViolations.violatedAt,
      thresholdHoursSnapshot: slaViolations.thresholdHoursSnapshot,
      actualHours: slaViolations.actualHours,
      notificationStatus: slaViolations.notificationStatus,
      resolvedAt: slaViolations.resolvedAt,
      resolvedReason: slaViolations.resolvedReason,
    })
    .from(slaViolations)
    .innerJoin(slaRules, eq(slaViolations.ruleId, slaRules.id))
    .innerJoin(jiraIssues, eq(slaViolations.issueId, jiraIssues.id))
    .where(whereCondition)
    .orderBy(desc(slaViolations.violatedAt))
    .limit(200);

  return Response.json(violations);
}

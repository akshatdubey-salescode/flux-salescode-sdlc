import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraIssues,
  slaRules,
  slaViolations,
  type JiraIssue,
  type SlaCondition,
  type SlaConditionTree,
  type SlaRule,
} from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function evaluateCondition(issue: JiraIssue, cond: SlaCondition): boolean {
  const fieldValue = ((): string | null => {
    switch (cond.field) {
      case "status":         return issue.status;
      case "status_category": return issue.statusCategory ?? null;
      case "issue_type":     return issue.issueType;
      case "priority":       return issue.priority ?? null;
    }
  })();

  if (fieldValue === null) return false;

  switch (cond.operator) {
    case "equals":     return fieldValue === cond.value;
    case "not_equals": return fieldValue !== cond.value;
    case "in": {
      const allowed = cond.value.split(",").map((v) => v.trim());
      return allowed.includes(fieldValue);
    }
  }
}

function matchesConditionTree(issue: JiraIssue, tree: SlaConditionTree): boolean {
  // OR of AND-groups
  return tree.groups.some((group) =>
    group.conditions.every((cond) => evaluateCondition(issue, cond))
  );
}

// ---------------------------------------------------------------------------
// Time-in-condition calculation
// ---------------------------------------------------------------------------

/**
 * Returns the timestamp when the issue entered the matching condition.
 *
 * Detection only evaluates rules against an issue's *current* status, so for a
 * status-based condition the entry time is exactly when the issue entered its
 * current status (`currentStatusSince`). Non-status conditions have no transition
 * to anchor to, so we fall back to syncedAt as a best-effort entry time.
 */
function getEnteredConditionAt(issue: JiraIssue, rule: SlaRule): Date {
  const hasStatusCondition = rule.conditions.groups.some((group) =>
    group.conditions.some(
      (cond) => cond.field === "status" || cond.field === "status_category"
    )
  );

  if (!hasStatusCondition) {
    return issue.syncedAt;
  }

  return issue.currentStatusSince ?? issue.syncedAt;
}

// ---------------------------------------------------------------------------
// Detection result types
// ---------------------------------------------------------------------------

export type ViolationResult = {
  rule: SlaRule;
  issue: JiraIssue;
  enteredConditionAt: Date;
  elapsedHours: number;
  /** undefined = new violation; SlaViolation id = existing violation needing escalation */
  existingViolationId: string | undefined;
  tier: 1 | 2;
};

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

/**
 * Pure function — no writes. Returns a list of issues that are currently
 * in violation (new tier-1) or need escalation (tier-2).
 */
export async function detectViolations(projectId: string): Promise<ViolationResult[]> {
  // Load active rules for this project
  const rules = await db
    .select()
    .from(slaRules)
    .where(and(eq(slaRules.projectId, projectId), eq(slaRules.isActive, true)));

  if (rules.length === 0) return [];

  // Load all non-done issues for this project
  const issues = await db
    .select()
    .from(jiraIssues)
    .where(eq(jiraIssues.projectId, projectId));

  const now = Date.now();
  const results: ViolationResult[] = [];

  for (const rule of rules) {
    const thresholdMs = parseFloat(rule.thresholdHours) * 60 * 60 * 1000;

    // Load existing active violations for this rule (unresolved)
    const activeViolations = await db
      .select()
      .from(slaViolations)
      .where(
        and(
          eq(slaViolations.ruleId, rule.id),
          isNull(slaViolations.resolvedAt)
        )
      );

    const violationByIssue = new Map(
      activeViolations.map((v) => [v.issueId, v])
    );

    for (const issue of issues) {
      // Skip if issue doesn't match this rule's conditions
      if (!matchesConditionTree(issue, rule.conditions)) continue;

      const enteredAt = getEnteredConditionAt(issue, rule);
      const elapsedMs = now - enteredAt.getTime();
      const elapsedHours = elapsedMs / (60 * 60 * 1000);

      const existing = violationByIssue.get(issue.id);

      if (!existing) {
        // No active violation yet — check if threshold is breached
        if (elapsedMs >= thresholdMs) {
          results.push({
            rule,
            issue,
            enteredConditionAt: enteredAt,
            elapsedHours,
            existingViolationId: undefined,
            tier: 1,
          });
        }
      } else {
        // Active violation exists
        const alreadyEscalated = existing.escalationNotifiedAt !== null;
        const tier1Sent = existing.notificationSentAt !== null;

        if (!tier1Sent) {
          // Tier-1 notification was never sent (e.g. email failed) — retry
          results.push({
            rule,
            issue,
            enteredConditionAt: enteredAt,
            elapsedHours,
            existingViolationId: existing.id,
            tier: 1,
          });
        } else if (!alreadyEscalated && elapsedMs >= thresholdMs * 2) {
          results.push({
            rule,
            issue,
            enteredConditionAt: enteredAt,
            elapsedHours,
            existingViolationId: existing.id,
            tier: 2,
          });
        }
      }
    }
  }

  return results;
}

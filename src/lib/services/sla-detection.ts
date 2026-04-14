import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraIssues,
  jiraStatusHistory,
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
 * Returns the timestamp when the issue entered the matching condition,
 * based on status history (most recent transition to the matching status).
 * Falls back to issue.syncedAt if no history entry matches.
 */
async function getEnteredConditionAt(
  issue: JiraIssue,
  rule: SlaRule
): Promise<Date> {
  // Find the status condition(s) in the tree, if any
  const statusConditions: SlaCondition[] = [];
  for (const group of rule.conditions.groups) {
    for (const cond of group.conditions) {
      if (cond.field === "status" || cond.field === "status_category") {
        statusConditions.push(cond);
      }
    }
  }

  if (statusConditions.length === 0) {
    // No status-based condition — use syncedAt as best-effort entry time
    return issue.syncedAt;
  }

  // Find the most recent status history entry that matches
  const history = await db
    .select()
    .from(jiraStatusHistory)
    .where(eq(jiraStatusHistory.issueId, issue.id))
    .orderBy(jiraStatusHistory.changedAt);

  // Walk history in order; find the last transition into the matching status
  let enteredAt: Date | null = null;
  for (const entry of history) {
    const mockIssue = { ...issue, status: entry.toStatus } as JiraIssue;
    const matches = statusConditions.some((cond) =>
      evaluateCondition(mockIssue, cond)
    );
    if (matches) {
      if (enteredAt === null) {
        enteredAt = entry.changedAt;
      }
      // Keep going — we want the most recent uninterrupted entry
    } else {
      // Issue left the condition, reset
      enteredAt = null;
    }
  }

  return enteredAt ?? issue.syncedAt;
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

      const enteredAt = await getEnteredConditionAt(issue, rule);
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
        // Active violation exists — check if it qualifies for tier-2 escalation
        const alreadyEscalated = existing.escalationNotifiedAt !== null;
        const tier1Sent = existing.notificationSentAt !== null;

        if (!alreadyEscalated && tier1Sent && elapsedMs >= thresholdMs * 2) {
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

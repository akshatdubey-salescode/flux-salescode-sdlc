import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraProjects,
  slaRules,
  slaViolations,
  jiraIssues,
} from "@/lib/db/schema";
import { detectViolations } from "@/lib/services/sla-detection";
import { sendSLADigestEmail, type DigestRecipient } from "@/lib/services/sla-email";

// ---------------------------------------------------------------------------
// Auth — CRON_SECRET bearer token, no user session required
// ---------------------------------------------------------------------------

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

// ---------------------------------------------------------------------------
// POST /api/cron/sla-check
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runStats = {
    projectsChecked: 0,
    issuesChecked: 0,
    newViolations: 0,
    escalations: 0,
    emailsSent: 0,
    emailsFailed: 0,
    errors: [] as string[],
  };

  // 1. Load all projects that have at least one active SLA rule
  const projectsWithRules = await db
    .selectDistinct({ id: jiraProjects.id, name: jiraProjects.name, jiraBaseUrl: jiraProjects.jiraBaseUrl })
    .from(jiraProjects)
    .innerJoin(
      slaRules,
      and(eq(slaRules.projectId, jiraProjects.id), eq(slaRules.isActive, true))
    )
    .where(eq(jiraProjects.isActive, true));

  runStats.projectsChecked = projectsWithRules.length;

  for (const project of projectsWithRules) {
    try {
      // 2. Run violation detection for this project
      const violations = await detectViolations(project.id);

      // Count issues checked for this project
      const issueCount = await db
        .select({ id: jiraIssues.id })
        .from(jiraIssues)
        .where(eq(jiraIssues.projectId, project.id));
      runStats.issuesChecked += issueCount.length;

      if (violations.length === 0) continue;

      // 3. Insert new violation rows; collect DB ids for all violations
      // Maps "ruleId:issueId" → slaViolations.id (for newly inserted rows)
      const newViolationIds = new Map<string, string>();

      for (const v of violations) {
        if (v.existingViolationId) continue; // already in DB

        const [inserted] = await db
          .insert(slaViolations)
          .values({
            ruleId: v.rule.id,
            issueId: v.issue.id,
            enteredConditionAt: v.enteredConditionAt,
            violatedAt: new Date(),
            thresholdHoursSnapshot: String(parseFloat(v.rule.thresholdHours)),
            actualHours: String(v.elapsedHours),
            notificationStatus: "pending",
          })
          .onConflictDoNothing()
          .returning({ id: slaViolations.id });

        if (inserted) {
          newViolationIds.set(`${v.rule.id}:${v.issue.id}`, inserted.id);
          runStats.newViolations++;
        }
      }

      // 4. Filter to violations that need notification
      const needsNotification = violations.filter((v) => {
        if (v.tier === 1) {
          // Either newly inserted, or existing violation whose tier-1 email never sent
          return (
            newViolationIds.has(`${v.rule.id}:${v.issue.id}`) ||
            v.existingViolationId !== undefined
          );
        }
        // Tier 2 — existing violation needing escalation
        return v.existingViolationId !== undefined;
      });

      if (needsNotification.length === 0) continue;

      runStats.escalations += violations.filter((v) => v.tier === 2).length;

      // 5. Resolve recipients per violation
      // recipient email → DigestRecipient
      const recipientMap = new Map<string, DigestRecipient>();

      function addToRecipient(email: string | null | undefined, v: typeof violations[0]) {
        if (!email) return;
        const lower = email.toLowerCase();
        if (!recipientMap.has(lower)) {
          recipientMap.set(lower, {
            email: lower,
            violations: [],
            violationIds: new Map(),
          });
        }
        const rec = recipientMap.get(lower)!;
        rec.violations.push(v);

        const violationDbId = v.existingViolationId ?? newViolationIds.get(`${v.rule.id}:${v.issue.id}`);
        if (violationDbId) {
          rec.violationIds.set(`${v.rule.id}:${v.issue.id}`, violationDbId);
        }
      }

      for (const v of needsNotification) {
        if (v.rule.notifyAssignee) addToRecipient(v.issue.assigneeEmail, v);
        if (v.rule.notifyReporter) addToRecipient(v.issue.reporterEmail, v);
        for (const email of v.rule.additionalEmails) addToRecipient(email, v);
      }

      // 6. Send one digest per recipient
      for (const recipient of recipientMap.values()) {
        const result = await sendSLADigestEmail(project.name, recipient, project.jiraBaseUrl);
        if (result.sent) {
          runStats.emailsSent++;
        } else {
          runStats.emailsFailed++;
          runStats.errors.push(`Email to ${recipient.email}: ${result.error}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runStats.errors.push(`Project ${project.name}: ${msg}`);
    }
  }

  return Response.json(runStats);
}

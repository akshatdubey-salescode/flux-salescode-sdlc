import { NextResponse, connection } from "next/server";
import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects, slaRules, slaViolations } from "@/lib/db/schema";
import { authenticateApiToken } from "@/lib/auth/api-token";
import { selectTokenProjects } from "@/lib/external-api/projects";
import { parseSlaQuery } from "@/lib/external-api/sla-params";

// SLA breaches: GET /api/v1/sla-violations?projects=SC,DEV&status=open
// `projects` takes Jira keys and/or project ids; omitted = every active
// project the token can read. Shares the bug board's `bugs:read` scope.
// Docs: src/lib/external-api/docs/sla-violations.ts.

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function GET(request: Request) {
  await connection();
  try {
    const auth = await authenticateApiToken(request, "bugs:read");
    if (!auth.ok) return auth.response;

    const params = new URL(request.url).searchParams;
    const parsed = parseSlaQuery(params);
    if (!parsed.ok) return jsonError(400, "bad_request", parsed.message);
    const query = parsed.query;

    const sel = await selectTokenProjects(auth.token, params.get("projects"));
    if (!sel.ok) return jsonError(400, "bad_request", sel.message);
    const selected = sel.projects;

    const projects = selected.map(({ id, key, name }) => ({ id, key, name }));
    const base = { projects, limit: query.limit, offset: query.offset, filters: query };
    if (selected.length === 0) {
      return NextResponse.json({ ...base, total: 0, count: 0, violations: [] });
    }

    const where = and(
      inArray(slaRules.projectId, selected.map((p) => p.id)),
      query.status === "open"
        ? isNull(slaViolations.resolvedAt)
        : query.status === "resolved"
          ? isNotNull(slaViolations.resolvedAt)
          : undefined
    );

    const [[{ total }], rows] = await Promise.all([
      db
        .select({ total: count() })
        .from(slaViolations)
        .innerJoin(slaRules, eq(slaViolations.ruleId, slaRules.id))
        .where(where),
      db
        .select({
          id: slaViolations.id,
          ruleId: slaViolations.ruleId,
          ruleName: slaRules.name,
          projectKey: jiraProjects.jiraProjectKey,
          projectName: jiraProjects.name,
          jiraBaseUrl: jiraProjects.jiraBaseUrl,
          jiraKey: jiraIssues.jiraKey,
          summary: jiraIssues.summary,
          status: jiraIssues.status,
          priority: jiraIssues.priority,
          assigneeName: jiraIssues.assigneeName,
          assigneeEmail: jiraIssues.assigneeEmail,
          enteredConditionAt: slaViolations.enteredConditionAt,
          violatedAt: slaViolations.violatedAt,
          thresholdHours: slaViolations.thresholdHoursSnapshot,
          actualHours: slaViolations.actualHours,
          escalatedAt: slaViolations.escalationNotifiedAt,
          resolvedAt: slaViolations.resolvedAt,
          resolvedReason: slaViolations.resolvedReason,
        })
        .from(slaViolations)
        .innerJoin(slaRules, eq(slaViolations.ruleId, slaRules.id))
        .innerJoin(jiraProjects, eq(slaRules.projectId, jiraProjects.id))
        .innerJoin(jiraIssues, eq(slaViolations.issueId, jiraIssues.id))
        .where(where)
        .orderBy(desc(slaViolations.violatedAt), desc(slaViolations.id))
        .limit(query.limit)
        .offset(query.offset),
    ]);

    const violations = rows.map((r) => ({
      ...r,
      // numeric columns come back as strings
      thresholdHours: Number(r.thresholdHours),
      actualHours: Number(r.actualHours),
    }));

    return NextResponse.json({ ...base, total, count: violations.length, violations });
  } catch (error) {
    // Never log the request/headers here — they carry the bearer token.
    console.error("v1 sla-violations error:", error instanceof Error ? error.message : error);
    return jsonError(500, "internal_error", "Something went wrong. Try again later.");
  }
}

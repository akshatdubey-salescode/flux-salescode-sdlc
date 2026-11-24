import { NextResponse, connection } from "next/server";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { slaRules } from "@/lib/db/schema";
import { authenticateApiToken } from "@/lib/auth/api-token";
import { selectTokenProjects } from "@/lib/external-api/projects";
import { conditionTreeToHuman } from "@/components/sla-engine/helpers";

// SLA rule definitions: GET /api/v1/sla-rules?projects=SC,DEV
// Same project selection and `bugs:read` scope as /api/v1/sla-violations.
// Docs: src/lib/external-api/docs/sla-violations.ts.

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function GET(request: Request) {
  await connection();
  try {
    const auth = await authenticateApiToken(request, "bugs:read");
    if (!auth.ok) return auth.response;

    const sel = await selectTokenProjects(auth.token, new URL(request.url).searchParams.get("projects"));
    if (!sel.ok) return jsonError(400, "bad_request", sel.message);
    const byId = new Map(sel.projects.map((p) => [p.id, p]));

    const rows = byId.size
      ? await db
          .select()
          .from(slaRules)
          .where(inArray(slaRules.projectId, [...byId.keys()]))
          .orderBy(asc(slaRules.name))
      : [];

    const rules = rows.map((r) => {
      const thresholdHours = Number(r.thresholdHours);
      const escalationMultiplier = Number(r.escalationMultiplier);
      return {
        id: r.id,
        projectKey: byId.get(r.projectId)!.key,
        projectName: byId.get(r.projectId)!.name,
        name: r.name,
        description: r.description,
        isActive: r.isActive,
        conditionText: conditionTreeToHuman(r.conditions),
        conditions: r.conditions,
        thresholdHours,
        escalationMultiplier,
        escalationHours: thresholdHours * escalationMultiplier,
        notifyAssignee: r.notifyAssignee,
        notifyReporter: r.notifyReporter,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });

    return NextResponse.json({
      projects: sel.projects.map(({ id, key, name }) => ({ id, key, name })),
      count: rules.length,
      rules,
    });
  } catch (error) {
    // Never log the request/headers here — they carry the bearer token.
    console.error("v1 sla-rules error:", error instanceof Error ? error.message : error);
    return jsonError(500, "internal_error", "Something went wrong. Try again later.");
  }
}

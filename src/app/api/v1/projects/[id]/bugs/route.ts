import { NextResponse, connection } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { authenticateApiToken } from "@/lib/auth/api-token";
import { fetchProjectBugs } from "@/lib/bug-summary-query";
import { applyBugsQuery, parseBugsQuery } from "@/lib/external-api/bugs-params";
import { localDateStr, ALL_TIME_START } from "@/lib/date-utils";

// External, token-authed bug board. Docs: src/lib/external-api/docs/bugs.ts.
// The session-authed /api/projects/[id]/bugs is the UI's internal route and
// is free to change; this one is a contract with other apps.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  await connection();
  const { id: rawId } = await props.params;
  // Lowercase so a token's project list matches however the caller cased it.
  const projectId = rawId.toLowerCase();
  try {
    // Validate before any DB cast: a non-UUID id would make Postgres throw.
    if (!UUID.test(projectId)) {
      return jsonError(400, "bad_request", "Project id must be a UUID.");
    }

    const auth = await authenticateApiToken(request, "bugs:read", projectId);
    if (!auth.ok) return auth.response;

    const parsed = parseBugsQuery(new URL(request.url).searchParams, {
      start: ALL_TIME_START,
      end: localDateStr(new Date()),
    });
    if (!parsed.ok) return jsonError(400, "bad_request", parsed.message);
    const query = parsed.query;

    const [project] = await db
      .select({ id: jiraProjects.id, key: jiraProjects.jiraProjectKey, name: jiraProjects.name })
      .from(jiraProjects)
      .where(eq(jiraProjects.id, projectId))
      .limit(1);
    if (!project) return jsonError(404, "not_found", "No project with this id.");

    const rows = await fetchProjectBugs(projectId, query.start, query.end);

    const { total, page } = applyBugsQuery(rows, query);

    return NextResponse.json({
      project,
      total,
      count: page.length,
      limit: query.limit,
      offset: query.offset,
      filters: query,
      bugs: page,
    });
  } catch (error) {
    // Never log the request/headers here — they carry the bearer token.
    console.error(
      "v1 project bugs error:",
      projectId,
      error instanceof Error ? error.message : error
    );
    return jsonError(500, "internal_error", "Something went wrong. Try again later.");
  }
}

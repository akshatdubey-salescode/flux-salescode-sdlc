import { NextResponse, connection } from "next/server";
import { authenticateApiToken } from "@/lib/auth/api-token";
import { fetchProjectBugs } from "@/lib/bug-summary-query";
import { applyBugsQuery, parseBugsQuery, resolveProjectRefs } from "@/lib/external-api/bugs-params";
import { loadTokenProjects } from "@/lib/external-api/projects";
import { localDateStr, ALL_TIME_START } from "@/lib/date-utils";

// Cross-project bug board: GET /api/v1/bugs?projects=SC,DEV&…
// `projects` takes Jira keys and/or project ids; omitted = every active
// project the token can read. Same filters/paging as the per-project route.
// Docs: src/lib/external-api/docs/bugs.ts.

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function GET(request: Request) {
  await connection();
  try {
    const auth = await authenticateApiToken(request, "bugs:read");
    if (!auth.ok) return auth.response;

    const params = new URL(request.url).searchParams;
    const parsed = parseBugsQuery(params, { start: ALL_TIME_START, end: localDateStr(new Date()) });
    if (!parsed.ok) return jsonError(400, "bad_request", parsed.message);
    const query = parsed.query;

    const allowed = await loadTokenProjects(auth.token);
    let selected = allowed.filter((p) => p.isActive);
    const rawProjects = params.get("projects");
    if (rawProjects !== null) {
      // Resolve against the token's projects only. A project outside its
      // allow-list reads as unknown, so a restricted token can't probe
      // which other projects exist.
      const resolved = resolveProjectRefs(rawProjects, allowed);
      if (!resolved.ok) return jsonError(400, "bad_request", resolved.message);
      const ids = new Set(resolved.ids);
      selected = allowed.filter((p) => ids.has(p.id));
    }

    // Per-project loads hit the same cache entries as the per-project route.
    const perProject = await Promise.all(
      selected.map((p) => fetchProjectBugs(p.id, query.start, query.end))
    );
    const { total, page } = applyBugsQuery(perProject.flat(), query);

    return NextResponse.json({
      projects: selected.map(({ id, key, name }) => ({ id, key, name })),
      total,
      count: page.length,
      limit: query.limit,
      offset: query.offset,
      filters: query,
      bugs: page,
    });
  } catch (error) {
    // Never log the request/headers here — they carry the bearer token.
    console.error("v1 bugs error:", error instanceof Error ? error.message : error);
    return jsonError(500, "internal_error", "Something went wrong. Try again later.");
  }
}

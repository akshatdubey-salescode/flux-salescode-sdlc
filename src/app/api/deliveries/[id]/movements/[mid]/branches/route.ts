import { NextRequest, NextResponse } from "next/server";
import { listAffectedRepos, saveBranches, searchBranches } from "@/lib/movement/service/service";
import { authActor, badIds, readJson, run } from "@/lib/movement/service/http";

type Params = { params: Promise<{ id: string; mid: string }> };

/**
 * Without `repo`: the repos the movement's records name (and the tracked repos) with the chosen
 * branch (any signed-in user). With `?repo=&q=`: a live, read-only GitHub branch search (q <= 100
 * chars, <= 50 results, 15 s) for delivery managers only.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => {
    const url = new URL(req.url);
    const repo = url.searchParams.get("repo");
    if (repo !== null) return NextResponse.json(await searchBranches(id, mid, repo, url.searchParams.get("q") ?? "", actor));
    return NextResponse.json(await listAffectedRepos(id, mid));
  });
}

/** Save the branch picks: `{ branches: [{ repo, branch }] }` (<= 30 repos). Changing them changes the checklist hash. */
export async function PUT(req: NextRequest, { params }: Params) {
  const actor = await authActor();
  const { id, mid } = await params;
  const bad = badIds({ id, mid });
  if (bad) return bad;
  return run(async () => {
    const body = await readJson(req);
    return NextResponse.json(await saveBranches(id, mid, body.branches, actor));
  });
}

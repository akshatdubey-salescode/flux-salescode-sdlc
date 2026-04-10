import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/server";
import { syncProject } from "@/lib/jira/sync";

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<"/api/projects/[id]/sync">
) {
  await requireRole("SUPERUSER");
  const { id } = await ctx.params;

  try {
    const result = await syncProject(id);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 422 });
  }
}

import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/projects/[id]/header-image">
) {
  await requireRole("ADMIN");
  const { id } = await ctx.params;

  const body = await req.json();
  const { headerImageUrl } = body as { headerImageUrl: unknown };

  if (
    typeof headerImageUrl !== "string" ||
    (!headerImageUrl.startsWith("http://") &&
      !headerImageUrl.startsWith("https://"))
  ) {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }

  await db
    .update(jiraProjects)
    .set({ headerImageUrl })
    .where(eq(jiraProjects.id, id));

  return Response.json({ ok: true });
}

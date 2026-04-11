import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";
import { HEADER_PALETTE } from "@/lib/header-palette";

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/projects/[id]/header-image">
) {
  await requireRole("ADMIN");
  const { id } = await ctx.params;

  const body = await req.json() as { type: unknown; value: unknown };
  const { type, value } = body;

  if (type === "color") {
    if (typeof value !== "string" || !(HEADER_PALETTE as readonly string[]).includes(value)) {
      return Response.json({ error: "Invalid color" }, { status: 400 });
    }
    await db
      .update(jiraProjects)
      .set({ headerColor: value, headerImageUrl: null })
      .where(eq(jiraProjects.id, id));
    return Response.json({ ok: true });
  }

  if (type === "image") {
    if (
      typeof value !== "string" ||
      (!value.startsWith("http://") && !value.startsWith("https://"))
    ) {
      return Response.json({ error: "Invalid URL" }, { status: 400 });
    }
    await db
      .update(jiraProjects)
      .set({ headerImageUrl: value, headerColor: null })
      .where(eq(jiraProjects.id, id));
    return Response.json({ ok: true });
  }

  return Response.json({ error: "type must be 'image' or 'color'" }, { status: 400 });
}

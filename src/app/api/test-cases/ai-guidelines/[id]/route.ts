import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/validation";
import { isResponse, readJsonObject, requireTestCasesUser, toActor } from "@/lib/test-cases/api";
import { moveGuideline, refreshGuideline, removeGuideline, updateGuideline } from "@/lib/test-cases/ai-review/knowledge";

async function guard() {
  const user = await requireTestCasesUser();
  if (isResponse(user)) return user;
  if (!toActor(user).isAdmin) return NextResponse.json({ error: "Only an admin can manage the AI review guidelines." }, { status: 403 });
  return user;
}

/** Turn a page on/off, make it general (used in every project) or not, follow its sub-pages or not, move it up or down the reading order ({ move: "up" | "down" }), or re-read it ({ refresh: true }). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await guard();
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const { enabled, isGeneral, syncChildren, refresh, move } = parsed.body;
  const direction = move === "up" || move === "down" ? move : null;
  if (typeof enabled !== "boolean" && typeof isGeneral !== "boolean" && typeof syncChildren !== "boolean" && refresh !== true && !direction) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const changed = await updateGuideline(id, {
    enabled: typeof enabled === "boolean" ? enabled : undefined,
    isGeneral: typeof isGeneral === "boolean" ? isGeneral : undefined,
    syncChildren: typeof syncChildren === "boolean" ? syncChildren : undefined,
  });
  if (!changed) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  if (direction && !(await moveGuideline(id, direction))) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  if (refresh === true) {
    const result = await refreshGuideline(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ page: result.page });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await guard();
  if (isResponse(user)) return user;
  const { id } = await ctx.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  if (!(await removeGuideline(id))) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

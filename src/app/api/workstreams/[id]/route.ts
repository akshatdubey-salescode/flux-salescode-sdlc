import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { sprintWorkstreams } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { isValidUuid, parseOptionalText } from "@/lib/validation";
import {
  fetchWorkstreamById,
  type SprintWorkstream,
  type SprintWithItems,
} from "@/lib/sprints/entries";

type Params = { params: Promise<{ id: string }> };

export type WorkstreamResponse = { workstream: SprintWorkstream; sprints: SprintWithItems[] };

/** One workstream plus its sprints — backs the standalone /workstreams/[id] page. */
export async function GET(_req: NextRequest, { params }: Params) {
  await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  const result = await fetchWorkstreamById(id);
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result satisfies WorkstreamResponse);
}

/** Rename a workstream / edit its description. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: sprintWorkstreams.id, projectId: sprintWorkstreams.projectId })
    .from(sprintWorkstreams)
    .where(eq(sprintWorkstreams.id, id))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Partial<{ name: string; description: string | null; updatedAt: Date }> = {};
  if (body.name !== undefined) {
    const name = parseOptionalText(body.name);
    if (!name) return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    updates.name = name;
  }
  if (body.description !== undefined) {
    updates.description = parseOptionalText(body.description) ?? null;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  updates.updatedAt = new Date();

  await db.update(sprintWorkstreams).set(updates).where(eq(sprintWorkstreams.id, id));

  revalidateTag("sprints", "max");
  revalidateTag(`project:${existing.projectId}`, "max");

  const result = await fetchWorkstreamById(id);
  return NextResponse.json(result satisfies WorkstreamResponse | null);
}

/** Delete a workstream. Its sprints are released (workstream_id SET NULL), never deleted. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [existing] = await db
    .select({ id: sprintWorkstreams.id, projectId: sprintWorkstreams.projectId })
    .from(sprintWorkstreams)
    .where(eq(sprintWorkstreams.id, id))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(sprintWorkstreams).where(eq(sprintWorkstreams.id, id));

  revalidateTag("sprints", "max");
  revalidateTag(`project:${existing.projectId}`, "max");

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { sprintWorkstreams, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid, parseOptionalText } from "@/lib/validation";
import { fetchProjectWorkstreams, type SprintWorkstream } from "@/lib/sprints/entries";

type Params = { params: Promise<{ id: string }> };

export type ProjectWorkstreamsResponse = { workstreams: SprintWorkstream[] };

/** List a project's workstreams with live sprint counts. */
export async function GET(_req: NextRequest, { params }: Params) {
  await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  const workstreams = await fetchProjectWorkstreams(id);
  return NextResponse.json({ workstreams } satisfies ProjectWorkstreamsResponse);
}

/** Create a workstream. Same manager gate as sprint/delivery planning. */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id: projectId } = await params;
  if (!isValidUuid(projectId)) {
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

  const name = parseOptionalText(body.name);
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const description = parseOptionalText(body.description) ?? null;

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const session = await getServerSession(authOptions);
  const createdByName = session?.user?.name?.trim() || null;

  await db.insert(sprintWorkstreams).values({
    projectId,
    name,
    description,
    createdBy: user.id,
    createdByName,
  });

  revalidateTag("sprints", "max");
  revalidateTag(`project:${projectId}`, "max");

  const workstreams = await fetchProjectWorkstreams(projectId);
  return NextResponse.json({ workstreams } satisfies ProjectWorkstreamsResponse, { status: 201 });
}

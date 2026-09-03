import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { sprints } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { fetchSprintById, type SprintWithItems } from "@/lib/sprints/entries";

type Params = { params: Promise<{ id: string }> };

// Same batch ceiling as the delivery add route.
const MAX_ISSUE_IDS = 200;

export type SprintItemsResponse = { sprint: SprintWithItems };

/**
 * Attach one or more Jira issues to a sprint. Closed sprints refuse new work
 * (reopen first) — standard sprint-board behavior. Whether an item counts as
 * committed is decided by the start-time snapshot, never here: on a planned
 * sprint it waits for the start stamp, on an active sprint it stays
 * uncommitted and reports as "added after start". Re-adding an issue that was
 * soft-removed from an active sprint revives that row (clearing the removal)
 * rather than failing the unique index.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id: sprintId } = await params;
  if (!isValidUuid(sprintId)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const issueIds = (body as { issueIds?: unknown })?.issueIds;
  if (!Array.isArray(issueIds) || issueIds.length === 0) {
    return NextResponse.json({ error: "issueIds must be a non-empty array" }, { status: 400 });
  }
  if (issueIds.length > MAX_ISSUE_IDS) {
    return NextResponse.json({ error: `issueIds must not exceed ${MAX_ISSUE_IDS}` }, { status: 400 });
  }
  if (!issueIds.every(isValidUuid)) {
    return NextResponse.json({ error: "every issueId must be a valid UUID" }, { status: 400 });
  }
  const rawComment = (body as { comment?: unknown })?.comment;
  if (rawComment !== undefined && rawComment !== null && typeof rawComment !== "string") {
    return NextResponse.json({ error: "comment must be a string" }, { status: 400 });
  }
  const comment = typeof rawComment === "string" ? rawComment.trim() : "";

  const [sprint] = await db
    .select({
      id: sprints.id,
      projectId: sprints.projectId,
      deletedAt: sprints.deletedAt,
      startedAt: sprints.startedAt,
      completedAt: sprints.completedAt,
    })
    .from(sprints)
    .where(eq(sprints.id, sprintId))
    .limit(1);
  if (!sprint || sprint.deletedAt) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }
  if (sprint.completedAt) {
    return NextResponse.json({ error: "This sprint is completed — reopen it before adding work" }, { status: 400 });
  }
  // No silent scope change: adding to a sprint that has already started must
  // say why — the reason lands on the card and in the sprint report. Planned
  // sprints are still just planning; no reason needed there.
  if (sprint.startedAt && !comment) {
    return NextResponse.json(
      { error: "This sprint has started — a reason for the scope addition is required." },
      { status: 400 }
    );
  }
  const addedComment = sprint.startedAt ? comment : null;

  const session = await getServerSession(authOptions);
  const addedByName = session?.user?.name?.trim() || null;

  // Fresh rows insert; a row that exists only because it was soft-removed
  // from this (active) sprint is revived as a NEW scope addition: removal
  // fields cleared, committed reset to false, added_at/by/comment re-stamped.
  // The WHERE guard keeps the upsert from touching a live row (re-adding an
  // already-present issue stays a silent no-op).
  await db.execute(sql`
    INSERT INTO sprint_items (sprint_id, issue_id, added_by, added_by_name, added_comment)
    VALUES ${sql.join(
      issueIds.map((issueId: string) => sql`(${sprintId}, ${issueId}, ${user.id}, ${addedByName}, ${addedComment})`),
      sql`, `
    )}
    ON CONFLICT (sprint_id, issue_id) DO UPDATE SET
      removed_at = NULL, removed_by = NULL, removed_by_name = NULL, removed_comment = NULL,
      committed = false,
      added_by = EXCLUDED.added_by, added_by_name = EXCLUDED.added_by_name,
      added_comment = EXCLUDED.added_comment, added_at = now()
    WHERE sprint_items.removed_at IS NOT NULL
  `);

  revalidateTag("sprints", "max");
  revalidateTag(`project:${sprint.projectId}`, "max");

  const updated = await fetchSprintById(sprintId);
  if (!updated) {
    return NextResponse.json({ error: "Sprint could not be loaded" }, { status: 500 });
  }
  return NextResponse.json({ sprint: updated } satisfies SprintItemsResponse);
}

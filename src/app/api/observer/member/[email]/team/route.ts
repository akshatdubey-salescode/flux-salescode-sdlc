import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { observerBoards } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { hasMinRole } from "@/lib/auth/types";
import { ensureMemberJiraAccountId } from "@/lib/jira/identity";
import { loadKekaDirectory } from "@/lib/keka/directory";
import { provisionSingleManager } from "@/lib/observer/provisioning";

type Params = { params: Promise<{ email: string }> };

export type MemberTeamInfo = {
  boardId: string | null;
  kekaReportCount: number;
};

/** Most-recent board this email manages (as designated manager or creator). */
async function findOwnedBoardId(email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: observerBoards.id })
    .from(observerBoards)
    .where(
      sql`lower(${observerBoards.managerEmail}) = ${email} OR lower(${observerBoards.createdBy}) = ${email}`
    )
    .orderBy(desc(observerBoards.updatedAt))
    .limit(1);
  return row?.id ?? null;
}

/** Resolver: is this member a manager, and do they already have a team? */
export async function GET(_req: Request, { params }: Params) {
  try {
    await requireAuth();
    const email = decodeURIComponent((await params).email).toLowerCase();

    const [boardId, dir] = await Promise.all([
      findOwnedBoardId(email),
      loadKekaDirectory(),
    ]);

    return NextResponse.json({
      boardId,
      kekaReportCount: dir.directReports(email).length,
    } satisfies MemberTeamInfo);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

/**
 * Build a team for this manager on demand from their Keka direct reports.
 * Restricted to the manager themselves or a superuser. Returns the existing
 * board if one already exists (idempotent). Not tagged with a provision-run id
 * — these ad-hoc builds aren't part of a reversible bulk run.
 */
export async function POST(_req: Request, { params }: Params) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = decodeURIComponent((await params).email).toLowerCase();

  if (user.email.toLowerCase() !== email && !hasMinRole(user.role, "SUPERUSER")) {
    return NextResponse.json(
      { error: "You can only build your own team." },
      { status: 403 }
    );
  }

  try {
    const existing = await findOwnedBoardId(email);
    if (existing) return NextResponse.json({ boardId: existing }, { status: 200 });

    const dir = await loadKekaDirectory();
    const reports = dir.directReports(email);
    if (reports.length === 0) {
      return NextResponse.json(
        { error: "This person has no direct reports in Keka." },
        { status: 400 }
      );
    }

    const managerEntry = dir.get(email);
    const managerName = managerEntry?.displayName ?? email;
    const members = reports
      .map((r) => ({
        email: (r.email ?? "").toLowerCase(),
        name: r.displayName ?? r.email ?? "Unknown",
      }))
      .filter((m) => m.email.length > 0);

    const result = await db.transaction((tx) =>
      provisionSingleManager(tx, {
        managerEmail: email,
        managerName,
        boardName: `${managerName}'s Team`,
        createdBy: user.id,
        provisionRunId: null,
        members,
      })
    );

    if (!result) {
      // A board appeared between the check and the insert — return it.
      const raced = await findOwnedBoardId(email);
      return NextResponse.json({ boardId: raced }, { status: 200 });
    }

    for (const id of result.memberIds) void ensureMemberJiraAccountId(id);

    revalidateTag("boards", "max");
    return NextResponse.json({ boardId: result.boardId }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

// Provisioning Team Pulse boards from the Keka org hierarchy.
//
// The org tree is already synced into keka_employees and exposed by
// KekaDirectory. This turns "manager → direct reports" into proposed Observer
// Boards. Two guarantees baked in here so a run can never harm existing data:
//
//   1. PURELY ADDITIVE — we only INSERT boards/members; nothing existing is
//      ever updated or deleted by provisioning.
//   2. SKIP-NOT-OVERWRITE — a manager who already has a board (matched by
//      managerEmail OR createdBy, case-insensitively) is left untouched. The
//      skip is re-checked inside the commit transaction so concurrent/repeat
//      runs stay idempotent.
//
// buildProvisionProposal() is SELECT-only (safe to call on every page render).
// provisionSingleManager() is the only writer and is shared by the bulk commit
// action and the Part-B "build this manager's team on demand" route.

import { or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { loadKekaDirectory } from "@/lib/keka/directory";

export type ProposedMember = {
  email: string;
  name: string;
  // Whether this report is linked to a Flux user (informational hint in the
  // preview — non-Flux employees are still valid board members).
  isFluxUser: boolean;
};

export type ProposedBoard = {
  managerEmail: string;
  managerName: string;
  // The manager's Keka department (used for the provision-screen filter); null
  // when the manager has no department on their Keka record.
  department: string | null;
  boardName: string;
  members: ProposedMember[];
  // True when this manager already has a board — shown in the preview and
  // excluded from creation.
  skipped: boolean;
  existingBoardId?: string;
};

export type ProvisionProposal = {
  boards: ProposedBoard[];
  totalManagers: number; // managers that would get a NEW board
  totalMembers: number; // members across those new boards
  skippedCount: number;
};

// The transaction handle type, derived from db.transaction so callers can pass
// either `db` or a `tx` without importing drizzle internals.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

/**
 * Compute the full provisioning proposal from the live Keka directory.
 * SELECT-only — writes nothing. One board per manager who has ≥1 direct report,
 * seeded with those direct reports; managers who already own a board are marked
 * `skipped` with a link to the existing board.
 */
export async function buildProvisionProposal(): Promise<ProvisionProposal> {
  const dir = await loadKekaDirectory();

  // Every email that already "owns" a board, as manager or creator. One scan;
  // matched case-insensitively because manual boards may store managerEmail in
  // mixed case (the create route doesn't lowercase it). createdBy is always a
  // lowercased user id.
  const existing = await db
    .select({
      id: observerBoards.id,
      managerEmail: observerBoards.managerEmail,
      createdBy: observerBoards.createdBy,
    })
    .from(observerBoards);

  const existingBoardByEmail = new Map<string, string>();
  for (const b of existing) {
    if (b.managerEmail) {
      const k = b.managerEmail.toLowerCase();
      if (!existingBoardByEmail.has(k)) existingBoardByEmail.set(k, b.id);
    }
    if (b.createdBy) {
      const k = b.createdBy.toLowerCase();
      if (!existingBoardByEmail.has(k)) existingBoardByEmail.set(k, b.id);
    }
  }

  const boards: ProposedBoard[] = [];
  let totalMembers = 0;
  let skippedCount = 0;

  for (const managerEmail of dir.managerEmails()) {
    const reports = dir.directReports(managerEmail);
    if (reports.length === 0) continue; // not actually a manager

    const managerEntry = dir.get(managerEmail);
    const managerName = managerEntry?.displayName ?? managerEmail;
    const department = managerEntry?.department ?? null;

    const members: ProposedMember[] = reports
      .map((r) => ({
        email: (r.email ?? "").toLowerCase(),
        name: r.displayName ?? r.email ?? "Unknown",
        isFluxUser: r.userId != null,
      }))
      .filter((m) => m.email.length > 0);
    if (members.length === 0) continue;

    const existingBoardId = existingBoardByEmail.get(managerEmail.toLowerCase());
    const skipped = existingBoardId !== undefined;
    if (skipped) skippedCount++;
    else totalMembers += members.length;

    boards.push({
      managerEmail: managerEmail.toLowerCase(),
      managerName,
      department,
      boardName: `${managerName}'s Team`,
      members,
      skipped,
      existingBoardId,
    });
  }

  // Actionable boards first, then alphabetical by manager.
  boards.sort(
    (a, b) =>
      Number(a.skipped) - Number(b.skipped) ||
      a.managerName.localeCompare(b.managerName)
  );

  return {
    boards,
    totalManagers: boards.filter((b) => !b.skipped).length,
    totalMembers,
    skippedCount,
  };
}

export type ProvisionedBoard = {
  boardId: string;
  managerEmail: string;
  membersCreated: number;
  // Ids of members that were actually inserted (for Jira-accountId backfill).
  memberIds: string[];
};

/**
 * Create ONE board for a manager and add the given members. The only writer.
 *
 * - Re-checks "already has a board" inside the caller's transaction and returns
 *   null when one exists (idempotent across repeat/concurrent runs).
 * - `createdBy` is the acting user's id; the manager gains management rights via
 *   `managerEmail` (see the members route auth), so the manager need not be a
 *   Flux user.
 * - `provisionRunId` tags the board for precise rollback; pass null for ad-hoc
 *   single builds (Part B) that aren't part of a bulk run.
 * - Member inserts use onConflictDoNothing on unique(boardId,email): no dupes.
 *
 * Does NOT resolve Jira accountIds — the caller fires ensureMemberJiraAccountId
 * for each returned memberId AFTER the transaction commits (a slow Jira lookup
 * must never hold a DB transaction open).
 */
export async function provisionSingleManager(
  tx: DbOrTx,
  opts: {
    managerEmail: string;
    managerName: string;
    boardName: string;
    createdBy: string;
    provisionRunId: string | null;
    members: { email: string; name: string }[];
  }
): Promise<ProvisionedBoard | null> {
  const managerEmail = opts.managerEmail.toLowerCase();

  const existing = await tx
    .select({ id: observerBoards.id })
    .from(observerBoards)
    .where(
      or(
        sql`lower(${observerBoards.managerEmail}) = ${managerEmail}`,
        sql`lower(${observerBoards.createdBy}) = ${managerEmail}`
      )
    )
    .limit(1);
  if (existing.length > 0) return null; // already has a board → skip

  const [board] = await tx
    .insert(observerBoards)
    .values({
      name: opts.boardName.trim() || `${opts.managerName}'s Team`,
      managerName: opts.managerName,
      managerEmail,
      createdBy: opts.createdBy,
      provisionRunId: opts.provisionRunId,
    })
    .returning({ id: observerBoards.id });

  const rows = opts.members
    .map((m) => ({ email: m.email.trim().toLowerCase(), name: m.name.trim() }))
    .filter((m) => m.email.length > 0 && m.name.length > 0)
    .map((m) => ({ boardId: board.id, name: m.name, email: m.email }));

  let memberIds: string[] = [];
  if (rows.length > 0) {
    const inserted = await tx
      .insert(observerBoardMembers)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: observerBoardMembers.id });
    memberIds = inserted.map((r) => r.id);
  }

  return {
    boardId: board.id,
    managerEmail,
    membersCreated: memberIds.length,
    memberIds,
  };
}

// Reconcile existing Team Pulse boards against the live Keka directory.
//
// Provisioning is add-only for new boards (see provisioning.ts). This covers
// the other half: boards that already exist drift when reporting lines change.
// New direct reports never appear and leavers stay listed.
//
// Policy (per superuser decision):
//   ADD-ONLY — insert missing Keka direct reports into their manager's board.
//   Never remove. Manual additions are always kept.
// SELECT-only proposal, writer inserts with onConflictDoNothing.

import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { loadKekaDirectory } from "@/lib/keka/directory";

export type ReconcileMissingMember = {
  email: string;
  name: string;
  isFluxUser: boolean;
};

export type ReconcileBoard = {
  boardId: string;
  boardName: string;
  managerEmail: string;
  managerName: string;
  missing: ReconcileMissingMember[];
  memberCount: number;
  reportCount: number;
};

export type ReconcileProposal = {
  boards: ReconcileBoard[];
  totalBoards: number;
  totalMissing: number;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

async function buildProposalForBoards(
  boardRows: { id: string; name: string; managerEmail: string | null; managerName: string | null }[],
): Promise<ReconcileProposal> {
  const dir = await loadKekaDirectory();
  const withManager = boardRows.filter(
    (b): b is typeof b & { managerEmail: string } =>
      !!b.managerEmail && b.managerEmail.trim().length > 0,
  );
  if (withManager.length === 0) {
    return { boards: [], totalBoards: 0, totalMissing: 0 };
  }

  const memberRows = await db
    .select({
      boardId: observerBoardMembers.boardId,
      email: observerBoardMembers.email,
    })
    .from(observerBoardMembers);

  const emailsByBoard = new Map<string, Set<string>>();
  for (const m of memberRows) {
    const key = m.email.toLowerCase();
    const set = emailsByBoard.get(m.boardId);
    if (set) set.add(key);
    else emailsByBoard.set(m.boardId, new Set([key]));
  }

  const boards: ReconcileBoard[] = [];
  for (const b of withManager) {
    const managerEmail = b.managerEmail.toLowerCase();
    const reports = dir.directReports(managerEmail);
    if (reports.length === 0) continue;
    const existing = emailsByBoard.get(b.id) ?? new Set<string>();
    const missing: ReconcileMissingMember[] = reports
      .map((r) => ({
        email: (r.email ?? "").toLowerCase(),
        name: r.displayName ?? r.email ?? "Unknown",
        isFluxUser: r.userId != null,
      }))
      .filter((m) => m.email.length > 0 && !existing.has(m.email));
    if (missing.length === 0) continue;
    const managerEntry = dir.get(managerEmail);
    boards.push({
      boardId: b.id,
      boardName: b.name,
      managerEmail,
      managerName: managerEntry?.displayName ?? b.managerName ?? managerEmail,
      missing,
      memberCount: existing.size,
      reportCount: reports.length,
    });
  }

  boards.sort((a, b) => b.missing.length - a.missing.length || a.managerName.localeCompare(b.managerName));
  return {
    boards,
    totalBoards: boards.length,
    totalMissing: boards.reduce((n, b) => n + b.missing.length, 0),
  };
}

/** Every existing board with a manager that is missing Keka direct reports. */
export async function buildReconcileProposal(): Promise<ReconcileProposal> {
  const boardRows = await db
    .select({
      id: observerBoards.id,
      name: observerBoards.name,
      managerEmail: observerBoards.managerEmail,
      managerName: observerBoards.managerName,
    })
    .from(observerBoards);
  return buildProposalForBoards(boardRows);
}

/** Single-manager lookup for the Himanshu-style case. Null when no fix applies. */
export async function buildReconcileForManager(
  managerEmail: string,
): Promise<ReconcileBoard | null> {
  const key = managerEmail.toLowerCase().trim();
  if (!key) return null;
  const boardRows = await db
    .select({
      id: observerBoards.id,
      name: observerBoards.name,
      managerEmail: observerBoards.managerEmail,
      managerName: observerBoards.managerName,
    })
    .from(observerBoards);
  const owned = boardRows.filter(
    (b) => b.managerEmail?.toLowerCase() === key,
  );
  if (owned.length === 0) return null;
  const proposal = await buildProposalForBoards(owned);
  return proposal.boards[0] ?? null;
}

/**
 * Insert missing members into one board. Add-only: existing rows are never
 * touched. Returns ids of rows actually inserted (for Jira backfill).
 */
export async function addMissingMembers(
  tx: DbOrTx,
  boardId: string,
  members: { email: string; name: string }[],
): Promise<string[]> {
  const dir = await loadKekaDirectory();
  const rows = members
    .map((m) => ({ email: m.email.trim().toLowerCase(), name: m.name.trim() }))
    .filter((m) => m.email.length > 0 && m.name.length > 0)
    // Trust-but-verify: only current Keka employees enter via this path.
    .filter((m) => dir.isActive(m.email))
    .map((m) => ({ boardId, name: m.name, email: m.email }));
  if (rows.length === 0) return [];
  const inserted = await tx
    .insert(observerBoardMembers)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: observerBoardMembers.id });
  return inserted.map((r) => r.id);
}

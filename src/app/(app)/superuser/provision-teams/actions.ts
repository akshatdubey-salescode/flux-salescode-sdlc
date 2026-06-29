"use server";

import { eq, inArray, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { observerBoards, observerBoardProvisionRuns } from "@/lib/db/schema";
import { ensureMemberJiraAccountId } from "@/lib/jira/identity";
import {
  buildProvisionProposal,
  provisionSingleManager,
  type ProvisionProposal,
} from "@/lib/observer/provisioning";

export type ProposalResult =
  | { ok: true; proposal: ProvisionProposal }
  | { ok: false; error: string };

/** Read-only: recompute the live proposal. Writes nothing. */
export async function getProvisionProposal(): Promise<ProposalResult> {
  await requireRole("SUPERUSER");
  try {
    const proposal = await buildProvisionProposal();
    return { ok: true, proposal };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// What the superuser kept in the preview. The server re-derives the authoritative
// proposal and only ever creates boards/members that intersect it — the client
// list can narrow the selection but never widen it.
export type ProvisionSelectionBoard = {
  managerEmail: string;
  boardName: string;
  memberEmails: string[];
};

export type CommitResult =
  | {
      ok: true;
      runId: string | null;
      boardsCreated: number;
      membersCreated: number;
      skipped: number;
    }
  | { ok: false; error: string };

/**
 * The only bulk writer. Creates boards + members for the selected managers in a
 * single transaction, tagged with a fresh provision-run id so the whole run can
 * be rolled back later. Re-derives the proposal server-side and re-checks the
 * "already has a board" skip inside the transaction, so this is safe to re-run.
 */
export async function commitProvision(
  selection: ProvisionSelectionBoard[]
): Promise<CommitResult> {
  const user = await requireRole("SUPERUSER");

  try {
    // Authoritative proposal — never trust the client beyond narrowing.
    const proposal = await buildProvisionProposal();
    const proposedByManager = new Map(
      proposal.boards.map((b) => [b.managerEmail.toLowerCase(), b])
    );

    // Resolve each selected manager against the proposal: drop unknown/skipped
    // managers and keep only members that the proposal actually lists.
    const toCreate = selection
      .map((sel) => {
        const proposed = proposedByManager.get(sel.managerEmail.toLowerCase());
        if (!proposed || proposed.skipped) return null;
        const allowed = new Set(proposed.members.map((m) => m.email.toLowerCase()));
        const members = proposed.members.filter((m) =>
          sel.memberEmails.some((e) => e.toLowerCase() === m.email.toLowerCase())
        );
        // Fall back to all proposed members if the selection sent none (e.g. a
        // board ticked with its member list collapsed).
        const finalMembers = members.length > 0 ? members : proposed.members;
        return {
          managerEmail: proposed.managerEmail,
          managerName: proposed.managerName,
          boardName: sel.boardName?.trim() || proposed.boardName,
          members: finalMembers
            .filter((m) => allowed.has(m.email.toLowerCase()))
            .map((m) => ({ email: m.email, name: m.name })),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (toCreate.length === 0) {
      return { ok: true, runId: null, boardsCreated: 0, membersCreated: 0, skipped: 0 };
    }

    const { runId, boardsCreated, membersCreated, skipped, memberIds } =
      await db.transaction(async (tx) => {
        const [run] = await tx
          .insert(observerBoardProvisionRuns)
          .values({ triggeredBy: user.id, source: "keka_direct_reports" })
          .returning({ id: observerBoardProvisionRuns.id });

        let boards = 0;
        let members = 0;
        let skip = 0;
        const ids: string[] = [];

        for (const item of toCreate) {
          const result = await provisionSingleManager(tx, {
            managerEmail: item.managerEmail,
            managerName: item.managerName,
            boardName: item.boardName,
            createdBy: user.id,
            provisionRunId: run.id,
            members: item.members,
          });
          if (!result) {
            skip++; // a board appeared between preview and commit
            continue;
          }
          boards++;
          members += result.membersCreated;
          ids.push(...result.memberIds);
        }

        if (boards === 0) {
          // Nothing got created (all raced/skipped) — don't leave an empty run.
          await tx
            .delete(observerBoardProvisionRuns)
            .where(eq(observerBoardProvisionRuns.id, run.id));
          return { runId: null, boardsCreated: 0, membersCreated: 0, skipped: skip, memberIds: [] };
        }

        await tx
          .update(observerBoardProvisionRuns)
          .set({ boardsCreated: boards, membersCreated: members })
          .where(eq(observerBoardProvisionRuns.id, run.id));

        return { runId: run.id, boardsCreated: boards, membersCreated: members, skipped: skip, memberIds: ids };
      });

    // Resolve Jira accountIds out-of-band (same fire-and-forget as the manual
    // member-add route) so a slow Jira lookup never holds the transaction.
    for (const id of memberIds) void ensureMemberJiraAccountId(id);

    revalidateTag("boards", "max");
    return { ok: true, runId, boardsCreated, membersCreated, skipped };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type RollbackResult =
  | { ok: true; deletedBoards: number }
  | { ok: false; error: string };

/**
 * Undo exactly one provision run: delete the boards it created (cascade removes
 * their members) and nothing else, then mark the run rolled back. Boards with a
 * NULL provision_run_id — every hand-made board — are structurally untouchable.
 */
export async function rollbackProvision(runId: string): Promise<RollbackResult> {
  await requireRole("SUPERUSER");

  try {
    const result = await db.transaction(async (tx) => {
      const [run] = await tx
        .select({ status: observerBoardProvisionRuns.status })
        .from(observerBoardProvisionRuns)
        .where(eq(observerBoardProvisionRuns.id, runId))
        .limit(1);
      if (!run) return { ok: false as const, error: "Run not found." };
      if (run.status !== "active") {
        return { ok: false as const, error: "Run was already rolled back." };
      }

      const boards = await tx
        .select({ id: observerBoards.id })
        .from(observerBoards)
        .where(eq(observerBoards.provisionRunId, runId));
      const boardIds = boards.map((b) => b.id);

      if (boardIds.length > 0) {
        await tx
          .delete(observerBoards)
          .where(inArray(observerBoards.id, boardIds));
      }

      await tx
        .update(observerBoardProvisionRuns)
        .set({ status: "rolled_back", rolledBackAt: sql`now()` })
        .where(eq(observerBoardProvisionRuns.id, runId));

      return { ok: true as const, deletedBoards: boardIds.length, boardIds };
    });

    if (!result.ok) return { ok: false, error: result.error };

    revalidateTag("boards", "max");
    for (const id of result.boardIds) revalidateTag(`board:${id}`, "max");
    return { ok: true, deletedBoards: result.deletedBoards };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

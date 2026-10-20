// Removes everything stored for one item's test cases: rounds, cases, reviews,
// sign-offs, stats and files. Used when a wrong sheet or link was submitted. A
// small audit row keeps the fact (who, when, why, counts), never the content.

import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tcCases, tcDeletions, tcFiles, tcReviewComments, tcRounds, tcSets, tcSignoffs } from "@/lib/db/schema";
import { getStore } from "@/lib/storage";
import type { IssueRef } from "./service";

export type DeleteResult = {
  ok: true;
  counts: { rounds: number; cases: number; files: number; signoffs: number; comments: number };
  /** Stored files that could not be removed from the bucket (their keys are in the audit row). */
  storageFailures: number;
};

export async function deleteItemTestCases(args: {
  issue: IssueRef;
  actor: { email: string; name: string | null };
  reason: string;
}): Promise<DeleteResult | { ok: false; status: number; error: string }> {
  const [set] = await db.select({ id: tcSets.id }).from(tcSets).where(eq(tcSets.issueId, args.issue.id)).limit(1);
  if (!set) return { ok: false, status: 404, error: "This item has no test cases to delete." };

  const [rounds] = await db.select({ n: count() }).from(tcRounds).where(eq(tcRounds.setId, set.id));
  const [cases] = await db
    .select({ n: count() })
    .from(tcCases)
    .innerJoin(tcRounds, eq(tcRounds.id, tcCases.roundId))
    .where(eq(tcRounds.setId, set.id));
  const [signoffs] = await db.select({ n: count() }).from(tcSignoffs).where(eq(tcSignoffs.setId, set.id));
  const [comments] = await db
    .select({ n: count() })
    .from(tcReviewComments)
    .innerJoin(tcRounds, eq(tcRounds.id, tcReviewComments.roundId))
    .where(eq(tcRounds.setId, set.id));
  const files = await db.select({ key: tcFiles.storageKey }).from(tcFiles).where(eq(tcFiles.setId, set.id));
  const keys = files.map((f) => f.key);

  const counts = {
    rounds: Number(rounds?.n ?? 0),
    cases: Number(cases?.n ?? 0),
    files: keys.length,
    signoffs: Number(signoffs?.n ?? 0),
    comments: Number(comments?.n ?? 0),
  };

  // Database first, in one transaction: the set's foreign keys cascade to everything under it.
  // Doing the files first could leave rows pointing at objects that no longer exist.
  const auditId = await db.transaction(async (tx) => {
    const [audit] = await tx
      .insert(tcDeletions)
      .values({
        issueId: args.issue.id,
        jiraKey: args.issue.jiraKey,
        projectId: args.issue.projectId,
        reason: args.reason,
        deletedBy: args.actor.email,
        deletedByName: args.actor.name,
        roundCount: counts.rounds,
        caseCount: counts.cases,
        fileCount: counts.files,
        signoffCount: counts.signoffs,
        commentCount: counts.comments,
        storageKeys: keys,
      })
      .returning({ id: tcDeletions.id });
    await tx.delete(tcSets).where(eq(tcSets.id, set.id));
    return audit.id;
  });

  // Then the stored files, best effort: a failure here must not undo the deletion.
  let failures = 0;
  const store = getStore();
  for (const key of keys) {
    try {
      await store.delete(key);
    } catch (err) {
      failures++;
      console.error("[test-cases] could not delete stored file", key, err);
    }
  }
  if (failures > 0) await db.update(tcDeletions).set({ storageFailures: failures }).where(eq(tcDeletions.id, auditId));

  return { ok: true, counts, storageFailures: failures };
}

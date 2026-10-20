// Everything that changes an item's review state (commit, decide, override,
// comment, sign-off, delete, recompute) takes ONE lock per item first, so two
// people acting at once are applied one after the other, each seeing the other's
// result, instead of overwriting each other.
//
// It is a Postgres advisory lock held until the transaction ends. The pool is
// small (5), so code inside a locked transaction must use ONLY the transaction's
// own connection, and slow work (uploads, parsing) must happen outside it.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Either the pool or a transaction: both can run the queries the loaders need. */
export type Executor = typeof db | Tx;

/** Postgres' "lock_not_available": waited too long for the item lock. */
export function isLockTimeout(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "55P03" || e?.cause?.code === "55P03";
}

export const BUSY_MESSAGE = "Someone else is updating this item right now. Try again in a moment.";

export async function lockItem(tx: Tx, issueId: string): Promise<void> {
  // A waiter holds one of only 5 connections, so never wait forever: a stalled holder must not drain the pool.
  await tx.execute(sql`set local lock_timeout = '10s'`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tc-item:${issueId}`}, 0))`);
}

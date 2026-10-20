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

export async function lockItem(tx: Tx, issueId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tc-item:${issueId}`}, 0))`);
}

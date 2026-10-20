// The delivery gate: an issue that has test cases cannot be marked delivered
// until a developer or tester has signed off. Issues with no test cases are not
// blocked (they show as "No TCs" instead).

import { count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tcRounds, tcSets, tcSignoffs } from "@/lib/db/schema";

/** Outcomes that claim the work shipped; "pending" and "not_delivered" never need TCs. */
const GATED_STATUSES = new Set(["delivered", "partially_delivered"]);

export const GATE_MESSAGE =
  "This issue has test cases but no developer or tester sign-off yet. Upload a sign-off on its test cases page before marking it delivered.";

export function gateDecision(input: {
  fromStatus: string;
  toStatus: string;
  hasSet: boolean;
  devSigned: boolean;
  testerSigned: boolean;
}): { blocked: false } | { blocked: true; message: string } {
  // Only a real change to a delivered outcome is gated: resaving the same
  // status (e.g. editing the comment) and reverting are always allowed.
  if (input.fromStatus === input.toStatus || !GATED_STATUSES.has(input.toStatus)) return { blocked: false };
  if (!input.hasSet) return { blocked: false };
  if (input.devSigned || input.testerSigned) return { blocked: false };
  return { blocked: true, message: GATE_MESSAGE };
}

export async function checkDeliveryGate(args: {
  issueId: string;
  fromStatus: string;
  toStatus: string;
}): Promise<{ blocked: false } | { blocked: true; message: string }> {
  if (args.fromStatus === args.toStatus || !GATED_STATUSES.has(args.toStatus)) return { blocked: false };

  const [set] = await db.select({ id: tcSets.id }).from(tcSets).where(eq(tcSets.issueId, args.issueId)).limit(1);
  if (!set) return gateDecision({ ...args, hasSet: false, devSigned: false, testerSigned: false });

  // Read the sign-offs themselves, for the NEWEST round, rather than the cached stats: a stats row that is
  // a moment behind (or failed to update) must not let an unsigned resubmission through or block a signed item.
  const [latest] = await db
    .select({ id: tcRounds.id })
    .from(tcRounds)
    .where(eq(tcRounds.setId, set.id))
    .orderBy(desc(tcRounds.roundNo))
    .limit(1);
  const [signed] = latest
    ? await db.select({ n: count() }).from(tcSignoffs).where(eq(tcSignoffs.roundId, latest.id))
    : [{ n: 0 }];
  return gateDecision({ ...args, hasSet: true, devSigned: Number(signed?.n ?? 0) > 0, testerSigned: false });
}

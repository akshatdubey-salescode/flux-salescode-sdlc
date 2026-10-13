// The delivery gate: an issue that has test cases cannot be marked delivered
// until a developer or tester has signed off. Issues with no test cases are not
// blocked (they show as "No TCs" instead).

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tcSetStats, tcSets } from "@/lib/db/schema";
import { recomputeSetStats } from "./stats-service";

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

  let [stats] = await db
    .select({ devSigned: tcSetStats.devSigned, testerSigned: tcSetStats.testerSigned })
    .from(tcSetStats)
    .where(eq(tcSetStats.setId, set.id))
    .limit(1);
  if (!stats) {
    // A set without stats should not happen; compute rather than guess.
    const computed = await recomputeSetStats(set.id);
    stats = { devSigned: !!computed?.dev.signedOff, testerSigned: !!computed?.tester.signedOff };
  }
  return gateDecision({ ...args, hasSet: true, devSigned: stats.devSigned, testerSigned: stats.testerSigned });
}

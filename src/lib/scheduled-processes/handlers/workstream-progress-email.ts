import type { ScheduledProcess } from "@/lib/db/schema";
import { fetchWorkstreamById } from "@/lib/sprints/entries";
import { workstreamHasFinished } from "@/lib/sprints/lifecycle";
import { sendWorkstreamProgressEmail } from "@/lib/sprints/send-progress-email";
import type { ProcessContext, ProcessOutcome } from "../registry";

/**
 * The workstream twin of the sprint progress handler: same schedule table,
 * same transport, one altitude up — the initiative and every sprint in it.
 *
 * Like the sprint one it stores intent, never a rendered snapshot, so each
 * send reports the workstream as it stands that morning. Which sprints are in
 * it is resolved at send time too: a sprint moved into the workstream next
 * month is simply in next month's mail.
 */

/**
 * Appended to the sender's own message on the last send — see
 * workstreamHasFinished for what "last" means here.
 */
const FINAL_NOTE =
  "This is the final scheduled update for this workstream — every sprint in it has now finished, so these updates stop here.";

export async function runWorkstreamProgressEmail(
  row: ScheduledProcess,
  ctx: ProcessContext
): Promise<ProcessOutcome> {
  // Workstreams are hard-deleted (their sprints are released, not deleted),
  // so a missing row is the only "gone" case there is.
  const result = await fetchWorkstreamById(row.targetId);
  if (!result) {
    return {
      status: "skipped",
      detail: "The workstream no longer exists",
      stop: "target_deleted",
    };
  }
  const { workstream, sprints } = result;

  if (row.recipients.length === 0) {
    return { status: "skipped", detail: "No recipients on the schedule" };
  }

  // An emptied workstream has nothing to report — but sprints get moved in
  // after the fact all the time, so this skips tonight rather than retiring
  // the schedule.
  if (sprints.length === 0) {
    return { status: "skipped", detail: "The workstream has no sprints" };
  }

  // "Send once, then stop", exactly as a sprint schedule does: once every
  // sprint in the workstream has finished the report can't change again, so
  // one wrap-up goes out and the schedule retires.
  const isFinal = workstreamHasFinished(sprints, ctx.runOn);
  const message = isFinal ? `${row.message}\n\n${FINAL_NOTE}`.trim() : row.message;

  const sent = await sendWorkstreamProgressEmail({
    workstream,
    sprints,
    recipients: row.recipients,
    subject: row.subject,
    message,
    // No session at midnight — the name was denormalized onto the schedule
    // when it was created, exactly so this line still reads correctly.
    senderName: row.createdByName?.trim() || row.createdBy,
    appUrl: ctx.appUrl,
  });

  return {
    status: "sent",
    subject: sent.subject,
    recipientCount: sent.recipientCount,
    messageIds: sent.messageIds,
    stop: isFinal ? "target_closed" : undefined,
  };
}

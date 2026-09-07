import type { ScheduledProcess } from "@/lib/db/schema";
import { fetchSprintById } from "@/lib/sprints/entries";
import { sendSprintProgressEmail } from "@/lib/sprints/send-progress-email";
import type { ProcessContext, ProcessOutcome } from "../registry";

/**
 * The scheduled twin of the compose dialog's Send button: same builders, same
 * transport, recomputed from live data at send time. A schedule stores intent
 * (who, what note, how often) — never a rendered snapshot — so a Monday mail
 * reports Monday's sprint, not the state it was scheduled in.
 */

/**
 * Appended to the sender's own message on the last send. The sprint is over,
 * so this update would otherwise look like just another weekly one — and the
 * schedule stops right after, which recipients deserve to be told.
 */
const FINAL_NOTE =
  "This is the final scheduled update for this sprint — it has now closed, so these updates stop here.";

export async function runSprintProgressEmail(
  row: ScheduledProcess,
  ctx: ProcessContext
): Promise<ProcessOutcome> {
  // Returns null for a soft-deleted sprint too, so this covers both "gone"
  // cases in one check.
  const sprint = await fetchSprintById(row.targetId);
  if (!sprint) {
    return {
      status: "skipped",
      detail: "The sprint no longer exists",
      stop: "target_deleted",
    };
  }

  if (row.recipients.length === 0) {
    return { status: "skipped", detail: "No recipients on the schedule" };
  }

  // "Send once, then stop": a closed sprint (or one whose end date has passed)
  // gets one wrap-up send and the schedule retires. Without this a finished
  // sprint would keep mailing an unchanging report every week.
  const isFinal = sprint.completedAt !== null || sprint.endDate < ctx.runOn;
  const message = isFinal ? `${row.message}\n\n${FINAL_NOTE}`.trim() : row.message;

  const sent = await sendSprintProgressEmail({
    sprint,
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

import type { SprintWithItems, SprintItemRow } from "@/lib/sprints/entries";

// The plain-text sprint update — shared by the card's "Copy update" button
// and the stakeholder-email dialog (where it prefills the editable body, so
// what's shown is exactly what's sent).

export const PROGRESS_LABELS: Record<SprintItemRow["progress"], string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

/** The phase text for a sprint, with the past-end nuance the card shows. */
export function sprintPhaseText(sprint: SprintWithItems, today?: string): string {
  if (sprint.completedAt) return "Completed";
  if (!sprint.startedAt) return "Planned — not started";
  if (today && today > sprint.endDate) return "Active — past end date";
  return "Active";
}

/** Plain-text sprint update for pasting into Slack/WhatsApp groups — mirrors buildDeliveryAlertMessage's shape on the deliveries tab. */
export function buildSprintUpdateMessage(sprint: SprintWithItems, phaseText: string): string {
  const r = sprint.rollup;
  const dateLabel = new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  const pct = r.committed > 0 ? Math.round((r.committedDone / r.committed) * 100) : 0;
  const lines: string[] = [
    `🏃 ${sprint.name} — ${sprint.startDate} → ${sprint.endDate} (${phaseText}) — as of ${dateLabel}`,
  ];
  if (sprint.goal) lines.push(`Goal: ${sprint.goal}`);
  if (sprint.startedAt) {
    lines.push(
      `Committed ${r.committed} · Completed ${r.committedDone} of ${r.committed} (${pct}%)` +
        (r.addedAfterStart > 0 ? ` · Added after start ${r.addedAfterStart}` : "") +
        (r.removed > 0 ? ` · Removed ${r.removed}` : "") +
        (r.carriedOver > 0 ? ` · Carried in ${r.carriedOver}` : "")
    );
  }
  lines.push(`Overall: ${r.done} done · ${r.inProgress} in progress · ${r.todo} to do (of ${r.total})`);
  for (const item of sprint.items) {
    const scope = !sprint.startedAt ? "" : item.committed ? "" : " *added mid-sprint*";
    lines.push(`  • ${item.jiraKey} — ${item.summary} [${PROGRESS_LABELS[item.progress]}]${scope}`);
  }
  if (sprint.removedItems.length > 0) {
    lines.push(`Removed after start:`);
    for (const item of sprint.removedItems) {
      lines.push(`  • ${item.jiraKey} — ${item.summary}${item.removedComment ? ` ("${item.removedComment}")` : ""}`);
    }
  }
  return lines.join("\n");
}

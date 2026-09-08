"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  RiDeleteBinLine,
  RiGroupLine,
  RiHistoryLine,
  RiPauseCircleLine,
  RiPlayCircleLine,
  RiSendPlaneLine,
  RiStopCircleLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  describeCadence,
  processLabel,
  processTargetNoun,
  scheduleState,
  stopReasonLabel,
  type ScheduleRow,
} from "@/lib/scheduled-processes/types";
import { RecipientsEditor } from "./recipients-editor";
import { RunHistory } from "./run-history";

/**
 * The list of standing schedules, shared by the sprint and workstream email
 * dialogs and the superuser view so "what is scheduled, when does it next go,
 * did the last one work" reads identically wherever it's asked.
 *
 * Every row carries its last attempt. That's the whole reason the runs table
 * exists: a list that only showed intent could never answer "did Monday's
 * actually go out?".
 */

/** "Mon 14 Sep" from a plain YYYY-MM-DD, parsed as a calendar day (no timezone shift). */
function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function LastRun({ row }: { row: ScheduleRow }) {
  if (!row.lastRun) {
    return <span className="text-muted-foreground">Not run yet</span>;
  }
  const { status, runOn, recipientCount, detail, trigger } = row.lastRun;
  const when = `${formatDay(runOn)}${trigger === "manual" ? " (manual)" : ""}`;
  if (status === "sent") {
    return (
      <span className="text-muted-foreground">
        Sent {when} to {recipientCount} recipient{recipientCount === 1 ? "" : "s"}
      </span>
    );
  }
  if (status === "running") {
    return <span className="text-muted-foreground">Running since {when}</span>;
  }
  return (
    <span className={status === "failed" ? "text-destructive" : "text-amber-600 dark:text-amber-500"}>
      {status === "failed" ? "Failed" : "Skipped"} {when}
      {detail ? ` — ${detail}` : ""}
    </span>
  );
}

export function ScheduleList({
  schedules,
  onChanged,
  /** Superuser view: name the sprint or workstream each schedule belongs to. */
  showTarget = false,
  emptyLabel = "No schedules yet.",
}: {
  schedules: ScheduleRow[];
  onChanged: () => void;
  showTarget?: boolean;
  emptyLabel?: string;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  async function act(id: string, run: () => Promise<Response>, successMessage: string) {
    setBusyId(id);
    try {
      const res = await run();
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "That didn't work — try again");
        return;
      }
      toast.success(successMessage);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  const patch = (id: string, action: "pause" | "resume") =>
    fetch(`/api/scheduled-processes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });

  if (schedules.length === 0) {
    return <p className="text-[11px] text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {schedules.map((row) => {
        const state = scheduleState(row);
        const busy = busyId === row.id;
        return (
          <div key={row.id} className="space-y-1.5 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {showTarget && (
                <span className="text-xs font-medium">
                  {row.targetName ?? `(deleted ${processTargetNoun(row.process)})`}
                </span>
              )}
              <span className="text-xs font-medium">{describeCadence(row)}</span>
              {state === "live" && (
                <Badge variant="outline" className="text-emerald-700 dark:text-emerald-400">
                  Next {formatDay(row.nextRunOn)}
                </Badge>
              )}
              {state === "paused" && <Badge variant="secondary">Paused</Badge>}
              {state === "stopped" && (
                <Badge variant="outline" className="text-muted-foreground">
                  Stopped — {stopReasonLabel(row.stopReason, row.process) ?? "no longer runs"}
                </Badge>
              )}
              {showTarget && (
                <span className="text-[11px] text-muted-foreground">{processLabel(row.process)}</span>
              )}
            </div>

            <p className="truncate text-[11px] text-muted-foreground" title={row.subject}>
              {row.subject}
            </p>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              {/* A stopped schedule will never send again, so its recipient
                  list is history to read, not a list to edit. */}
              {state === "stopped" ? (
                <span
                  className="inline-flex items-center gap-1 text-muted-foreground"
                  title={row.recipients.join(", ")}
                >
                  <RiGroupLine className="size-3" />
                  {row.recipients.length} recipient{row.recipients.length === 1 ? "" : "s"}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingId(editingId === row.id ? null : row.id)}
                  className="inline-flex items-center gap-1 text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                  title={row.recipients.join(", ")}
                >
                  <RiGroupLine className="size-3" />
                  {row.recipients.length} recipient{row.recipients.length === 1 ? "" : "s"}
                </button>
              )}
              <span className="text-muted-foreground">·</span>
              <LastRun row={row} />
              {row.endsOn && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">Ends {formatDay(row.endsOn)}</span>
                </>
              )}
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                by {row.createdByName ?? row.createdBy}
              </span>
            </div>

            {editingId === row.id && (
              <RecipientsEditor
                scheduleId={row.id}
                recipients={row.recipients}
                onSaved={() => {
                  setEditingId(null);
                  onChanged();
                }}
                onCancel={() => setEditingId(null)}
              />
            )}

            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[11px]"
                disabled={busy}
                onClick={() =>
                  act(
                    row.id,
                    () => fetch(`/api/scheduled-processes/${row.id}/run`, { method: "POST" }),
                    "Sent now — the schedule keeps its next run unchanged"
                  )
                }
              >
                <RiSendPlaneLine className="size-3" /> Send now
              </Button>
              {state === "live" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px]"
                  disabled={busy}
                  onClick={() => act(row.id, () => patch(row.id, "pause"), "Schedule paused")}
                >
                  <RiPauseCircleLine className="size-3" /> Pause
                </Button>
              )}
              {state === "paused" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px]"
                  disabled={busy}
                  onClick={() =>
                    act(row.id, () => patch(row.id, "resume"), "Schedule resumed")
                  }
                >
                  <RiPlayCircleLine className="size-3" /> Resume
                </Button>
              )}
              {state === "stopped" && (
                <span className="inline-flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
                  <RiStopCircleLine className="size-3" /> Finished
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px]"
                onClick={() => setHistoryId(historyId === row.id ? null : row.id)}
              >
                <RiHistoryLine className="size-3" />
                {historyId === row.id ? "Hide history" : "History"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px] text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() =>
                  act(
                    row.id,
                    () => fetch(`/api/scheduled-processes/${row.id}`, { method: "DELETE" }),
                    "Schedule deleted"
                  )
                }
              >
                <RiDeleteBinLine className="size-3" /> Delete
              </Button>
            </div>

            {historyId === row.id && <RunHistory scheduleId={row.id} />}
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useState } from "react";
import { RiCalendarLine, RiCheckLine, RiErrorWarningLine, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { CalendarSyncChunk } from "@/app/api/superuser/calendar-sync/route";

type SyncProgress = Omit<CalendarSyncChunk, "type">;

export function CalendarSyncPanel({ connectedUsers }: { connectedUsers: number }) {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncConfirmText, setSyncConfirmText] = useState("");

  async function handleSync() {
    setFetchError(null);
    setProgress(null);
    setIsDone(false);
    setIsRunning(true);

    try {
      const res = await fetch("/api/superuser/calendar-sync", { method: "POST" });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setFetchError((data as { error?: string }).error ?? "Sync failed.");
        setIsRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as CalendarSyncChunk;
            setProgress({ ...chunk });
            if (chunk.type === "done") setIsDone(true);
          } catch {
            // ignore malformed lines
          }
        }
      }
    } catch {
      setFetchError("An unexpected error occurred.");
    }

    setIsRunning(false);
  }

  const pct = progress && progress.totalUsers > 0
    ? Math.round((progress.processed / progress.totalUsers) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Google Calendar Sync
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {connectedUsers === 0
                ? "No users have connected Google Calendar."
                : `${connectedUsers} user${connectedUsers !== 1 ? "s" : ""} with Google Calendar connected.`}
            </p>
          </div>

          {isRunning ? (
            <Button disabled className="gap-2 shrink-0">
              <RiLoader4Line className="size-4 animate-spin" />
              Syncing…
            </Button>
          ) : (
            <AlertDialog
              open={syncDialogOpen}
              onOpenChange={(o) => { setSyncDialogOpen(o); if (!o) setSyncConfirmText(""); }}
            >
              <AlertDialogTrigger asChild>
                <Button disabled={connectedUsers === 0} className="gap-2 shrink-0">
                  <RiCalendarLine className="size-4" />
                  {isDone ? "Sync Again" : "Run Sync"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Run calendar sync?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Syncing is an expensive operation — it fetches the latest Google Calendar
                    events for all {connectedUsers} connected user{connectedUsers !== 1 ? "s" : ""}{" "}
                    and may take up to a minute. Use carefully, or perform this operation in the
                    local development environment.
                    <br /><br />
                    Type <span className="font-mono font-medium text-foreground">sync calendar</span> to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input
                  placeholder="sync calendar"
                  value={syncConfirmText}
                  onChange={(e) => setSyncConfirmText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && syncConfirmText === "sync calendar") {
                      setSyncDialogOpen(false);
                      setSyncConfirmText("");
                      handleSync();
                    }
                  }}
                  autoFocus
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={syncConfirmText !== "sync calendar"}
                    onClick={() => { setSyncDialogOpen(false); setSyncConfirmText(""); handleSync(); }}
                  >
                    Run Sync
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* Live progress while running */}
        {isRunning && progress && (
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1.5">
                <RiLoader4Line className="size-3.5 animate-spin shrink-0" />
                Processing user {progress.processed} of {progress.totalUsers}…
              </span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <Progress value={pct} className="h-1.5" />
            <LiveStats progress={progress} />
          </div>
        )}

        {/* Spinner before first chunk arrives */}
        {isRunning && !progress && (
          <div className="flex items-center gap-2 text-xs text-zinc-500 pt-3 border-t border-zinc-100 dark:border-zinc-800">
            <RiLoader4Line className="size-3.5 animate-spin shrink-0" />
            Starting sync…
          </div>
        )}

        {fetchError && (
          <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <RiErrorWarningLine className="size-3.5 shrink-0" />
            {fetchError}
          </div>
        )}

        {isDone && progress && !isRunning && <SyncResultSummary result={progress} />}
      </div>
    </div>
  );
}

function LiveStats({ progress }: { progress: SyncProgress }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {[
        { label: "Synced", value: progress.ok, color: "text-green-600 dark:text-green-400" },
        { label: "Skipped", value: progress.skipped, color: "" },
        { label: "Events", value: progress.eventsUpserted, color: "text-blue-600 dark:text-blue-400" },
        { label: "Errors", value: progress.errors.length, color: progress.errors.length > 0 ? "text-red-600 dark:text-red-400" : "" },
      ].map(({ label, value, color }) => (
        <div key={label} className="rounded-md bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</p>
          <p className={cn("text-base font-semibold tabular-nums leading-tight mt-0.5", color || "text-zinc-800 dark:text-zinc-200")}>
            {value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

function SyncResultSummary({ result }: { result: SyncProgress }) {
  const hasErrors = result.errors.length > 0;

  return (
    <div className="pt-1 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
        <RiCheckLine className="size-3.5 shrink-0" />
        Sync complete
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Synced", value: result.ok },
          { label: "Skipped", value: result.skipped },
          { label: "Events upserted", value: result.eventsUpserted },
          { label: "Deletions", value: result.deletions },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-md bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              {label}
            </p>
            <p className="text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-200 leading-tight mt-0.5">
              {value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {hasErrors && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 p-3 space-y-1.5">
          <p className="text-xs font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5">
            <RiErrorWarningLine className="size-3.5 shrink-0" />
            {result.errors.length} user{result.errors.length !== 1 ? "s" : ""} failed
          </p>
          <ul className="space-y-1">
            {result.errors.map(({ userId, error }) => (
              <li key={userId} className="text-[11px] text-red-600 dark:text-red-400">
                <span className="font-mono">{userId}</span>
                {" — "}
                {error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

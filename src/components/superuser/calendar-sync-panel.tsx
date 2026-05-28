"use client";

import { useState, useTransition } from "react";
import { RiCalendarLine, RiCheckLine, RiErrorWarningLine, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
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

type SyncStats = {
  totalUsers: number;
  ok: number;
  skipped: number;
  errors: { userId: string; error: string }[];
  eventsUpserted: number;
  deletions: number;
};

export function CalendarSyncPanel({ connectedUsers }: { connectedUsers: number }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncStats | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  function handleSync() {
    setResult(null);
    setFetchError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/superuser/calendar-sync", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          setFetchError(data.error ?? "Sync failed.");
          return;
        }
        setResult(data as SyncStats);
      } catch {
        setFetchError("An unexpected error occurred.");
      }
    });
  }

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

          {isPending ? (
            <Button disabled className="gap-2 shrink-0">
              <RiLoader4Line className="size-4 animate-spin" />
              Syncing…
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={connectedUsers === 0} className="gap-2 shrink-0">
                  <RiCalendarLine className="size-4" />
                  {result ? "Sync Again" : "Run Sync"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Run calendar sync?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will fetch the latest Google Calendar events for all{" "}
                    {connectedUsers} connected user{connectedUsers !== 1 ? "s" : ""} and
                    update the event cache. The request runs synchronously and may take
                    up to a minute depending on the number of users.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleSync}>Run Sync</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {isPending && (
          <div className="flex items-center gap-2 text-xs text-zinc-500 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <RiLoader4Line className="size-3.5 animate-spin shrink-0" />
            Syncing calendars for {connectedUsers} user{connectedUsers !== 1 ? "s" : ""}…
          </div>
        )}

        {fetchError && (
          <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <RiErrorWarningLine className="size-3.5 shrink-0" />
            {fetchError}
          </div>
        )}

        {result && !isPending && <SyncResultSummary result={result} />}
      </div>
    </div>
  );
}

function SyncResultSummary({ result }: { result: SyncStats }) {
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
                <span className={cn("font-mono")}>{userId}</span>
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

"use client";

import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiRefreshLine,
} from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Job = {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  totalRepos: number | null;
  syncedRepos: number;
  statsRowsUpserted: number;
  accountsResolved: number;
  errorCount: number;
  errorMessages: string[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

const ACTIVE = (s: string | undefined) => s === "pending" || s === "running";

export function GithubSyncPanel() {
  const [job, setJob] = useState<Job | null>(null);
  const [triggering, setTriggering] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    const res = await fetch("/api/github/sync");
    if (!res.ok) return;
    const data = (await res.json()) as Job | null;
    setJob(data);
    if (!data || !ACTIVE(data.status)) stopPolling();
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(refresh, 5000);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => {
    refresh().then(() => {
      // Resume polling if a job was already running when the page loaded.
      setJob((j) => {
        if (j && ACTIVE(j.status)) startPolling();
        return j;
      });
    });
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSync() {
    setTriggering(true);
    try {
      const res = await fetch("/api/github/sync", { method: "POST" });
      if (res.ok || res.status === 202) {
        await refresh();
        startPolling();
      }
    } finally {
      setTriggering(false);
    }
  }

  const isActive = ACTIVE(job?.status);
  const progress =
    job?.totalRepos && job.totalRepos > 0
      ? Math.round((job.syncedRepos / job.totalRepos) * 100)
      : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-zinc-500">
          {job
            ? job.completedAt
              ? `Last run ${formatDistanceToNow(new Date(job.completedAt), { addSuffix: true })}`
              : "A sync is in progress…"
            : "No sync has run yet."}
        </p>
        <Button onClick={handleSync} disabled={triggering || isActive} className="gap-2 shrink-0">
          <RiRefreshLine className={cn("size-4", (triggering || isActive) && "animate-spin")} />
          {isActive ? "Syncing…" : "Sync GitHub"}
        </Button>
      </div>

      {job && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
          <div className="flex items-center gap-3">
            <StatusIcon status={job.status} />
            <span className="text-sm font-medium capitalize">{job.status}</span>
            <Badge variant="secondary" className="ml-auto tabular-nums">
              {job.totalRepos != null
                ? `${job.syncedRepos} / ${job.totalRepos} repos`
                : `${job.syncedRepos} repos`}
            </Badge>
          </div>

          {(job.status === "running" || job.status === "pending") && (
            progress !== null ? (
              <Progress value={progress} className="h-1" />
            ) : (
              <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full w-1/3 rounded-full bg-blue-500 animate-[indeterminate_1.4s_ease-in-out_infinite]" />
              </div>
            )
          )}
          {job.status === "completed" && (
            <Progress value={100} className="h-1 [&>[data-slot=progress-indicator]]:bg-green-500" />
          )}

          <dl className="grid grid-cols-3 gap-4 text-sm">
            <Stat label="Stat rows" value={job.statsRowsUpserted} />
            <Stat label="People resolved" value={job.accountsResolved} />
            <Stat label="Errors" value={job.errorCount} danger={job.errorCount > 0} />
          </dl>

          {job.errorMessages.length > 0 && (
            <ul className="max-h-40 overflow-auto rounded-md bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400 space-y-1">
              {job.errorMessages.slice(0, 50).map((m, i) => (
                <li key={i} className="font-mono">{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={cn("text-lg font-semibold tabular-nums", danger && "text-red-600 dark:text-red-400")}>
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

function StatusIcon({ status }: { status: Job["status"] }) {
  if (status === "completed") return <RiCheckLine className="size-4 text-green-500" />;
  if (status === "failed") return <RiErrorWarningLine className="size-4 text-red-500" />;
  return <RiLoader4Line className="size-4 text-blue-500 animate-spin" />;
}

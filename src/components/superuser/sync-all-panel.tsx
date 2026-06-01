"use client";

import { useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  RiCheckLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiRefreshLine,
} from "@remixicon/react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Project = {
  id: string;
  name: string;
  jiraProjectKey: string;
  lastSyncedAt: Date | null;
};

type SyncStatus = "idle" | "pending" | "running" | "completed" | "failed" | "skipped";

type ProjectState = {
  status: SyncStatus;
  jobId: string | null;
  syncedCount: number;
  totalIssues: number | null;
  errorCount: number;
};

const INITIAL_STATE = (projects: Project[]): Record<string, ProjectState> =>
  Object.fromEntries(
    projects.map((p) => [
      p.id,
      { status: "idle", jobId: null, syncedCount: 0, totalIssues: null, errorCount: 0 },
    ])
  );

export function SyncAllPanel({ projects }: { projects: Project[] }) {
  const [states, setStates] = useState<Record<string, ProjectState>>(INITIAL_STATE(projects));
  const [selected, setSelected] = useState<Set<string>>(new Set(projects.map((p) => p.id)));
  const [isRunning, setIsRunning] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const abortRef = useRef(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncConfirmText, setSyncConfirmText] = useState("");

  function patch(id: string, update: Partial<ProjectState>) {
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...update } }));
  }

  function toggleProject(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === projects.length ? new Set() : new Set(projects.map((p) => p.id))
    );
  }

  async function interruptibleSleep(ms: number) {
    const step = 100;
    let elapsed = 0;
    while (elapsed < ms) {
      if (abortRef.current) return;
      await new Promise((r) => setTimeout(r, step));
      elapsed += step;
    }
  }

  async function pollUntilDone(projectId: string, jobId: string) {
    for (;;) {
      await interruptibleSleep(5000);
      if (abortRef.current) return;

      const res = await fetch(`/api/sync-jobs/${jobId}`);
      if (!res.ok) continue;

      const job = (await res.json()) as {
        status: string;
        syncedCount: number;
        totalIssues: number | null;
        errorCount: number;
      };

      const status: SyncStatus =
        job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : "running";

      patch(projectId, {
        status,
        syncedCount: job.syncedCount,
        totalIssues: job.totalIssues,
        errorCount: job.errorCount,
      });

      if (job.status === "completed" || job.status === "failed") return;
    }
  }

  async function handleSyncAll() {
    abortRef.current = false;
    setIsRunning(true);

    const queue = projects.filter((p) => selected.has(p.id));

    // Reset only selected projects; mark unselected as skipped for visual clarity
    setStates(
      Object.fromEntries(
        projects.map((p) => [
          p.id,
          selected.has(p.id)
            ? { status: "idle", jobId: null, syncedCount: 0, totalIssues: null, errorCount: 0 }
            : { ...INITIAL_STATE(projects)[p.id], status: "skipped" },
        ])
      )
    );

    for (let i = 0; i < queue.length; i++) {
      if (abortRef.current) break;

      const project = queue[i];
      setActiveIndex(i);
      patch(project.id, { status: "pending" });

      try {
        const res = await fetch(`/api/projects/${project.id}/sync`, { method: "POST" });

        if (!res.ok) {
          patch(project.id, { status: "failed" });
          continue;
        }

        const { jobId } = (await res.json()) as { jobId: string };
        patch(project.id, { status: "running", jobId });
        await pollUntilDone(project.id, jobId);
        if (abortRef.current) {
          patch(project.id, { status: "idle" });
          break;
        }
      } catch {
        patch(project.id, { status: "failed" });
      }
    }

    setIsRunning(false);
    setActiveIndex(null);
  }

  function handleCancel() {
    abortRef.current = true;
    // Mark queued projects as idle since they'll never run
    setStates((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, s]) => [
          id,
          s.status === "pending" ? { ...s, status: "idle" } : s,
        ])
      )
    );
  }

  const queue = projects.filter((p) => selected.has(p.id));
  const allSelected = selected.size === projects.length;
  const someSelected = selected.size > 0 && selected.size < projects.length;

  const counts = Object.values(states).reduce(
    (acc, s) => {
      if (s.status === "completed") acc.completed++;
      else if (s.status === "failed") acc.failed++;
      return acc;
    },
    { completed: 0, failed: 0 }
  );

  const isDone = !isRunning && Object.values(states).some((s) => s.status === "completed" || s.status === "failed");

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-zinc-500 tabular-nums">
          {isRunning && activeIndex !== null
            ? `Project ${activeIndex + 1} of ${queue.length} selected`
            : isDone
              ? `${counts.completed} synced${counts.failed > 0 ? ` · ${counts.failed} failed` : ""}`
              : `${selected.size} of ${projects.length} selected`}
        </p>

        <div className="flex items-center gap-2">
          {isRunning && (
            <Button variant="outline" size="sm" onClick={handleCancel} className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:hover:bg-red-950/40">
              <RiCloseLine className="size-4" />
              Cancel
            </Button>
          )}
          {isRunning ? (
            <Button disabled className="gap-2 shrink-0">
              <RiRefreshLine className="size-4 animate-spin" />
              Syncing…
            </Button>
          ) : (
            <AlertDialog
              open={syncDialogOpen}
              onOpenChange={(o) => { setSyncDialogOpen(o); if (!o) setSyncConfirmText(""); }}
            >
              <AlertDialogTrigger asChild>
                <Button disabled={selected.size === 0} className="gap-2 shrink-0">
                  <RiRefreshLine className="size-4" />
                  {isDone ? "Sync Again" : "Sync Selected"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sync {selected.size} project{selected.size !== 1 ? "s" : ""}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Syncing is an expensive and time-consuming operation — it re-fetches all
                    issues from Jira for the selected projects sequentially. This may take several
                    minutes to complete. Use carefully, or perform this operation in the local
                    development environment.
                    <br /><br />
                    Type <span className="font-mono font-medium text-foreground">sync all</span> to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input
                  placeholder="sync all"
                  value={syncConfirmText}
                  onChange={(e) => setSyncConfirmText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && syncConfirmText === "sync all") {
                      setSyncDialogOpen(false);
                      setSyncConfirmText("");
                      handleSyncAll();
                    }
                  }}
                  autoFocus
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={syncConfirmText !== "sync all"}
                    onClick={() => { setSyncDialogOpen(false); setSyncConfirmText(""); handleSyncAll(); }}
                  >
                    Proceed
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Project list */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-200 dark:divide-zinc-800">
        {/* Select-all header */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={toggleAll}
            disabled={isRunning}
            aria-label="Select all projects"
          />
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide select-none">
            Project
          </span>
        </div>

        {projects.map((project, i) => {
          const queueIndex = queue.findIndex((q) => q.id === project.id);
          return (
            <ProjectRow
              key={project.id}
              project={project}
              state={states[project.id]}
              isSelected={selected.has(project.id)}
              isActive={activeIndex === queueIndex && queueIndex !== -1 && isRunning}
              isRunning={isRunning}
              onToggle={() => toggleProject(project.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ProjectRow({
  project,
  state,
  isSelected,
  isActive,
  isRunning,
  onToggle,
}: {
  project: Project;
  state: ProjectState;
  isSelected: boolean;
  isActive: boolean;
  isRunning: boolean;
  onToggle: () => void;
}) {
  const progress =
    state.totalIssues && state.totalIssues > 0
      ? Math.round((state.syncedCount / state.totalIssues) * 100)
      : null;

  const isIdle = state.status === "idle" || state.status === "skipped";

  return (
    <div
      className={cn(
        "px-4 py-3 bg-white dark:bg-zinc-900 transition-colors duration-200",
        isActive && "bg-blue-50/60 dark:bg-blue-950/20",
        !isSelected && isIdle && "opacity-50"
      )}
    >
      <div className="flex items-center gap-3">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          disabled={isRunning}
          aria-label={`Select ${project.name}`}
        />

        <StatusIcon status={state.status} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{project.name}</span>
            <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 shrink-0">
              {project.jiraProjectKey}
            </span>
          </div>

          <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5 h-4">
            {(state.status === "running" || state.status === "completed") && (
              <span>
                {state.syncedCount.toLocaleString()}
                {state.totalIssues != null
                  ? ` / ${state.totalIssues.toLocaleString()} issues`
                  : " issues"}
                {state.errorCount > 0 && (
                  <span className="text-red-400"> · {state.errorCount} errors</span>
                )}
              </span>
            )}
            {state.status === "idle" && project.lastSyncedAt && (
              <span>
                Last synced{" "}
                {formatDistanceToNow(new Date(project.lastSyncedAt), { addSuffix: true })}
              </span>
            )}
            {state.status === "pending" && <span className="text-yellow-500">Queued…</span>}
            {state.status === "failed" && <span className="text-red-500">Sync failed</span>}
            {state.status === "skipped" && <span>Skipped</span>}
          </div>
        </div>

        <StatusBadge status={state.status} progress={progress} />
      </div>

      {state.status === "running" && (
        <div className="mt-2 pl-[52px]">
          {progress !== null ? (
            <Progress value={progress} className="h-1" />
          ) : (
            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-blue-500 animate-[indeterminate_1.4s_ease-in-out_infinite]" />
            </div>
          )}
        </div>
      )}

      {state.status === "completed" && (
        <div className="mt-2 pl-[52px]">
          <Progress
            value={100}
            className="h-1 [&>[data-slot=progress-indicator]]:bg-green-500"
          />
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: SyncStatus }) {
  return (
    <div className="size-5 shrink-0 flex items-center justify-center">
      {(status === "idle" || status === "skipped") && (
        <div className="size-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
      )}
      {status === "pending" && (
        <div className="size-2 rounded-full bg-yellow-400 animate-pulse" />
      )}
      {status === "running" && (
        <RiLoader4Line className="size-4 text-blue-500 animate-spin" />
      )}
      {status === "completed" && <RiCheckLine className="size-4 text-green-500" />}
      {status === "failed" && <RiErrorWarningLine className="size-4 text-red-500" />}
    </div>
  );
}

function StatusBadge({ status, progress }: { status: SyncStatus; progress: number | null }) {
  if (status === "idle" || status === "skipped") return <div className="w-16" />;

  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-[11px] tabular-nums shrink-0 min-w-16 justify-center",
        status === "pending" &&
          "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
        status === "running" &&
          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
        status === "completed" &&
          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
        status === "failed" &&
          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800"
      )}
    >
      {status === "pending" && "Queued"}
      {status === "running" && (progress !== null ? `${progress}%` : "Starting")}
      {status === "completed" && "Done"}
      {status === "failed" && "Failed"}
    </Badge>
  );
}

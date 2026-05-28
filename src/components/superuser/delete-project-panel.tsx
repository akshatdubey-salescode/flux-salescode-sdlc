"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RiDeleteBin2Line, RiAlertLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Project = {
  id: string;
  name: string;
  jiraProjectKey: string;
  issueCount: number;
};

function DeleteProjectButton({ project }: { project: Project }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [secondOpen, setSecondOpen] = useState(false);

  function handleFinalDelete() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/superuser/projects/${project.id}`, {
          method: "DELETE",
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error(body.error ?? "Failed to delete project.");
          return;
        }

        toast.success(`"${project.name}" and all related data deleted.`);
        router.refresh();
      } catch {
        toast.error("An unexpected error occurred.");
      }
    });
  }

  return (
    <>
      {/* Step 1 — initial warning */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <RiDeleteBin2Line className="size-3.5" />
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400">
              <RiAlertLine className="size-4" />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will permanently delete{" "}
                  <span className="font-semibold text-foreground">
                    {project.name}
                  </span>{" "}
                  ({project.jiraProjectKey}) and all data associated with it,
                  including:
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  <li>{project.issueCount} Jira issues</li>
                  <li>SLA rules, violations &amp; email notifications</li>
                  <li>Status mappings &amp; stakeholders</li>
                  <li>Sync job history</li>
                  <li>Freshdesk tickets &amp; requirements</li>
                </ul>
                <p className="font-medium text-foreground">
                  This action cannot be undone.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => setSecondOpen(true)}
            >
              Yes, continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Step 2 — final confirmation */}
      <AlertDialog open={secondOpen} onOpenChange={setSecondOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400">
              <RiAlertLine className="size-4" />
            </AlertDialogMedia>
            <AlertDialogTitle>Last chance</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to permanently delete{" "}
              <span className="font-semibold text-foreground">
                {project.name}
              </span>
              . There is no recovery. Click{" "}
              <span className="font-semibold text-foreground">
                Delete permanently
              </span>{" "}
              to proceed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              size="default"
              disabled={isPending}
              onClick={() => {
                setSecondOpen(false);
                handleFinalDelete();
              }}
            >
              {isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function DeleteProjectPanel({ projects }: { projects: Project[] }) {
  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 px-4 py-10 text-center text-sm text-zinc-400">
        No projects found.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              Project
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden sm:table-cell">
              Key
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden md:table-cell">
              Issues
            </th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr
              key={p.id}
              className="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0"
            >
              <td className="px-4 py-3 font-medium text-zinc-800 dark:text-zinc-200 text-sm">
                {p.name}
              </td>
              <td className="px-4 py-3 hidden sm:table-cell">
                <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-xs font-mono text-zinc-600 dark:text-zinc-400">
                  {p.jiraProjectKey}
                </code>
              </td>
              <td className="px-4 py-3 text-xs text-zinc-500 hidden md:table-cell">
                {p.issueCount.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right">
                <DeleteProjectButton project={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

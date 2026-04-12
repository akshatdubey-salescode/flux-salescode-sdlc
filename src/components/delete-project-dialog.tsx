"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { RiDeleteBinLine, RiLoader4Line, RiAlertLine } from "@remixicon/react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Action = "deactivate" | "delete";
type Mode = "choose" | Action;

type Props = {
  projectId: string;
  projectName: string;
};

const ACTION_META: Record<
  Action,
  { label: string; description: string; buttonClass: string }
> = {
  deactivate: {
    label: "Deactivate",
    description:
      "This project will be hidden from all users and no longer receive webhook updates. It can be reactivated later from the database.",
    buttonClass:
      "w-full rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50",
  },
  delete: {
    label: "Delete permanently",
    description:
      "This will immediately and irreversibly delete the project, all synced issues, status history, SLA rules, comments, and sync jobs. This cannot be undone.",
    buttonClass:
      "w-full rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50",
  },
};

export function DeleteProjectDialog({ projectId, projectName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("choose");
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setMode("choose");
    setConfirmText("");
    setError(null);
    setLoading(false);
  }

  function handleClose(o: boolean) {
    if (!o) reset();
    setOpen(o);
  }

  function selectAction(action: Action) {
    setMode(action);
    setConfirmText("");
    setError(null);
    // Focus input after state settles
    setTimeout(() => inputRef.current?.focus(), 60);
  }

  async function handleSubmit() {
    if (confirmText !== requiredWord || mode === "choose") return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}?action=${mode}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      setOpen(false);
      router.push("/projects");
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  const meta = mode !== "choose" ? ACTION_META[mode] : null;
  const requiredWord = mode === "deactivate" ? "deactivate" : "delete";
  const canSubmit = confirmText === requiredWord && !loading;

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 translate-y-1.5 rounded-md bg-red-600/90 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 hover:bg-red-600"
        >
          <RiDeleteBinLine className="size-3.5" />
          Delete project
        </button>
      </AlertDialogTrigger>

      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <RiAlertLine className="size-5 text-red-500 shrink-0" />
            {mode === "choose"
              ? "Delete project"
              : mode === "deactivate"
              ? "Deactivate project"
              : "Delete permanently"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              {mode === "choose" ? (
                <p>
                  What would you like to do with{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {projectName}
                  </span>
                  ?
                </p>
              ) : (
                <p>{meta!.description}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* ── choose mode ── */}
        {mode === "choose" && (
          <div className="mt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => selectAction("deactivate")}
              className="w-full rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-left text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70"
            >
              Deactivate
              <p className="mt-0.5 text-xs font-normal text-amber-700 dark:text-amber-400">
                Hide the project — data is preserved and can be restored
              </p>
            </button>
            <button
              type="button"
              onClick={() => selectAction("delete")}
              className="w-full rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-left text-sm font-medium text-red-900 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70"
            >
              Delete permanently
              <p className="mt-0.5 text-xs font-normal text-red-600 dark:text-red-400">
                Irreversibly remove all project data
              </p>
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ── confirm mode ── */}
        {mode !== "choose" && (
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <label
                htmlFor="delete-confirm-input"
                className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
              >
                Type{" "}
                <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                  {requiredWord}
                </span>{" "}
                to confirm
              </label>
              <input
                id="delete-confirm-input"
                ref={inputRef}
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                  if (e.key === "Escape") reset();
                }}
                placeholder={requiredWord}
                autoComplete="off"
                disabled={loading}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm placeholder-zinc-300 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
              />
            </div>

            {error && (
              <p className="text-xs text-red-500">{error}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={reset}
                disabled={loading}
                className="flex-1 rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={meta!.buttonClass}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <RiLoader4Line className="size-4 animate-spin" />
                    {mode === "deactivate" ? "Deactivating…" : "Deleting…"}
                  </span>
                ) : mode === "deactivate" ? (
                  "Deactivate"
                ) : (
                  "Delete permanently"
                )}
              </button>
            </div>
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { RiLoader4Line, RiSparkling2Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AiRunView } from "@/lib/test-cases/ai-review/service";
import { invalidateTcSummaries } from "./tc-summary-cache";

type Limits = { used: number; max: number; cooldownUntil: string | null };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });

/**
 * Whole seconds left until `until`, ticking once a second. Read through useSyncExternalStore so the server's render
 * (which can't know the browser's clock) and the first client render agree, instead of a hydration mismatch.
 */
function useSecondsLeft(until: string | null): number {
  const subscribe = useCallback(
    (onTick: () => void) => {
      if (!until) return () => {};
      const t = setInterval(onTick, 1000);
      return () => clearInterval(t);
    },
    [until],
  );
  const read = useCallback(() => (until ? Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000)) : 0), [until]);
  return useSyncExternalStore(subscribe, read, () => 0);
}

/**
 * The AI review of a round: what it did last, a button to run it again, and live progress while it runs.
 * Its findings appear in the feedback thread below like any reviewer's; this block only shows the run.
 */
export function AiReviewBlock({
  roundId,
  initialRun,
  limits: initialLimits,
  canRun,
  blockedReason,
  reviewerState,
}: {
  roundId: string;
  initialRun: AiRunView | null;
  limits: Limits;
  canRun: boolean;
  /** Why Run is unavailable (superseded round, sign-off started, not a participant); null when it is available. */
  blockedReason: string | null;
  /** The AI reviewer's state on this round now (findings stand, or a person overrode them). */
  reviewerState: string | null;
}) {
  const router = useRouter();
  const [run, setRun] = useState<AiRunView | null>(initialRun);
  const [limits, setLimits] = useState<Limits>(initialLimits);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasRunning = useRef(initialRun?.status === "running");

  const running = run?.status === "running";

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/test-cases/rounds/${roundId}/ai-review`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { run: AiRunView | null; limits?: Limits };
      setRun(data.run);
      if (data.limits) setLimits(data.limits);
    } catch {
      /* try again on the next tick */
    }
  }, [roundId]);

  // While a run is going, check every 3 seconds; when it ends, reload the page's data (findings, reviewer states).
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) {
        wasRunning.current = false;
        invalidateTcSummaries();
        router.refresh();
      }
      return;
    }
    wasRunning.current = true;
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [running, poll, router]);

  const cooldownLeft = useSecondsLeft(limits.cooldownUntil);
  const capped = limits.used >= limits.max;
  const disabledReason = blockedReason ?? (running ? "The AI review is running." : capped ? `Run ${limits.max} times already. Resubmit to run it again.` : cooldownLeft > 0 ? `Wait ${cooldownLeft}s.` : null);

  async function start() {
    if (busy || disabledReason) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/test-cases/rounds/${roundId}/ai-review`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not start the AI review.");
        return;
      }
      setRun(data.run);
      await poll();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-sky-900 dark:text-sky-200">
          <RiSparkling2Line className="size-4" />
          AI review
        </p>
        {canRun && (
          <Button type="button" size="sm" variant="outline" onClick={start} disabled={busy || !!disabledReason} title={disabledReason ?? undefined}>
            {(busy || running) && <RiLoader4Line className="size-3.5 animate-spin" />}
            {run && !running && run.status !== "skipped" ? "Run again" : "Run AI review"}
          </Button>
        )}
      </div>

      {running && (
        <p className="text-[11px] text-sky-900 dark:text-sky-200">
          Reading the Jira item, the test cases and the earlier feedback. This usually takes under a minute; the page updates by itself.
        </p>
      )}
      {!running && run?.status === "succeeded" && (
        <div className="space-y-0.5 text-[11px]">
          <p className={cn("font-medium", run.findingCount > 0 && reviewerState !== "overridden" ? "text-amber-800 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-400")}>
            {run.findingCount === 0
              ? "No issues found. A person still has to approve."
              : `${run.findingCount} finding${run.findingCount === 1 ? "" : "s"} below. ${reviewerState === "overridden" ? "A reviewer overrode them, so they no longer block." : "They block approval until resolved, resubmitted or overridden."}`}
          </p>
          {run.summary && <p className="whitespace-pre-wrap text-muted-foreground">{run.summary}</p>}
          <p className="text-muted-foreground">
            {run.trigger === "auto" ? "Ran automatically on submission" : "Run on request"} · {fmt(run.finishedAt ?? run.startedAt)} · {run.model}
            {run.knowledge.length > 0 && ` · ${run.knowledge.length} reference page${run.knowledge.length === 1 ? "" : "s"}${run.knowledge.some((k) => k.stale) ? " (some may be out of date)" : ""}`}
          </p>
        </div>
      )}
      {!running && run?.status === "skipped" && (
        <p className="text-[11px] text-amber-800 dark:text-amber-300">
          Not run automatically: {run.error ?? "the AI service is on hold."} Review continues without it.
        </p>
      )}
      {!running && run && (run.status === "failed" || run.status === "superseded") && (
        <p className="text-[11px] text-destructive">
          {run.status === "superseded" ? "Not saved: " : "The AI review didn't complete: "}
          {run.error ?? "unknown reason"} Review continues without it.
        </p>
      )}
      {!run && <p className="text-[11px] text-muted-foreground">Not run on this round yet.</p>}

      {canRun && disabledReason && !running && <p className="text-[11px] text-muted-foreground">{disabledReason}</p>}
      {!canRun && blockedReason && <p className="text-[11px] text-muted-foreground">{blockedReason}</p>}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

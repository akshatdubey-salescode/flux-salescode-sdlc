"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RiLoader4Line, RiRefreshLine, RiGitPullRequestLine } from "@remixicon/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recomputeScorecards, syncJiraLoc } from "./actions";

type QuarterOption = { key: string; label: string };

export function ReviewControls({
  quarters,
  selectedKey,
  computedAt,
  canRecompute,
}: {
  quarters: QuarterOption[];
  selectedKey: string;
  computedAt: string | null;
  canRecompute: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSyncingLoc, startLocSync] = useTransition();

  function onQuarterChange(key: string) {
    router.push(`/performance-review?quarter=${encodeURIComponent(key)}`);
  }

  function onRecompute() {
    startTransition(async () => {
      const res = await recomputeScorecards(selectedKey);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Scored ${res.developersScored ?? 0} developer${
          res.developersScored === 1 ? "" : "s"
        } for this quarter.`
      );
      router.refresh();
    });
  }

  // Manual-only trigger (no cron) — pulls fresh PR data, matches it to
  // Jiras, and recomputes scorecards with the new LOC.
  function onSyncLoc() {
    startLocSync(async () => {
      const res = await syncJiraLoc(selectedKey);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Matched ${res.matchesFound ?? 0} PR(s) across ${res.prsScanned ?? 0} scanned.` +
          (res.rateLimited ? " Stopped early — GitHub rate limit low, will resume next run." : "")
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={selectedKey} onValueChange={onQuarterChange}>
        <SelectTrigger className="w-[220px]">
          <SelectValue placeholder="Select quarter" />
        </SelectTrigger>
        <SelectContent>
          {quarters.map((q) => (
            <SelectItem key={q.key} value={q.key}>
              {q.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {canRecompute && (
        <Button
          variant="outline"
          onClick={onRecompute}
          disabled={isPending}
          className="gap-2"
        >
          {isPending ? (
            <RiLoader4Line className="size-4 animate-spin" />
          ) : (
            <RiRefreshLine className="size-4" />
          )}
          {isPending ? "Recomputing…" : "Recompute"}
        </Button>
      )}

      {canRecompute && (
        <Button
          variant="outline"
          onClick={onSyncLoc}
          disabled={isSyncingLoc}
          className="gap-2"
        >
          {isSyncingLoc ? (
            <RiLoader4Line className="size-4 animate-spin" />
          ) : (
            <RiGitPullRequestLine className="size-4" />
          )}
          {isSyncingLoc ? "Syncing LOC…" : "Sync LOC"}
        </Button>
      )}

      {computedAt && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Last computed {new Date(computedAt).toLocaleString()}
        </span>
      )}
    </div>
  );
}

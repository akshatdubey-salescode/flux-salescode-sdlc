"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RiLoader4Line, RiRefreshLine } from "@remixicon/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recomputeScorecards } from "./actions";

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

      {computedAt && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Last computed {new Date(computedAt).toLocaleString()}
        </span>
      )}
    </div>
  );
}

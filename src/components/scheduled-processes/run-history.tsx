"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RiSearchEyeLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deliveryLabel,
  deliveryTone,
  type DeliveryStatus,
  type RunRow,
} from "@/lib/scheduled-processes/types";

/**
 * Every attempt this schedule has made, and — on request — what the provider
 * says became of each one.
 *
 * The two are deliberately separate questions. Our own log answers "did Flux
 * send it?" (and why not, when it didn't). Only the provider can answer "did it
 * reach anyone?", because a bounce or a spam complaint happens after we hand
 * the mail over. A run row saying "sent" is the first, not the second.
 */

const TONE_CLASS = {
  good: "text-emerald-700 dark:text-emerald-400",
  bad: "text-destructive",
  pending: "text-amber-600 dark:text-amber-500",
} as const;

const STATUS_CLASS: Record<string, string> = {
  sent: "text-emerald-700 dark:text-emerald-400",
  failed: "text-destructive",
  skipped: "text-amber-600 dark:text-amber-500",
  running: "text-muted-foreground",
};

function DeliveryDetail({ scheduleId, run }: { scheduleId: string; run: RunRow }) {
  const [statuses, setStatuses] = useState<DeliveryStatus[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/scheduled-processes/${scheduleId}/runs/${run.id}/delivery`,
        { cache: "no-store" }
      );
      const body = (await res.json().catch(() => ({}))) as {
        statuses?: DeliveryStatus[];
        note?: string;
        errors?: string[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't check delivery");
        return;
      }
      setStatuses(body.statuses ?? []);
      setNote(body.note ?? null);
      if (body.errors?.length) toast.error(body.errors[0]);
    } finally {
      setLoading(false);
    }
  }

  if (statuses === null) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-5 px-1 text-[11px]"
        disabled={loading}
        onClick={check}
      >
        <RiSearchEyeLine className="size-3" />
        {loading ? "Checking…" : "Check delivery"}
      </Button>
    );
  }

  if (note) {
    return <p className="text-[11px] text-muted-foreground">{note}</p>;
  }

  return (
    <ul className="space-y-0.5">
      {statuses.map((s) => (
        <li key={s.messageId} className="text-[11px]">
          <span className={TONE_CLASS[deliveryTone(s.lastEvent)]}>
            {deliveryLabel(s.lastEvent)}
          </span>
          <span className="text-muted-foreground"> — {s.to.join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}

export function RunHistory({ scheduleId }: { scheduleId: string }) {
  const [runs, setRuns] = useState<RunRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/scheduled-processes/${scheduleId}/runs`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { runs: RunRow[] };
      setRuns(data.runs ?? []);
    } catch {
      setRuns([]);
    }
  }, [scheduleId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (runs === null) return <Skeleton className="h-12 w-full" />;
  if (runs.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        No attempts yet — the first goes out at midnight IST on the next run date.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2">
      {runs.map((run) => (
        <li key={run.id} className="space-y-0.5 border-b border-border/60 pb-1.5 last:border-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
            <span className="font-medium">{run.runOn}</span>
            <span className={STATUS_CLASS[run.status] ?? "text-muted-foreground"}>
              {run.status}
            </span>
            {run.trigger === "manual" && <span className="text-muted-foreground">(manual)</span>}
            <span className="text-muted-foreground">
              {run.recipientCount} recipient{run.recipientCount === 1 ? "" : "s"}
            </span>
            {run.durationMs !== null && (
              <span className="text-muted-foreground">{(run.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>
          {run.detail && <p className="text-[11px] text-destructive">{run.detail}</p>}
          {run.status === "sent" && <DeliveryDetail scheduleId={scheduleId} run={run} />}
        </li>
      ))}
    </ul>
  );
}

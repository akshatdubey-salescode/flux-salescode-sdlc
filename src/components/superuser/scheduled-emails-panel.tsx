"use client";

import { useCallback, useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ScheduleList } from "@/components/scheduled-processes/schedule-list";
import { scheduleState, type ScheduleRow } from "@/lib/scheduled-processes/types";

/**
 * Every standing schedule in the app, across every sprint and workstream — the
 * operator's view. Live and soonest-due first, with paused and stopped rows
 * kept below so "why did this stop mailing?" has an answer rather than a gap.
 */
export function ScheduledEmailsPanel() {
  const [schedules, setSchedules] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/scheduled-processes", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { schedules: ScheduleRow[] };
      setSchedules(data.schedules ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load schedules");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <p className="text-xs text-destructive">{error}</p>;
  }
  if (!schedules) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const live = schedules.filter((row) => scheduleState(row) === "live").length;
  const paused = schedules.filter((row) => scheduleState(row) === "paused").length;
  const stopped = schedules.filter((row) => scheduleState(row) === "stopped").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {live} live · {paused} paused · {stopped} stopped
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={refreshing}
          className="gap-1.5 text-xs"
        >
          <RiRefreshLine className={cn("size-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>
      <ScheduleList
        schedules={schedules}
        onChanged={load}
        showTarget
        emptyLabel="Nothing is scheduled anywhere yet. Schedules are created from a sprint's or workstream's email dialog, on its Repeat tab."
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RiArrowLeftLine, RiLinkM } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SprintWithItems, SprintOption } from "@/lib/sprints/entries";
import { SprintCard, type SpilloverTarget } from "./sprint-tracker-tab";

/**
 * The full-screen body of /sprints/[id] — one sprint, every action available.
 * Loads the sprint itself plus the project's open sprints (spillover targets
 * for the close flow) and refetches both after any mutation.
 */
export function SprintFocus({ sprintId, canManage }: { sprintId: string; canManage: boolean }) {
  const [sprint, setSprint] = useState<SprintWithItems | null>(null);
  const [targets, setTargets] = useState<SpilloverTarget[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sprints/${sprintId}`, { cache: "no-store" });
      if (res.status === 404) {
        setError("This sprint doesn't exist anymore (it may have been deleted).");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { sprint: loaded } = (await res.json()) as { sprint: SprintWithItems };
      setSprint(loaded);

      const optionsUrl = loaded.projectId
        ? `/api/projects/${loaded.projectId}/sprints?summary=1`
        : `/api/observer/boards/${loaded.boardId}/sprints?summary=1`;
      const optRes = await fetch(optionsUrl, { cache: "no-store" });
      if (optRes.ok) {
        const { sprints: options } = (await optRes.json()) as { sprints: SprintOption[] };
        setTargets(options.filter((o) => o.id !== sprintId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sprint");
    }
  }, [sprintId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return <p className="p-6 text-center text-xs text-muted-foreground">{error}</p>;
  }
  if (!sprint) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="h-7 text-[11px]">
          <Link href={`/projects/${sprint.projectId}?tab=sprint-tracker`}>
            <RiArrowLeftLine className="size-3.5" /> All sprints
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => {
            navigator.clipboard.writeText(window.location.href);
            toast.success("Sprint link copied — anyone with project access can open it");
          }}
        >
          <RiLinkM className="size-3.5" /> Copy link
        </Button>
      </div>
      <SprintCard sprint={sprint} canManage={canManage} onChanged={load} spilloverTargets={targets} />
    </div>
  );
}

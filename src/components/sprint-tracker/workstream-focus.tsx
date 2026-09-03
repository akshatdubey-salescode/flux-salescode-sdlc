"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RiArrowLeftLine, RiDownload2Line, RiLinkM, RiStackLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SprintWithItems, SprintOption, SprintWorkstream } from "@/lib/sprints/entries";
import { SprintCard, type SpilloverTarget } from "./sprint-tracker-tab";

/**
 * The full-screen body of /workstreams/[id] — one workstream, all its sprints,
 * every sprint action available. Loads the workstream (with sprints), the
 * project's open sprints (spillover targets for the close flow), and refetches
 * after any mutation.
 */
export function WorkstreamFocus({ workstreamId, canManage }: { workstreamId: string; canManage: boolean }) {
  const [workstream, setWorkstream] = useState<SprintWorkstream | null>(null);
  const [sprints, setSprints] = useState<SprintWithItems[] | null>(null);
  const [targets, setTargets] = useState<SpilloverTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workstreams/${workstreamId}`, { cache: "no-store" });
      if (res.status === 404) {
        setError("This workstream doesn't exist anymore (it may have been deleted).");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { workstream: SprintWorkstream; sprints: SprintWithItems[] };
      setWorkstream(data.workstream);
      setSprints(data.sprints);

      const optRes = await fetch(`/api/projects/${data.workstream.projectId}/sprints?summary=1`, {
        cache: "no-store",
      });
      if (optRes.ok) {
        const { sprints: options } = (await optRes.json()) as { sprints: SprintOption[] };
        setTargets(options.map((o) => ({ id: o.id, name: o.name, startDate: o.startDate, endDate: o.endDate })));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [workstreamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const agg = useMemo(() => {
    const list = sprints ?? [];
    const out = { committed: 0, committedDone: 0, active: 0, completed: 0, planned: 0 };
    for (const s of list) {
      out.committed += s.rollup.committed;
      out.committedDone += s.rollup.committedDone;
      if (s.completedAt) out.completed += 1;
      else if (s.startedAt) out.active += 1;
      else out.planned += 1;
    }
    return out;
  }, [sprints]);

  async function handleExport() {
    if (!sprints || sprints.length === 0 || !workstream) return;
    setExporting(true);
    try {
      const res = await fetch("/api/sprints/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprints }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const safeName = workstream.name.replace(/[^\w-]+/g, "_");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}-workstream-report.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed — try again");
    } finally {
      setExporting(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-destructive">{error}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/projects">
            <RiArrowLeftLine className="size-3.5" /> Back to projects
          </Link>
        </Button>
      </div>
    );
  }
  if (!workstream || !sprints) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const pct = agg.committed > 0 ? Math.round((agg.committedDone / agg.committed) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <RiStackLine className="size-4 shrink-0 text-muted-foreground" />
            {workstream.name}
          </h2>
          {workstream.description && <p className="mt-0.5 text-xs text-muted-foreground">{workstream.description}</p>}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {sprints.length} sprint{sprints.length === 1 ? "" : "s"}
            {agg.active > 0 && ` · ${agg.active} active`}
            {agg.planned > 0 && ` · ${agg.planned} planned`}
            {agg.completed > 0 && ` · ${agg.completed} completed`}
            {agg.committed > 0 && ` · committed ${agg.committed} · done ${agg.committedDone} (${pct}%)`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Copy shareable link to this workstream"
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              toast.success("Workstream link copied — anyone with project access can open it");
            }}
          >
            <RiLinkM className="size-3.5" />
          </Button>
          {sprints.length > 0 && (
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={handleExport} disabled={exporting}>
              <RiDownload2Line className="size-3.5" />
              {exporting ? "Exporting…" : "Report"}
            </Button>
          )}
        </div>
      </div>

      {sprints.length === 0 ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          No sprints in this workstream yet — move sprints in from the project&apos;s Sprint Tracker tab.
        </p>
      ) : (
        sprints.map((sprint) => (
          <SprintCard
            key={sprint.id}
            sprint={sprint}
            canManage={canManage}
            onChanged={() => void load()}
            spilloverTargets={targets.filter((t) => t.id !== sprint.id)}
          />
        ))
      )}
    </div>
  );
}

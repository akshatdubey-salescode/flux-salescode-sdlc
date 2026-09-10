"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RiArrowLeftLine, RiDownload2Line, RiLinkM, RiSearchLine, RiStackLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { SprintWithItems, SprintOption, SprintWorkstream } from "@/lib/sprints/entries";
import { SprintCard, itemMatchesQuery, type SpilloverTarget } from "./sprint-tracker-tab";
import { Tip } from "./tip";
import { EmailUpdateDialog, workstreamEmailDefaults } from "./email-update-dialog";

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
  // One box over every sprint in the workstream. Per-sprint bars only ever
  // searched inside one card, so finding an issue meant expanding each sprint
  // and typing the same thing again.
  const [itemQuery, setItemQuery] = useState("");

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
        setTargets(options);
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

  // A sprint earns its place in the results if any of its items match; the
  // card then opens itself and filters down to those items.
  const visibleSprints = useMemo(() => {
    const list = sprints ?? [];
    if (!itemQuery.trim()) return list;
    return list.filter((s) => s.items.some((i) => itemMatchesQuery(i, itemQuery)));
  }, [sprints, itemQuery]);

  const matchCount = useMemo(() => {
    if (!itemQuery.trim()) return 0;
    return (sprints ?? []).reduce(
      (n, s) => n + s.items.filter((i) => itemMatchesQuery(i, itemQuery)).length,
      0
    );
  }, [sprints, itemQuery]);

  const totalItems = useMemo(
    () => (sprints ?? []).reduce((n, s) => n + s.items.length, 0),
    [sprints]
  );

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
          <Tip label="Copy a shareable link to this workstream — anyone with access can open it">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                toast.success("Workstream link copied — anyone with project access can open it");
              }}
            >
              <RiLinkM className="size-3.5" />
            </Button>
          </Tip>
          {sprints.length > 0 && (
            <Tip label="Download one Excel report covering every sprint in this workstream">
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={handleExport} disabled={exporting}>
                <RiDownload2Line className="size-3.5" />
                {exporting ? "Exporting…" : "Report"}
              </Button>
            </Tip>
          )}
          {canManage && sprints.length > 0 && (
            <EmailUpdateDialog
              endpoint={`/api/workstreams/${workstream.id}/email`}
              schedulesEndpoint={`/api/workstreams/${workstream.id}/schedules`}
              targetNoun="workstream"
              projectId={workstream.projectId}
              entityName={workstream.name}
              buildDefaults={() => workstreamEmailDefaults(workstream.name, sprints)}
            />
          )}
        </div>
      </div>

      {sprints.length === 0 ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          No sprints in this workstream yet — move sprints in from the project&apos;s Sprint Tracker tab.
        </p>
      ) : (
        <>
          {totalItems > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <RiSearchLine className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={itemQuery}
                  onChange={(e) => setItemQuery(e.target.value)}
                  placeholder="Search items across all sprints — key, summary, assignee…"
                  className="h-8 w-full pl-7 text-xs sm:w-96"
                />
              </div>
              {itemQuery.trim() !== "" && (
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {matchCount} of {totalItems} item{totalItems === 1 ? "" : "s"} in {visibleSprints.length} sprint
                  {visibleSprints.length === 1 ? "" : "s"}
                  <button
                    type="button"
                    onClick={() => setItemQuery("")}
                    className="underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Clear
                  </button>
                </span>
              )}
            </div>
          )}

          {visibleSprints.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              No items match “{itemQuery.trim()}” in any sprint in this workstream.
            </p>
          ) : (
            visibleSprints.map((sprint) => (
              <SprintCard
                key={sprint.id}
                sprint={sprint}
                canManage={canManage}
                onChanged={() => void load()}
                spilloverTargets={targets.filter((t) => t.id !== sprint.id)}
                globalQuery={itemQuery}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  RiSaveLine,
  RiAlertLine,
  RiCheckLine,
  RiLoader4Line,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectStatusMapping, CanonicalStatus } from "@/lib/db/schema";

type DiscoveredStatus = { name: string; statusCategory: string };

const CANONICAL_STATUSES: {
  value: CanonicalStatus;
  label: string;
}[] = [
  { value: "BACKLOG", label: "Backlog" },
  { value: "TODO", label: "To Do" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "IN_REVIEW", label: "In Review" },
  { value: "IN_QA", label: "In QA" },
  { value: "DONE", label: "Done" },
  { value: "CANCELLED", label: "Cancelled" },
];

type Props = {
  projectId: string;
  initialMappings: ProjectStatusMapping[];
  discoveredStatuses: DiscoveredStatus[];
  isOnboarding: boolean;
};

export function StatusMappingEditor({
  projectId,
  initialMappings,
  discoveredStatuses,
  isOnboarding,
}: Props) {
  const router = useRouter();

  // Build initial state: all discovered statuses seeded as unmapped (""),
  // then overwritten by any existing saved mappings.
  const [mappings, setMappings] = useState<Record<string, CanonicalStatus | "">>(() => {
    const initial: Record<string, CanonicalStatus | ""> = {};
    for (const s of discoveredStatuses) {
      initial[s.name] = "";
    }
    for (const m of initialMappings) {
      initial[m.rawStatus] = m.canonicalStatus;
    }
    return initial;
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Union of discovered statuses + any previously-saved statuses (handles
  // statuses removed from Jira that still have historical data in DB).
  const allRawStatuses = Array.from(
    new Set([
      ...discoveredStatuses.map((s) => s.name),
      ...initialMappings.map((m) => m.rawStatus),
    ])
  );

  const unmappedCount = allRawStatuses.filter((s) => !mappings[s]).length;

  function handleChange(rawStatus: string, value: CanonicalStatus | "") {
    setSaveSuccess(false);
    setMappings((prev) => ({ ...prev, [rawStatus]: value }));
  }

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const body = allRawStatuses
      .filter((s) => mappings[s] !== "")
      .map((s) => ({ rawStatus: s, canonicalStatus: mappings[s] as CanonicalStatus }));

    try {
      const res = await fetch(`/api/projects/${projectId}/status-mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Save failed");
      }

      setSaveSuccess(true);

      if (isOnboarding) {
        router.push(`/projects/${projectId}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }, [allRawStatuses, mappings, projectId, isOnboarding, router]);

  if (allRawStatuses.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 p-12 text-center dark:border-zinc-800">
        <p className="text-sm text-zinc-500">
          No statuses found. Ensure the project has been synced and Jira
          credentials are valid.
        </p>
      </div>
    );
  }

  return (
    <div>
      {unmappedCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          <RiAlertLine className="size-3.5 shrink-0" />
          <span>
            {unmappedCount} status{unmappedCount !== 1 ? "es" : ""} not yet
            mapped — they will be excluded from cross-project views.
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="grid grid-cols-[1fr_16px_1fr] items-center gap-x-3 border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <span>Jira Status</span>
          <span />
          <span>Canonical Status</span>
        </div>

        {allRawStatuses.map((rawStatus, idx) => {
          const discovered = discoveredStatuses.find((s) => s.name === rawStatus);
          const selected = mappings[rawStatus] ?? "";

          return (
            <div
              key={rawStatus}
              className={cn(
                "grid grid-cols-[1fr_16px_1fr] items-center gap-x-3 px-4 py-3",
                idx !== allRawStatuses.length - 1 &&
                  "border-b border-zinc-100 dark:border-zinc-800"
              )}
            >
              <div>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {rawStatus}
                </span>
                {discovered && (
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    Jira category: {discovered.statusCategory}
                  </p>
                )}
              </div>

              <span className="text-center text-zinc-300 dark:text-zinc-700">
                →
              </span>

              <select
                value={selected}
                onChange={(e) =>
                  handleChange(rawStatus, e.target.value as CanonicalStatus | "")
                }
                className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus-visible:ring-zinc-300"
              >
                <option value="">— Not mapped —</option>
                {CANONICAL_STATUSES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-zinc-400">
          {unmappedCount === 0 ? (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <RiCheckLine className="size-3.5" />
              All statuses mapped
            </span>
          ) : (
            `${allRawStatuses.length - unmappedCount} of ${allRawStatuses.length} mapped`
          )}
        </div>

        <div className="flex items-center gap-3">
          {saveError && (
            <span className="text-xs text-red-600 dark:text-red-400">
              {saveError}
            </span>
          )}
          {saveSuccess && !isOnboarding && (
            <span className="text-xs text-green-600 dark:text-green-400">
              Saved.
            </span>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              <RiLoader4Line className="animate-spin" />
            ) : (
              <RiSaveLine />
            )}
            {saving
              ? "Saving…"
              : isOnboarding
                ? "Save & continue"
                : "Save mappings"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab content wrapper — used inside ProjectTabs (client component).
// Fetches data from the API on mount, then renders StatusMappingEditor.
// Mirrors the SlaEngineTab pattern.
// ---------------------------------------------------------------------------

type TabContentProps = { projectId: string };

type MappingsResponse = {
  discoveredStatuses: DiscoveredStatus[];
  mappings: ProjectStatusMapping[];
};

export function StatusMappingTabContent({ projectId }: TabContentProps) {
  const [data, setData] = useState<MappingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/status-mappings`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RiLoader4Line className="size-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <StatusMappingEditor
      projectId={projectId}
      initialMappings={data?.mappings ?? []}
      discoveredStatuses={data?.discoveredStatuses ?? []}
      isOnboarding={false}
    />
  );
}

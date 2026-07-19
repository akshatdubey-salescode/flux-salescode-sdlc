"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartInfo } from "@/components/ui/chart-info";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryDonut } from "./category-donut";
import type { ProjectDelayAnalyticsResponse } from "@/app/api/projects/[id]/delays/route";

/**
 * This project's own "why are things delayed" breakdown — category
 * distribution plus who's most often named responsible. Mirrors the org
 * dashboard's delay leaderboards, scoped to just this project's Overview tab.
 * The donut slices and the by-person rows are both clickable, drilling into
 * the underlying delayed issues the same way the org dashboard's leaderboard
 * rows do.
 */
export function ProjectDelayPanel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ProjectDelayAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function goToDrilldown(params: Record<string, string>) {
    router.push(`/delay-tracker?${new URLSearchParams(params)}`);
  }

  useEffect(() => {
    fetch(`/api/projects/${projectId}/delays`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d: ProjectDelayAnalyticsResponse) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [projectId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <button
            type="button"
            onClick={() => goToDrilldown({ projectIds: projectId })}
            className="hover:underline"
          >
            Delay Reasons
          </button>
        </CardTitle>
        <CardAction>
          <ChartInfo description="Why work in this project has been delayed, broken down by the standardized reason logged against each task/bug, plus who's most often named responsible. Click the title to see every delayed issue, or a reason/person to filter to just those." />
        </CardAction>
      </CardHeader>
      <CardContent>
        {error ? (
          <EmptyState message={`Failed to load: ${error}`} />
        ) : !data ? (
          <div className="space-y-3">
            <Skeleton className="h-[90px] w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : data.total === 0 ? (
          <EmptyState message="No delays logged yet for this project" />
        ) : (
          <div className="space-y-4">
            <CategoryDonut
              slices={data.byCategory.map((c) => ({ category: c.category, label: c.label, value: c.count }))}
              onSliceClick={(category) =>
                goToDrilldown({ projectIds: projectId, categories: category })
              }
            />
            {data.byUser.length > 0 && (
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {data.byUser.map((u) => (
                  <button
                    key={u.key}
                    type="button"
                    onClick={() =>
                      goToDrilldown({ projectIds: projectId, responsibleEmail: u.key, responsibleName: u.name })
                    }
                    className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <div className="min-w-0 text-left">
                      <p className="truncate font-medium text-foreground">{u.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {u.topCategory} · {u.topCategoryCount}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">{u.total}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartInfo } from "@/components/ui/chart-info";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryDonut } from "./category-donut";
import type { ProjectDelayAnalyticsResponse } from "@/app/api/projects/[id]/delays/route";

/**
 * This project's own "why are things delayed" breakdown — category
 * distribution plus who's most often named responsible. Mirrors the org
 * dashboard's delay leaderboards, scoped to just this project's Overview tab.
 */
export function ProjectDelayPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProjectDelayAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <CardTitle>Delay Reasons</CardTitle>
        <CardAction>
          <ChartInfo description="Why work in this project has been delayed, broken down by the standardized reason logged against each task/bug, plus who's most often named responsible." />
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
            />
            {data.byUser.length > 0 && (
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {data.byUser.map((u) => (
                  <div key={u.key} className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{u.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {u.topCategory} · {u.topCategoryCount}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">{u.total}</span>
                  </div>
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

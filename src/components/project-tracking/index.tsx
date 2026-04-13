"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RiLayoutColumnLine,
  RiListCheck2,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import { FilterBar } from "./filter-bar";
import { BoardView, BoardViewSkeleton } from "./board-view";
import { ListView } from "./list-view";
import { sortStatusesByCategory } from "./helpers";
import type { TrackingIssue, TrackingFields, FilterState } from "./helpers";

type Props = { projectId: string };

function readFilters(
  searchParams: ReturnType<typeof useSearchParams>
): FilterState {
  return {
    q: searchParams.get("q") ?? "",
    status:
      searchParams.get("status")?.split(",").filter(Boolean) ?? [],
    priority:
      searchParams.get("priority")?.split(",").filter(Boolean) ?? [],
    assignee:
      searchParams.get("assignee")?.split(",").filter(Boolean) ?? [],
    reporter:
      searchParams.get("reporter")?.split(",").filter(Boolean) ?? [],
    issueType:
      searchParams.get("issueType")?.split(",").filter(Boolean) ?? [],
    labels:
      searchParams.get("labels")?.split(",").filter(Boolean) ?? [],
    dateFrom: searchParams.get("dateFrom") ?? "",
    dateTo: searchParams.get("dateTo") ?? "",
    hasComments: searchParams.get("hasComments") === "true",
    sortBy: searchParams.get("sortBy") ?? "updated",
    sortDir:
      searchParams.get("sortDir") === "asc" ? "asc" : "desc",
    view: searchParams.get("view") === "list" ? "list" : "board",
    page: Math.max(1, parseInt(searchParams.get("page") ?? "1", 10)),
  };
}

export function ProjectTrackingTab({ projectId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = readFilters(searchParams);

  const [issues, setIssues] = useState<TrackingIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<TrackingFields | null>(null);

  // Stable key for the list-view effect
  const filterKey = JSON.stringify({
    q: filters.q,
    status: filters.status,
    priority: filters.priority,
    assignee: filters.assignee,
    reporter: filters.reporter,
    issueType: filters.issueType,
    labels: filters.labels,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    hasComments: filters.hasComments,
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
    view: filters.view,
    page: filters.page,
  });

  // Stable key for board columns — excludes status (each column owns its own
  // status filter) and page (each column owns its own page state)
  const boardFilterKey = JSON.stringify({
    q: filters.q,
    priority: filters.priority,
    assignee: filters.assignee,
    reporter: filters.reporter,
    issueType: filters.issueType,
    labels: filters.labels,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    hasComments: filters.hasComments,
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
  });

  // Columns to render on the board: all project statuses, optionally narrowed
  // by the status filter (which doubles as column visibility on the board).
  // Deduplicate by status name — the issues API filters by name only, so two
  // entries with the same name but different statusCategory would produce
  // identical columns (and duplicate React keys).
  const boardColumns = fields
    ? sortStatusesByCategory(
        Array.from(
          new Map(
            (filters.status.length > 0
              ? fields.statuses.filter((s) => filters.status.includes(s.status))
              : fields.statuses
            ).map((s) => [s.status, s])
          ).values()
        )
      )
    : [];

  function updateParams(updates: Partial<Record<string, string | null>>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value!);
      }
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  // Fetch field options once per project
  useEffect(() => {
    fetch(`/api/projects/${projectId}/tracking-fields`)
      .then((r) => r.json())
      .then(setFields)
      .catch(() => {});
  }, [projectId]);

  // Fetch issues (always, for count) — board view columns manage their own data fetching
  useEffect(() => {
    const parsed: FilterState = JSON.parse(filterKey);
    const isBoard = parsed.view === "board";

    const params = new URLSearchParams();
    if (parsed.q) params.set("q", parsed.q);
    if (parsed.status.length) params.set("status", parsed.status.join(","));
    if (parsed.priority.length) params.set("priority", parsed.priority.join(","));
    if (parsed.assignee.length) params.set("assignee", parsed.assignee.join(","));
    if (parsed.reporter.length) params.set("reporter", parsed.reporter.join(","));
    if (parsed.issueType.length) params.set("issueType", parsed.issueType.join(","));
    if (parsed.labels.length) params.set("labels", parsed.labels.join(","));
    if (parsed.dateFrom) params.set("dateFrom", parsed.dateFrom);
    if (parsed.dateTo) params.set("dateTo", parsed.dateTo);
    if (parsed.hasComments) params.set("hasComments", "true");
    params.set("sortBy", parsed.sortBy);
    params.set("sortDir", parsed.sortDir);
    // In board view, only fetch enough to get the total count
    params.set("pageSize", isBoard ? "1" : "50");
    params.set("page", isBoard ? "1" : String(parsed.page));

    if (!isBoard) setLoading(true);
    fetch(`/api/projects/${projectId}/issues?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (!isBoard) {
          setIssues(data.issues ?? []);
          setTotalPages(data.totalPages ?? 1);
        }
        setTotal(data.total ?? 0);
      })
      .catch(() => {})
      .finally(() => { if (!isBoard) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filterKey]);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <FilterBar
        filters={filters}
        fields={fields}
        onUpdate={updateParams}
        total={total}
      />

      {/* View toggle */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => updateParams({ view: "board", page: "1" })}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            filters.view === "board"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          )}
        >
          <RiLayoutColumnLine className="size-3.5" />
          Board
        </button>
        <button
          onClick={() => updateParams({ view: "list", page: "1" })}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            filters.view === "list"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          )}
        >
          <RiListCheck2 className="size-3.5" />
          List
        </button>
      </div>

      {/* Views */}
      {filters.view === "board" ? (
        fields === null ? (
          <BoardViewSkeleton />
        ) : (
          <BoardView
            projectId={projectId}
            columns={boardColumns}
            filters={filters}
            boardFilterKey={boardFilterKey}
          />
        )
      ) : (
        <ListView
          issues={issues}
          loading={loading}
          total={total}
          page={filters.page}
          totalPages={totalPages}
          sortBy={filters.sortBy}
          sortDir={filters.sortDir}
          onSortChange={(sortBy, sortDir) =>
            updateParams({ sortBy, sortDir, page: "1" })
          }
          onPageChange={(page) => updateParams({ page: String(page) })}
        />
      )}
    </div>
  );
}

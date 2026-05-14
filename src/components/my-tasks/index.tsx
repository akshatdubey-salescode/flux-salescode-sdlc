"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ListView } from "../project-tracking/list-view";
import { MyTasksFilterBar } from "./filter-bar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserInsightsDashboard } from "./user-insights-dashboard";
import { usePinnedTasks } from "./use-pinned-tasks";
import type { MyTasksFields, MyTasksFilterState, TrackingIssue } from "./helpers";

function readFilters(
  searchParams: ReturnType<typeof useSearchParams>
): MyTasksFilterState {
  return {
    q: searchParams.get("q") ?? "",
    projects: searchParams.get("projects")?.split(",").filter(Boolean) ?? [],
    status: searchParams.get("status")?.split(",").filter(Boolean) ?? [],
    priority: searchParams.get("priority")?.split(",").filter(Boolean) ?? [],
    assignee: [], // Always the current user, so we don't need this filter here
    reporter: searchParams.get("reporter")?.split(",").filter(Boolean) ?? [],
    issueType: searchParams.get("issueType")?.split(",").filter(Boolean) ?? [],
    labels: searchParams.get("labels")?.split(",").filter(Boolean) ?? [],
    dateFrom: searchParams.get("dateFrom") ?? "",
    dateTo: searchParams.get("dateTo") ?? "",
    hasComments: searchParams.get("hasComments") === "true",
    showCompleted: searchParams.get("showCompleted") === "true",
    sortBy: searchParams.get("sortBy") ?? "created",
    sortDir: searchParams.get("sortDir") === "asc" ? "asc" : "desc",
    view: "list", // Only list view for My Tasks for now
    page: Math.max(1, parseInt(searchParams.get("page") ?? "1", 10)),
  };
}

export function MyTasksView({
  targetEmail,
  renderIssueActions,
  hideTabs = false,
}: {
  targetEmail?: string;
  renderIssueActions?: (issue: TrackingIssue) => React.ReactNode;
  hideTabs?: boolean;
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = readFilters(searchParams);
  const activeTab = searchParams.get("tab") === "insights" ? "insights" : "list";

  const { pinnedKeys, togglePin } = usePinnedTasks();
  const isObserving = !!targetEmail;
  const [issues, setIssues] = useState<TrackingIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<MyTasksFields | null>(null);

  const filterKey = JSON.stringify({
    targetEmail,
    q: filters.q,
    projects: filters.projects,
    status: filters.status,
    priority: filters.priority,
    reporter: filters.reporter,
    issueType: filters.issueType,
    labels: filters.labels,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    hasComments: filters.hasComments,
    showCompleted: filters.showCompleted,
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
    page: filters.page,
  });

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

  function handleTabChange(value: string) {
    updateParams({ tab: value });
  }

  useEffect(() => {
    const url = targetEmail
      ? `/api/my-tasks/fields?forEmail=${encodeURIComponent(targetEmail)}`
      : "/api/my-tasks/fields";
    fetch(url)
      .then((r) => r.json())
      .then(setFields)
      .catch(() => {});
  }, [targetEmail]);

  useEffect(() => {
    const params = new URLSearchParams();
    const parsed: MyTasksFilterState = JSON.parse(filterKey);

    if (parsed.q) params.set("q", parsed.q);
    if (parsed.projects.length) params.set("projects", parsed.projects.join(","));
    if (parsed.status.length) params.set("status", parsed.status.join(","));
    if (parsed.priority.length) params.set("priority", parsed.priority.join(","));
    if (parsed.reporter.length) params.set("reporter", parsed.reporter.join(","));
    if (parsed.issueType.length) params.set("issueType", parsed.issueType.join(","));
    if (parsed.labels.length) params.set("labels", parsed.labels.join(","));
    if (parsed.dateFrom) params.set("dateFrom", parsed.dateFrom);
    if (parsed.dateTo) params.set("dateTo", parsed.dateTo);
    if (parsed.hasComments) params.set("hasComments", "true");
    if (parsed.showCompleted) params.set("showCompleted", "true");
    params.set("sortBy", parsed.sortBy);
    params.set("sortDir", parsed.sortDir);
    params.set("pageSize", "50");
    params.set("page", String(parsed.page));

    if (targetEmail) params.set("forEmail", targetEmail);

    setLoading(true);
    fetch(`/api/my-tasks?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setIssues(data.issues ?? []);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 1);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterKey]);

  const sortedIssues = isObserving
    ? issues
    : [
        ...issues.filter((i) => pinnedKeys.has(i.jiraKey)),
        ...issues.filter((i) => !pinnedKeys.has(i.jiraKey)),
      ];
  const pinnedCount = isObserving
    ? 0
    : sortedIssues.filter((i) => pinnedKeys.has(i.jiraKey)).length;

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-4">
      {!isObserving && !hideTabs && (
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="list">Tasks List</TabsTrigger>
            <TabsTrigger value="insights">My Insights</TabsTrigger>
          </TabsList>
        </div>
      )}

      <TabsContent value="list" className="space-y-4 outline-none">
        <MyTasksFilterBar
          filters={filters}
          fields={fields}
          onUpdate={updateParams}
          total={total}
        />

        <ListView
          issues={sortedIssues}
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
          renderActions={renderIssueActions}
          {...(!isObserving && {
            pinnedKeys,
            onPinToggle: togglePin,
            pinnedCount,
          })}
        />
      </TabsContent>

      {!isObserving && (
        <TabsContent value="insights" className="outline-none">
          <UserInsightsDashboard />
        </TabsContent>
      )}
    </Tabs>
  );
}

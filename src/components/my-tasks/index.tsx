"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ListView } from "../project-tracking/list-view";
import { MyTasksFilterBar } from "./filter-bar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RiDownload2Line, RiLayoutColumnLine } from "@remixicon/react";
import { UserInsightsDashboard } from "./user-insights-dashboard";
import { MyMeetings } from "./my-meetings";
import { usePinnedTasks } from "./use-pinned-tasks";
import {
  useColumnVisibility,
  TOGGLEABLE_COLUMNS,
} from "./use-column-visibility";
import type { MyTasksFields, MyTasksFilterState, TrackingIssue } from "./helpers";
import {
  quarterBounds,
  currentFyStartYear,
  currentQuarterNum,
} from "@/lib/date-utils";

const SHOW_COMPLETED_KEY = "myTasks.showCompleted";
const INCLUDE_REPORTED_KEY = "myTasks.includeReported";

function readShowCompletedPref(): boolean {
  try {
    return localStorage.getItem(SHOW_COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveShowCompletedPref(value: boolean) {
  try {
    localStorage.setItem(SHOW_COMPLETED_KEY, value ? "true" : "false");
  } catch {
    // ignore
  }
}

function readIncludeReportedPref(): boolean {
  try {
    return localStorage.getItem(INCLUDE_REPORTED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveIncludeReportedPref(value: boolean) {
  try {
    localStorage.setItem(INCLUDE_REPORTED_KEY, value ? "true" : "false");
  } catch {
    // ignore
  }
}

function readFilters(
  searchParams: ReturnType<typeof useSearchParams>
): MyTasksFilterState {
  const urlShowCompleted = searchParams.get("showCompleted");
  const showCompleted =
    urlShowCompleted !== null ? urlShowCompleted === "true" : readShowCompletedPref();

  const urlIncludeReported = searchParams.get("includeReported");
  const includeReported =
    urlIncludeReported !== null ? urlIncludeReported === "true" : readIncludeReportedPref();

  const qstartParam = searchParams.get("qstart");
  const qendParam = searchParams.get("qend");

  let qstart = "";
  let qend = "";

  if (qstartParam === null) {
    const defaultBounds = quarterBounds(currentFyStartYear(), currentQuarterNum());
    qstart = defaultBounds.start;
    qend = defaultBounds.end;
  } else if (qstartParam !== "all") {
    qstart = qstartParam;
    qend = qendParam ?? "";
  }

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
    qstart,
    qend,
    showCompleted,
    includeReported,
    unplannedOnly: searchParams.get("unplannedOnly") === "true",
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
  const tabParam = searchParams.get("tab");
  const activeTab =
    tabParam === "insights" || tabParam === "meetings" ? tabParam : "list";

  const { pinnedKeys, togglePin } = usePinnedTasks();
  const { visibleColumns, toggleColumn, resetColumns } = useColumnVisibility();
  const isObserving = !!targetEmail;
  const [issues, setIssues] = useState<TrackingIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<MyTasksFields | null>(null);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.projects.length) params.set("projects", filters.projects.join(","));
      if (filters.status.length) params.set("status", filters.status.join(","));
      if (filters.priority.length) params.set("priority", filters.priority.join(","));
      if (filters.reporter.length) params.set("reporter", filters.reporter.join(","));
      if (filters.issueType.length) params.set("issueType", filters.issueType.join(","));
      if (filters.labels.length) params.set("labels", filters.labels.join(","));
      const effectiveDateFrom = filters.qstart || filters.dateFrom;
      const effectiveDateTo = filters.qend || filters.dateTo;
      if (effectiveDateFrom) params.set("dateFrom", effectiveDateFrom);
      if (effectiveDateTo) params.set("dateTo", effectiveDateTo);
      if (filters.showCompleted) params.set("showCompleted", "true");
      if (filters.includeReported) params.set("includeReported", "true");
      if (filters.unplannedOnly) params.set("unplannedOnly", "true");
      params.set("sortBy", filters.sortBy);
      params.set("sortDir", filters.sortDir);
      if (targetEmail) params.set("forEmail", targetEmail);

      const res = await fetch(`/api/my-tasks/export?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();

      const today = new Date().toISOString().split("T")[0];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tasks-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore — user can retry
    } finally {
      setExporting(false);
    }
  }

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
    qstart: filters.qstart,
    qend: filters.qend,
    showCompleted: filters.showCompleted,
    includeReported: filters.includeReported,
    unplannedOnly: filters.unplannedOnly,
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
    if ("showCompleted" in updates) {
      saveShowCompletedPref(updates.showCompleted === "true");
    }
    if ("includeReported" in updates) {
      saveIncludeReportedPref(updates.includeReported === "true");
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
    if (searchParams.get("qstart") === null) {
      const defaultBounds = quarterBounds(currentFyStartYear(), currentQuarterNum());
      const params = new URLSearchParams(searchParams.toString());
      params.set("qstart", defaultBounds.start);
      params.set("qend", defaultBounds.end);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [searchParams, router]);

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
    const effectiveDateFrom = parsed.qstart || parsed.dateFrom;
    const effectiveDateTo = parsed.qend || parsed.dateTo;
    if (effectiveDateFrom) params.set("dateFrom", effectiveDateFrom);
    if (effectiveDateTo) params.set("dateTo", effectiveDateTo);
    if (parsed.showCompleted) params.set("showCompleted", "true");
    if (parsed.includeReported) params.set("includeReported", "true");
    if (parsed.unplannedOnly) params.set("unplannedOnly", "true");
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

  const showTabs = !isObserving && !hideTabs;
  const showExport = activeTab === "list";

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-4">
      {(showTabs || showExport) && (
        <div className="flex items-center justify-between gap-2">
          {showTabs ? (
            <TabsList>
              <TabsTrigger value="list">Tasks List</TabsTrigger>
              <TabsTrigger value="insights">My Insights</TabsTrigger>
              <TabsTrigger value="meetings">My Meetings</TabsTrigger>
            </TabsList>
          ) : (
            <div />
          )}
          {showExport && (
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <RiLayoutColumnLine className="size-3.5" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {TOGGLEABLE_COLUMNS.map((col) => {
                    const checked = visibleColumns.has(col.key);
                    return (
                      <DropdownMenuCheckboxItem
                        key={col.key}
                        checked={checked}
                        // Prevent the menu from closing on each toggle.
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={() => toggleColumn(col.key)}
                        // Block hiding the last remaining column.
                        disabled={checked && visibleColumns.size <= 1}
                      >
                        {col.label}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={false}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={resetColumns}
                  >
                    Show all
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exporting || total === 0}
              >
                <RiDownload2Line className="size-3.5" />
                {exporting ? "Exporting…" : "Export Excel"}
              </Button>
            </div>
          )}
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
          showPlanned
          visibleColumns={visibleColumns}
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

      {!isObserving && (
        <TabsContent value="meetings" className="outline-none">
          <MyMeetings />
        </TabsContent>
      )}
    </Tabs>
  );
}

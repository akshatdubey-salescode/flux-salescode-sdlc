"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ListView } from "../project-tracking/list-view";
import { SearchFilterBar } from "./filter-bar";
import type { GlobalSearchFields, GlobalSearchFilterState, TrackingIssue } from "./helpers";

function readFilters(
  searchParams: ReturnType<typeof useSearchParams>
): GlobalSearchFilterState {
  return {
    q: searchParams.get("q") ?? "",
    projects: searchParams.get("projects")?.split(",").filter(Boolean) ?? [],
    status: searchParams.get("status")?.split(",").filter(Boolean) ?? [],
    priority: searchParams.get("priority")?.split(",").filter(Boolean) ?? [],
    assignee: searchParams.get("assignee")?.split(",").filter(Boolean) ?? [],
    reporter: searchParams.get("reporter")?.split(",").filter(Boolean) ?? [],
    issueType: searchParams.get("issueType")?.split(",").filter(Boolean) ?? [],
    labels: searchParams.get("labels")?.split(",").filter(Boolean) ?? [],
    dateFrom: searchParams.get("dateFrom") ?? "",
    dateTo: searchParams.get("dateTo") ?? "",
    deliveryDateFrom: searchParams.get("deliveryDateFrom") ?? "",
    deliveryDateTo: searchParams.get("deliveryDateTo") ?? "",
    showCompleted: false,
    sortBy: searchParams.get("sortBy") ?? "updated",
    sortDir: searchParams.get("sortDir") === "asc" ? "asc" : "desc",
    view: "list",
    page: Math.max(1, parseInt(searchParams.get("page") ?? "1", 10)),
  };
}

export function SearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = readFilters(searchParams);

  const [issues, setIssues] = useState<TrackingIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<GlobalSearchFields | null>(null);

  const filterKey = JSON.stringify({
    q: filters.q,
    projects: filters.projects,
    status: filters.status,
    priority: filters.priority,
    assignee: filters.assignee,
    reporter: filters.reporter,
    issueType: filters.issueType,
    labels: filters.labels,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    deliveryDateFrom: filters.deliveryDateFrom,
    deliveryDateTo: filters.deliveryDateTo,
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

  useEffect(() => {
    fetch("/api/search/fields")
      .then((r) => r.json())
      .then(setFields)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    const parsed: GlobalSearchFilterState = JSON.parse(filterKey);

    if (parsed.q) params.set("q", parsed.q);
    if (parsed.projects.length) params.set("projects", parsed.projects.join(","));
    if (parsed.status.length) params.set("status", parsed.status.join(","));
    if (parsed.priority.length) params.set("priority", parsed.priority.join(","));
    if (parsed.assignee.length) params.set("assignee", parsed.assignee.join(","));
    if (parsed.reporter.length) params.set("reporter", parsed.reporter.join(","));
    if (parsed.issueType.length) params.set("issueType", parsed.issueType.join(","));
    if (parsed.labels.length) params.set("labels", parsed.labels.join(","));
    if (parsed.dateFrom) params.set("dateFrom", parsed.dateFrom);
    if (parsed.dateTo) params.set("dateTo", parsed.dateTo);
    if (parsed.deliveryDateFrom) params.set("deliveryDateFrom", parsed.deliveryDateFrom);
    if (parsed.deliveryDateTo) params.set("deliveryDateTo", parsed.deliveryDateTo);
    params.set("sortBy", parsed.sortBy);
    params.set("sortDir", parsed.sortDir);
    params.set("pageSize", "50");
    params.set("page", String(parsed.page));

    setLoading(true);
    fetch(`/api/search?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setIssues(data.issues ?? []);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 1);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterKey]);

  return (
    <div className="space-y-4">
      <SearchFilterBar
        filters={filters}
        fields={fields}
        onUpdate={updateParams}
        total={total}
      />

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
    </div>
  );
}

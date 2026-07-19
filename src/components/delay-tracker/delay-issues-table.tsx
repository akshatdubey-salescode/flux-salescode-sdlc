"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RiExternalLinkLine,
  RiInboxLine,
  RiSearchLine,
  RiArrowDownSLine,
  RiCloseLine,
} from "@remixicon/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getQuarterChips } from "@/lib/date-utils";
import { DELAY_CATEGORIES } from "@/lib/delay-tracker/categories";
import type { DelayedIssueRow, DelayedIssuesResponse } from "@/app/api/delay-tracker/issues/route";
import type { DelayFilterOptions } from "@/app/api/delay-tracker/filters/route";
import { DelayLogButton } from "./delay-log-button";
import { PersonPicker } from "./person-picker";

type DelayIssuesFilter = {
  projectIds: string[];
  categories: string[];
  responsibleEmail: string | null;
  responsibleName: string | null;
  dateFrom: string | null;
  dateTo: string | null;
};

function parseFilter(params: URLSearchParams): DelayIssuesFilter {
  return {
    projectIds: (params.get("projectIds") ?? "").split(",").filter(Boolean),
    categories: (params.get("categories") ?? "").split(",").filter(Boolean),
    responsibleEmail: params.get("responsibleEmail"),
    responsibleName: params.get("responsibleName"),
    dateFrom: params.get("dateFrom"),
    dateTo: params.get("dateTo"),
  };
}

function filterToParams(filter: DelayIssuesFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.projectIds.length > 0) params.set("projectIds", filter.projectIds.join(","));
  if (filter.categories.length > 0) params.set("categories", filter.categories.join(","));
  if (filter.responsibleEmail) {
    params.set("responsibleEmail", filter.responsibleEmail);
    if (filter.responsibleName) params.set("responsibleName", filter.responsibleName);
  }
  if (filter.dateFrom) params.set("dateFrom", filter.dateFrom);
  if (filter.dateTo) params.set("dateTo", filter.dateTo);
  return params;
}

/**
 * The delayed issues behind an analytics drill-down, with its own filter bar
 * (project, reason, responsible person, delay date range) — same "click an
 * analytics number, see the issues" shape this app already uses elsewhere,
 * now upgraded with real filters matching My Tasks/Bug Summary's convention.
 * Filter state lives entirely in the URL (read via `useSearchParams`, written
 * via `router.push`) so it's shareable/bookmarkable and survives a reload —
 * same idiom `MyTasksFilterBar` uses, just without that file's bug-specific
 * concepts (this page's rows can be any issue type, not just bugs).
 *
 * Rows are grouped into sections by responsible person rather than one flat
 * list — this is what makes "click one person's leaderboard row" (one
 * group) and "click the card header" (every group) the same table.
 */
export function DelayIssuesTable() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filter = useMemo(() => parseFilter(searchParams), [searchParams]);

  const [result, setResult] = useState<{ issues: DelayedIssueRow[]; truncated: boolean } | null>(null);
  const [options, setOptions] = useState<DelayFilterOptions | null>(null);
  const [dateFromDraft, setDateFromDraft] = useState(filter.dateFrom ?? "");
  const [dateToDraft, setDateToDraft] = useState(filter.dateTo ?? "");

  useEffect(() => {
    fetch("/api/delay-tracker/filters")
      .then((r) => r.json())
      .then(setOptions)
      .catch(() => setOptions({ projects: [] }));
  }, []);

  useEffect(() => {
    const params = filterToParams(filter);
    fetch(`/api/delay-tracker/issues?${params}`)
      .then((r) => r.json())
      .then((d: DelayedIssuesResponse) => setResult({ issues: d.issues, truncated: d.truncated }))
      .catch(() => setResult({ issues: [], truncated: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter is derived from searchParams itself
  }, [filter.projectIds.join(","), filter.categories.join(","), filter.responsibleEmail, filter.dateFrom, filter.dateTo]);

  useEffect(() => {
    setDateFromDraft(filter.dateFrom ?? "");
    setDateToDraft(filter.dateTo ?? "");
  }, [filter.dateFrom, filter.dateTo]);

  function updateFilter(patch: Partial<DelayIssuesFilter>) {
    const params = filterToParams({ ...filter, ...patch });
    router.push(`/delay-tracker${params.toString() ? `?${params}` : ""}`, { scroll: false });
  }

  const hasActiveFilter =
    filter.projectIds.length > 0 ||
    filter.categories.length > 0 ||
    !!filter.responsibleEmail ||
    !!filter.dateFrom ||
    !!filter.dateTo;

  const groups = useMemo(() => {
    if (!result) return null;
    const byPerson = new Map<string, { key: string; name: string; issues: DelayedIssueRow[] }>();
    for (const it of result.issues) {
      const key = it.responsibleEmail ?? "__unassigned__";
      let g = byPerson.get(key);
      if (!g) {
        g = { key, name: it.responsibleName ?? "Unassigned", issues: [] };
        byPerson.set(key, g);
      }
      g.issues.push(it);
    }
    return [...byPerson.values()].sort(
      (a, b) => b.issues.length - a.issues.length || a.name.localeCompare(b.name)
    );
  }, [result]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectFilter
          label="Project"
          options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          selected={filter.projectIds}
          onChange={(projectIds) => updateFilter({ projectIds })}
          searchable
        />
        <MultiSelectFilter
          label="Reason"
          options={DELAY_CATEGORIES}
          selected={filter.categories}
          onChange={(categories) => updateFilter({ categories })}
        />
        <div className="flex items-center gap-1">
          <div className="w-44">
            <PersonPicker
              value={filter.responsibleEmail ? { email: filter.responsibleEmail, name: filter.responsibleName ?? filter.responsibleEmail } : null}
              onChange={(p) => updateFilter({ responsibleEmail: p?.email ?? null, responsibleName: p?.name ?? null })}
            />
          </div>
          {filter.responsibleEmail && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear responsible person filter"
              onClick={() => updateFilter({ responsibleEmail: null, responsibleName: null })}
            >
              <RiCloseLine className="size-3.5" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {getQuarterChips().map((q) => {
            const active = filter.dateFrom === q.start && filter.dateTo === q.end;
            return (
              <button
                key={q.label}
                type="button"
                onClick={() => updateFilter({ dateFrom: active ? null : q.start, dateTo: active ? null : q.end })}
                className={cn(
                  "h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "border border-input bg-transparent text-foreground hover:bg-muted/50"
                )}
              >
                {q.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Label className="text-muted-foreground">From</Label>
          <Input
            type="date"
            value={dateFromDraft}
            onChange={(e) => setDateFromDraft(e.target.value)}
            onBlur={() => updateFilter({ dateFrom: dateFromDraft || null })}
            className="h-7 w-36 text-xs"
          />
          <Label className="text-muted-foreground">To</Label>
          <Input
            type="date"
            value={dateToDraft}
            onChange={(e) => setDateToDraft(e.target.value)}
            onBlur={() => updateFilter({ dateTo: dateToDraft || null })}
            className="h-7 w-36 text-xs"
          />
        </div>
        {hasActiveFilter && (
          <Button variant="ghost" size="sm" onClick={() => router.push("/delay-tracker")}>
            Clear filters
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {result
          ? `${result.issues.length}${result.truncated ? "+" : ""} delayed issue${result.issues.length === 1 ? "" : "s"}`
          : ""}
        {" · click a key to open it in Jira"}
      </p>

      {result === null ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded" />
          ))}
        </div>
      ) : result.issues.length === 0 ? (
        <EmptyState message="No delayed issues match this filter" />
      ) : (
        <div className="space-y-5">
          {groups!.map((group) => (
            <div key={group.key} className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {group.name} <span className="normal-case text-muted-foreground/70">· {group.issues.length}</span>
              </p>
              <IssueTable issues={group.issues} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IssueTable({ issues }: { issues: DelayedIssueRow[] }) {
  return (
    <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[96px]" />
          <col />
          <col className="w-[140px]" />
          <col className="w-[160px]" />
          <col className="w-[96px]" />
          <col className="w-[40px]" />
        </colgroup>
        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Key</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Summary</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Project</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Reason</th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Date</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {issues.map((it) => (
            <tr key={it.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-3 py-2">
                <a
                  href={it.jiraUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-1 font-mono text-xs font-medium text-primary hover:underline"
                >
                  <span className="truncate">{it.jiraKey}</span>
                  <RiExternalLinkLine className="size-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground" />
                </a>
              </td>
              <td className="px-3 py-2">
                <span className="block truncate" title={it.summary}>{it.summary}</span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                <span className="block truncate" title={it.projectName}>{it.projectName}</span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                <span className="block truncate">{it.categoryLabel}</span>
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-muted-foreground">
                {it.delayDate}
              </td>
              <td className="px-2 py-2">
                <DelayLogButton issueId={it.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  searchable = false,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const hasSelection = selected.length > 0;
  const filteredOptions =
    searchable && query.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
      : options;

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
            hasSelection
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-input bg-transparent text-foreground hover:bg-muted/50"
          )}
        >
          {label}
          {hasSelection && (
            <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground leading-none">
              {selected.length}
            </span>
          )}
          <RiArrowDownSLine className="size-3.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        {searchable && (
          <div className="relative border-b border-border">
            <RiSearchLine className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-8 w-full bg-transparent pl-7 pr-2 text-xs outline-none"
            />
          </div>
        )}
        <div className="max-h-64 overflow-auto p-1">
          {filteredOptions.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No options</p>
          ) : (
            filteredOptions.map((o) => (
              <label
                key={o.value}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10">
      <RiInboxLine className="size-5 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

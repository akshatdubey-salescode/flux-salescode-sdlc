"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RiSearchLine, RiCloseLine, RiUser3Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { statusCategoryStyles, priorityStyles, issueTypeStyles } from "@/components/project-tracking/helpers";

export type IssueResult = { id: string; jiraKey: string; summary: string };

/** What /api/search actually returns per issue — a superset of IssueResult. */
type IssueSearchRow = IssueResult & {
  status: string | null;
  statusCategory: string | null;
  issueType: string | null;
  priority: string | null;
  assigneeName: string | null;
  /** Nearest active delivery's date, null when in none — flags "in another delivery" rows when they're shown. */
  deliveryDate: string | null;
};

/**
 * Rows per request. 100 covers a typical filtered search in one round trip
 * while still rendering instantly; the API caps pageSize at 200. Further
 * pages append on scroll (or via the button) — the first cut of this picker
 * stopped at one page of 50 and nothing past it could be selected at all.
 */
const PAGE_SIZE = 100;

/** Appends a page, dropping any row already present — the ordering can shift between pages while issues sync in mid-scroll. */
function mergeResults(prev: IssueSearchRow[], next: IssueSearchRow[]): IssueSearchRow[] {
  const seen = new Set(prev.map((r) => r.id));
  return [...prev, ...next.filter((r) => !seen.has(r.id))];
}

/**
 * Multi-select Jira issue search, scoped to one project — a full dialog
 * (not a popover) so there's room to show each result's type/status/
 * priority/assignee and to review the picked set before committing. The
 * selection is transactional: "Add" submits it, closing any other way
 * discards it. Results page in as you scroll, so any issue in the project
 * is reachable, not just the first screen.
 */
export function IssueMultiPicker({
  projectId,
  value,
  onChange,
  existingIssueIds,
  onSubmit,
  submitting,
  scopeComment,
  excludeOtherDeliveries,
}: {
  /** Scope the search to one project; null/undefined searches across ALL projects (e.g. Team Pulse board sprints). */
  projectId: string | null | undefined;
  value: IssueResult[];
  onChange: (issues: IssueResult[]) => void;
  /** Issues already in the delivery — shown as "Already added" and not selectable. */
  existingIssueIds?: ReadonlySet<string>;
  /** Commits the current selection (the parent owns the POST); the dialog closes after it resolves. Receives the scope-change reason when `scopeComment` is set. */
  onSubmit?: (comment?: string) => Promise<void> | void;
  submitting?: boolean;
  /** When set (e.g. adding to a started sprint), a REQUIRED reason field is shown and passed to onSubmit — no silent scope change. */
  scopeComment?: { placeholder: string };
  /**
   * Set when adding to a delivery: issues already committed to ANY other
   * delivery are hidden by default — server-side, so paging and the total
   * agree — with an in-dialog toggle for the rare deliberate re-add. This
   * delivery's own items still show as "Already added". Leave unset for
   * sprints: sprint membership isn't exclusive.
   */
  excludeOtherDeliveries?: { currentDeliveryId: string };
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [comment, setComment] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [showOtherDeliveries, setShowOtherDeliveries] = useState(false);
  // Not useDebouncedSearch: this view also needs the response's `total`,
  // an explicit loading flag, and append-style paging — none of which that
  // hook surfaces.
  const [results, setResults] = useState<IssueSearchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Bumped whenever the search inputs change, so a slow response for an
  // earlier query (first page or a later one) can never overwrite fresher rows.
  const requestSeq = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const currentDeliveryId = excludeOtherDeliveries?.currentDeliveryId;
  const hideOtherDeliveries = !!currentDeliveryId && !showOtherDeliveries;

  const buildParams = useCallback(
    (pageNumber: number) => {
      const params = new URLSearchParams({ q: query, pageSize: String(PAGE_SIZE), page: String(pageNumber) });
      if (projectId) params.set("projects", projectId);
      // dateFrom/dateTo filter on the issue's Jira creation date server-side.
      if (createdFrom) params.set("dateFrom", createdFrom);
      if (createdTo) params.set("dateTo", createdTo);
      if (hideOtherDeliveries && currentDeliveryId) {
        params.set("excludeDeliveryIssues", "1");
        params.set("exceptDeliveryId", currentDeliveryId);
      }
      return params;
    },
    [query, projectId, createdFrom, createdTo, hideOtherDeliveries, currentDeliveryId]
  );

  // First page — replaces the list whenever any search input changes.
  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadingMore(false);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?${buildParams(1).toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { issues: IssueSearchRow[]; total: number };
        if (requestSeq.current !== seq) return;
        setResults(data.issues ?? []);
        setTotal(data.total ?? 0);
        setPage(1);
      } catch {
        if (requestSeq.current !== seq) return;
        setResults([]);
        setTotal(0);
        setPage(1);
      } finally {
        if (requestSeq.current === seq) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timeout);
      requestSeq.current += 1;
    };
  }, [open, buildParams]);

  const hasMore = results.length < total;

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    const seq = requestSeq.current;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/search?${buildParams(nextPage).toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { issues: IssueSearchRow[]; total: number };
      if (requestSeq.current !== seq) return;
      setResults((prev) => mergeResults(prev, data.issues ?? []));
      setTotal(data.total ?? 0);
      setPage(nextPage);
    } catch {
      // Keep what's loaded — the "Load more" button stays put for a retry.
    } finally {
      if (requestSeq.current === seq) setLoadingMore(false);
    }
  }, [loading, loadingMore, hasMore, page, buildParams]);

  // Infinite scroll: the sentinel sits after the last row, so reaching the
  // bottom pulls the next page without a click. observe() fires once on
  // attach too, so re-attaching after a load settles retries on its own if
  // the sentinel is still in view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!open || !hasMore || !el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, hasMore, loadMore]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Dismissing without adding discards the picked set — there's no
      // visible "pending selection" UI outside this dialog to come back to.
      onChange([]);
      setQuery("");
      setComment("");
      setCreatedFrom("");
      setCreatedTo("");
      setShowOtherDeliveries(false);
    }
  }

  function toggle(issue: IssueResult) {
    const exists = value.some((i) => i.id === issue.id);
    onChange(
      exists
        ? value.filter((i) => i.id !== issue.id)
        : [...value, { id: issue.id, jiraKey: issue.jiraKey, summary: issue.summary }]
    );
  }

  const commentMissing = !!scopeComment && !comment.trim();

  async function handleAdd() {
    if (value.length === 0 || commentMissing) return;
    await onSubmit?.(scopeComment ? comment.trim() : undefined);
    setOpen(false);
    setQuery("");
    setComment("");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start gap-1.5">
          <RiSearchLine className="size-3.5 shrink-0 opacity-60" />
          <span className="truncate text-muted-foreground">Search issues to add…</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(640px,85vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>Add issues to this delivery</DialogTitle>
          <DialogDescription>
            Search this project&apos;s Jira issues by key or summary, then add everything committed to this delivery.
            {currentDeliveryId &&
              " Issues already committed to another delivery are hidden — flip the toggle to include them."}
          </DialogDescription>
        </DialogHeader>

        <Command shouldFilter={false} className="min-h-0 flex-1 rounded-none bg-transparent">
          <CommandInput placeholder="Search by key or summary…" value={query} onValueChange={setQuery} autoFocus />
          <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2">
            <Label className="shrink-0 text-[11px] text-muted-foreground">Created</Label>
            <Input
              type="date"
              value={createdFrom}
              max={createdTo || undefined}
              onChange={(e) => setCreatedFrom(e.target.value)}
              className="h-7 w-36 text-xs"
              aria-label="Created from"
            />
            <span className="text-[11px] text-muted-foreground">to</span>
            <Input
              type="date"
              value={createdTo}
              min={createdFrom || undefined}
              onChange={(e) => setCreatedTo(e.target.value)}
              className="h-7 w-36 text-xs"
              aria-label="Created to"
            />
            {(createdFrom || createdTo) && (
              <button
                type="button"
                onClick={() => {
                  setCreatedFrom("");
                  setCreatedTo("");
                }}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear dates
              </button>
            )}
            {currentDeliveryId && (
              <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Switch
                  checked={showOtherDeliveries}
                  onCheckedChange={setShowOtherDeliveries}
                  aria-label="Show issues already in another delivery"
                />
                Show issues already in another delivery
              </label>
            )}
          </div>
          <CommandList className="max-h-none flex-1">
            <CommandEmpty>{loading ? "Searching…" : "No matching issue."}</CommandEmpty>
            <CommandGroup>
              {results.map((issue) => {
                const alreadyAdded = existingIssueIds?.has(issue.id) ?? false;
                const selected = value.some((v) => v.id === issue.id);
                // Only meaningful in delivery context — and only for rows the
                // toggle let through (they'd be hidden otherwise).
                const inOtherDelivery = !!currentDeliveryId && !alreadyAdded && !!issue.deliveryDate;
                const type = issueTypeStyles(issue.issueType ?? "");
                const priority = priorityStyles(issue.priority);
                return (
                  <CommandItem
                    key={issue.id}
                    value={issue.id}
                    disabled={alreadyAdded}
                    onSelect={() => toggle(issue)}
                    className="gap-2.5 py-2"
                  >
                    <Checkbox checked={alreadyAdded || selected} disabled={alreadyAdded} className="pointer-events-none" />
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold",
                        type.bg,
                        type.text
                      )}
                      title={issue.issueType ?? undefined}
                    >
                      {type.abbr}
                    </span>
                    <span className="shrink-0 font-mono font-medium">{issue.jiraKey}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{issue.summary}</span>
                    {alreadyAdded ? (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Already added
                      </span>
                    ) : (
                      <>
                        {inOtherDelivery && (
                          <span
                            className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                            title={`Already committed to a delivery dated ${issue.deliveryDate}`}
                          >
                            In another delivery
                          </span>
                        )}
                        {issue.status && (
                          <span
                            className={cn(
                              "hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline",
                              statusCategoryStyles(issue.statusCategory).badge
                            )}
                          >
                            {issue.status}
                          </span>
                        )}
                        {issue.priority && (
                          <span className={cn("hidden shrink-0 items-center gap-1 text-[10px] md:flex", priority.text)}>
                            <span className={cn("size-1.5 rounded-full", priority.dot)} />
                            {issue.priority}
                          </span>
                        )}
                        <span className="hidden max-w-28 shrink-0 items-center gap-1 truncate text-[10px] text-muted-foreground lg:flex">
                          <RiUser3Line className="size-3 shrink-0 opacity-60" />
                          <span className="truncate">{issue.assigneeName ?? "Unassigned"}</span>
                        </span>
                      </>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {hasMore && (
              <div ref={sentinelRef} className="flex items-center justify-center py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Loading more…" : `Load more (${total - results.length} remaining)`}
                </Button>
              </div>
            )}
          </CommandList>
        </Command>

        <div className="space-y-2 border-t border-border px-4 py-3">
          {scopeComment && value.length > 0 && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Reason for adding mid-sprint (required)</Label>
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={scopeComment.placeholder}
              />
            </div>
          )}
          {value.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {value.map((i) => (
                <span key={i.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                  <span className="font-mono">{i.jiraKey}</span>
                  <button
                    type="button"
                    onClick={() => toggle(i)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <RiCloseLine className="size-3" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => onChange([])}
                className="ml-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear all
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              {loading
                ? "Searching…"
                : hasMore
                  ? `Showing ${results.length} of ${total} — scroll for more, or refine the search`
                  : `${results.length} result${results.length === 1 ? "" : "s"}`}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={value.length === 0 || commentMissing || submitting} onClick={handleAdd}>
                {submitting
                  ? "Adding…"
                  : value.length > 0
                    ? `Add ${value.length} issue${value.length === 1 ? "" : "s"}`
                    : "Add issues"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
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
};

/**
 * Multi-select Jira issue search, scoped to one project — a full dialog
 * (not a popover) so there's room to show each result's type/status/
 * priority/assignee and to review the picked set before committing. The
 * selection is transactional: "Add" submits it, closing any other way
 * discards it.
 */
export function IssueMultiPicker({
  projectId,
  value,
  onChange,
  existingIssueIds,
  onSubmit,
  submitting,
}: {
  projectId: string;
  value: IssueResult[];
  onChange: (issues: IssueResult[]) => void;
  /** Issues already in the delivery — shown as "Already added" and not selectable. */
  existingIssueIds?: ReadonlySet<string>;
  /** Commits the current selection (the parent owns the POST); the dialog closes after it resolves. */
  onSubmit?: () => Promise<void> | void;
  submitting?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  // Not useDebouncedSearch: this view also needs the response's `total`
  // and an explicit loading flag, which that hook doesn't surface.
  const [results, setResults] = useState<IssueSearchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ projects: projectId, q: query, pageSize: "50" });
        // dateFrom/dateTo filter on the issue's Jira creation date server-side.
        if (createdFrom) params.set("dateFrom", createdFrom);
        if (createdTo) params.set("dateTo", createdTo);
        const res = await fetch(`/api/search?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { issues: IssueSearchRow[]; total: number };
        if (!cancelled) {
          setResults(data.issues ?? []);
          setTotal(data.total ?? 0);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [open, query, projectId, createdFrom, createdTo]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Dismissing without adding discards the picked set — there's no
      // visible "pending selection" UI outside this dialog to come back to.
      onChange([]);
      setQuery("");
      setCreatedFrom("");
      setCreatedTo("");
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

  async function handleAdd() {
    if (value.length === 0) return;
    await onSubmit?.();
    setOpen(false);
    setQuery("");
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
          </div>
          <CommandList className="max-h-none flex-1">
            <CommandEmpty>{loading ? "Searching…" : "No matching issue."}</CommandEmpty>
            <CommandGroup>
              {results.map((issue) => {
                const alreadyAdded = existingIssueIds?.has(issue.id) ?? false;
                const selected = value.some((v) => v.id === issue.id);
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
          </CommandList>
        </Command>

        <div className="space-y-2 border-t border-border px-4 py-3">
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
                : total > results.length
                  ? `Showing ${results.length} of ${total} — refine the search to narrow down`
                  : `${results.length} result${results.length === 1 ? "" : "s"}`}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={value.length === 0 || submitting} onClick={handleAdd}>
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

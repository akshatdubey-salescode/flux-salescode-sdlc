"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RiAddLine,
  RiCheckLine,
  RiCloseLine,
  RiGitBranchLine,
  RiSearchLine,
} from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { searchRepoBranches, setRepoExtraBranches } from "./actions";

export type RepoRow = {
  id: string;
  fullName: string;
  defaultBranch: string | null;
  extraBranches: string[];
  statsMode: string;
};

const MAX_RESULTS = 50;

export function ReposManager({ repos }: { repos: RepoRow[] }) {
  const [query, setQuery] = useState("");

  const configured = useMemo(() => repos.filter((r) => r.extraBranches.length > 0), [repos]);

  const { results, matchCount } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { results: [] as RepoRow[], matchCount: 0 };
    const all = repos.filter((r) => r.fullName.toLowerCase().includes(q));
    return { results: all.slice(0, MAX_RESULTS), matchCount: all.length };
  }, [repos, query]);

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
        Adding branches only updates config. The line counts recompute on the next{" "}
        <span className="font-mono">pnpm sync:github</span> (it clones the repo and walks{" "}
        <span className="font-mono">git log</span> over the default branch plus your extras) —
        these repos are <span className="font-medium">not</span> refreshed by the daily cron.
      </div>

      {/* Search repos */}
      <div className="relative">
        <RiSearchLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <Input
          placeholder="Search repositories by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {query.trim() === "" ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Repos with extra branches{" "}
            <span className="font-normal text-zinc-400">({configured.length})</span>
          </h2>
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
            {configured.length === 0 ? (
              <div className="p-5 text-sm text-zinc-500 dark:text-zinc-400">
                No repos have extra branches yet. Search above to find one and add some.
              </div>
            ) : (
              configured.map((repo) => <RepoRowItem key={repo.id} repo={repo} />)
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
            {results.length === 0 ? (
              <div className="p-5 text-sm text-zinc-500 dark:text-zinc-400">
                No tracked repos match “{query}”.
              </div>
            ) : (
              results.map((repo) => <RepoRowItem key={repo.id} repo={repo} />)
            )}
          </div>
          {matchCount > results.length && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Showing first {results.length} of {matchCount} matches — refine your search.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RepoRowItem({ repo }: { repo: RepoRow }) {
  const router = useRouter();
  const [extras, setExtras] = useState<string[]>(repo.extraBranches);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Branch picker. Branches are searched on GitHub server-side (debounced) so it
  // works even on repos with thousands of branches — we never fetch them all.
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(
      async () => {
        setLoadingBranches(true);
        setBranchError(null);
        const res = await searchRepoBranches(repo.id, search);
        if (cancelled) return;
        if (res.error) setBranchError(res.error);
        else setBranches(res.branches ?? []);
        setLoadingBranches(false);
      },
      search ? 250 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, search, repo.id]);

  /** Persist the full extra-branches list, updating local state on success. */
  function persist(next: string[]) {
    setError(null);
    startTransition(async () => {
      const res = await setRepoExtraBranches(repo.id, next);
      if (res.error) {
        setError(res.error);
        return;
      }
      setExtras(next);
      router.refresh();
    });
  }

  function toggleBranch(name: string) {
    persist(extras.includes(name) ? extras.filter((b) => b !== name) : [...extras, name]);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setSearch("");
  }

  // The default branch is always counted, so it's never an "extra" to pick.
  const options = branches.filter((b) => b !== repo.defaultBranch);

  return (
    <div className={cn("px-5 py-3 space-y-2.5", isPending && "opacity-60")}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {repo.fullName}
        </span>
        {extras.length > 0 && (
          <Badge
            variant="secondary"
            className="shrink-0 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
          >
            git
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Base (always counted) */}
        <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          <RiGitBranchLine className="size-3.5" />
          {repo.defaultBranch ?? "default"}
        </span>

        {/* Configured extra branches, removable */}
        {extras.map((b) => (
          <span
            key={b}
            className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-mono text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-300"
          >
            {b}
            <button
              type="button"
              onClick={() => toggleBranch(b)}
              disabled={isPending}
              aria-label={`Remove ${b}`}
              className="rounded-sm hover:text-violet-900 dark:hover:text-violet-100 disabled:opacity-50"
            >
              <RiCloseLine className="size-3.5" />
            </button>
          </span>
        ))}

        {/* Add-branch picker */}
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={isPending}>
              <RiAddLine className="size-3.5" />
              Add branch
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search branches…"
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                {loadingBranches ? (
                  <div className="p-3 text-sm text-zinc-500 dark:text-zinc-400">Searching…</div>
                ) : branchError ? (
                  <div className="p-3 text-sm text-red-600 dark:text-red-400">{branchError}</div>
                ) : options.length === 0 ? (
                  <div className="p-3 text-sm text-zinc-500 dark:text-zinc-400">
                    {search ? "No matching branch." : "Type to search branches."}
                  </div>
                ) : (
                  <CommandGroup>
                    {options.map((b) => {
                      const selected = extras.includes(b);
                      return (
                        <CommandItem key={b} value={b} onSelect={() => toggleBranch(b)}>
                          <RiCheckLine
                            className={cn("mr-2 size-4", selected ? "opacity-100" : "opacity-0")}
                          />
                          <span className="font-mono text-sm">{b}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

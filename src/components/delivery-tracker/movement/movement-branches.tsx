"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RiGitBranchLine, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api, movementBase } from "./api";
import type { BranchSearchResponse, Checklist, RepoList } from "./api-types";
import { Chip, GuardedButton } from "./ui-bits";
import { classifyFailure } from "./logic";
import { branchHints, branchPayload, branchesDirty, HELD_ONLY_NOTE, isHeldOnly, isValidBranchName, isValidBranchQuery, type ActionState } from "./view-model";

const SEARCH_DEBOUNCE_MS = 250;

/** The chip and the one-line explanation of a saved pick whose repo only held Jiras use. Nothing for any other row. */
export function HeldOnlyFlag({ repo, heldOnly }: { repo: string; heldOnly: boolean }) {
  if (!heldOnly) return null;
  return (
    <>
      <Chip tone="warn" title={HELD_ONLY_NOTE} testId={`movement-branch-heldonly-${repo}`}>
        only used by held Jiras
      </Chip>
    </>
  );
}

export function HeldOnlyNote({ heldOnly }: { heldOnly: boolean }) {
  return heldOnly ? <p className="text-[11px] text-muted-foreground">Only used by held Jiras. {HELD_ONLY_NOTE}</p> : null;
}

interface SearchState {
  loading: boolean;
  branches: string[];
  searched: boolean;
  truncated: boolean;
  error: string | null;
}
const EMPTY: SearchState = { loading: false, branches: [], searched: true, truncated: false, error: null };

/**
 * Search-as-you-type branch picker of one repo: 250 ms debounce, the previous request is aborted
 * when the text changes (an old answer can never replace a newer one), at most 50 results (the
 * server's cap). A repo Flux does not track cannot be searched: the typed name is offered instead.
 */
function BranchPicker({ deliveryId, movementId, repo, value, disabled, onChange }: { deliveryId: string; movementId: string; repo: string; value: string; disabled: boolean; onChange: (b: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [state, setState] = useState<SearchState>(EMPTY);
  const validQuery = isValidBranchQuery(q);

  useEffect(() => {
    if (!open || !validQuery) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      const r = await api<BranchSearchResponse>(`${movementBase(deliveryId, movementId)}/branches?repo=${encodeURIComponent(repo)}&q=${encodeURIComponent(q.trim())}`, {
        signal: ctl.signal,
        timeoutMs: 20_000,
        fallbackError: "Branch search failed",
      });
      if (ctl.signal.aborted || r.aborted) return;
      if (!r.ok || !r.data) setState({ ...EMPTY, error: r.error ?? "Branch search failed" });
      else setState({ loading: false, branches: r.data.branches.slice(0, 50), searched: r.data.searched, truncated: !!r.data.truncated, error: null });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [open, q, validQuery, deliveryId, movementId, repo]);

  const typed = q.trim();
  // An invalid text shows no list from an earlier, valid one (the effect does not run for it, so the old state would linger).
  const branches = validQuery ? state.branches : [];
  const canUseTyped = typed !== "" && isValidBranchName(typed) && !branches.includes(typed);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start gap-1.5 sm:w-64" disabled={disabled} data-testid={`movement-branch-picker-${repo}`} aria-label={`Branch for ${repo}`} title={value || undefined}>
          <RiGitBranchLine className="size-3.5 shrink-0 opacity-60" />
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value || "Choose a branch…"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search branches…" value={q} onValueChange={setQ} data-testid={`movement-branch-search-${repo}`} />
          <CommandList>
            {!validQuery && <p className="p-2 text-[11px] text-muted-foreground">Use letters, digits and . _ - / only (100 characters at most; no “..”, no “//”, no leading “/”).</p>}
            {validQuery && state.loading && (
              <p className="flex items-center gap-1 p-2 text-[11px] text-muted-foreground">
                <RiLoader4Line className="size-3 animate-spin" /> Searching GitHub…
              </p>
            )}
            {validQuery && state.error && (
              <p role="alert" className="p-2 text-[11px] text-destructive">
                {state.error}
              </p>
            )}
            {validQuery && !state.loading && !state.error && !state.searched && <p className="p-2 text-[11px] text-muted-foreground">This repo is not tracked by Flux, so it cannot be searched. Type the branch name.</p>}
            <CommandEmpty>{state.loading ? "" : "No matching branch."}</CommandEmpty>
            <CommandGroup>
              {canUseTyped && (
                <CommandItem
                  value={`__typed__${typed}`}
                  onSelect={() => {
                    onChange(typed);
                    setOpen(false);
                  }}
                >
                  Use “{typed}”
                </CommandItem>
              )}
              {branches.map((b) => (
                <CommandItem
                  key={b}
                  value={b}
                  onSelect={() => {
                    onChange(b);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{b}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {validQuery && state.truncated && <p className="p-2 text-[11px] text-muted-foreground">Showing the first 50; type more to narrow the list.</p>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const BRANCH_GRID = "grid grid-cols-1 items-center gap-x-2 gap-y-0.5 md:grid-cols-[minmax(140px,1.2fr)_minmax(140px,1.2fr)_minmax(220px,1.5fr)_minmax(120px,0.9fr)]";

/** Repo | Review says | Your pick | Status, as a compact table (rows are plain rows under 768 px: the header hides and each cell is labelled). */
export function BranchTable({ children }: { children: React.ReactNode }) {
  return (
    <div role="table" aria-label="Branch per repo" className="overflow-hidden rounded-lg border border-border text-xs" data-testid="movement-branch-table">
      <div role="row" className={cn(BRANCH_GRID, "hidden border-b border-border bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground md:grid")}>
        <span role="columnheader">Repo</span>
        <span role="columnheader">Review says</span>
        <span role="columnheader">Your pick</span>
        <span role="columnheader">Status</span>
      </div>
      {children}
    </div>
  );
}

export function BranchRow({ repo, fullName, heldOnly, handAdded, hint, danger, pick, status }: { repo: string; fullName: string | null; heldOnly: boolean; handAdded?: boolean; hint: string | null; danger?: boolean; pick: React.ReactNode; status: React.ReactNode }) {
  return (
    <div role="row" data-testid={`movement-branch-row-${repo}`} className={cn(BRANCH_GRID, "min-h-9 border-b border-border px-2 py-1 last:border-b-0", danger ? "bg-red-50/60 dark:bg-red-950/20" : "odd:bg-muted/20")}>
      <div role="cell" className="min-w-0">
        <p className="truncate font-semibold" title={fullName ?? repo}>
          {fullName ?? repo}
        </p>
        <HeldOnlyNote heldOnly={heldOnly} />
        {handAdded && <p className="text-[11px] text-muted-foreground">Added by hand</p>}
      </div>
      <div role="cell" className="min-w-0 text-[11px] text-muted-foreground [overflow-wrap:anywhere]" data-testid={hint ? `movement-branch-hint-${repo}` : undefined}>
        <span className="md:hidden">Review says: </span>
        {hint ?? "—"}
      </div>
      <div role="cell" className="min-w-0">
        {pick}
      </div>
      <div role="cell" className="flex flex-wrap items-center gap-1">
        {status}
      </div>
    </div>
  );
}

export function MovementBranches({
  deliveryId,
  movementId,
  checklist,
  edit,
  isManager,
  onSaved,
}: {
  deliveryId: string;
  movementId: string;
  checklist: Checklist | null;
  edit: ActionState;
  /** From `me.isManager`. The live GitHub branch search is for delivery managers only (it spends the org's rate limit), so everyone else gets the read-only list. */
  isManager: boolean;
  /** Called after a save: the view (and its hash) must be reloaded. */
  onSaved: () => void;
}) {
  const base = movementBase(deliveryId, movementId);
  const [repos, setRepos] = useState<RepoList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Array<{ repo: string; branch: string }>>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    api<RepoList>(`${base}/branches`, { signal: ctl.signal, timeoutMs: 30_000, fallbackError: "Could not load the repos" }).then((r) => {
      if (ctl.signal.aborted || r.aborted) return;
      if (!r.ok || !r.data) {
        setLoadError(r.error ?? "Could not load the repos");
        return;
      }
      setLoadError(null);
      setRepos(r.data);
      setSaved(r.data.branches);
      setPicks(Object.fromEntries(r.data.branches.map((b) => [b.repo, b.branch])));
    });
    return () => ctl.abort();
  }, [base, attempt]);

  const rows = useMemo(() => {
    const set = new Set<string>([...(repos?.affected.map((a) => a.repo) ?? []), ...saved.map((b) => b.repo), ...extra]);
    return [...set].sort();
  }, [repos, saved, extra]);
  const dirty = branchesDirty(saved, picks);
  const addable = (repos?.tracked ?? []).filter((r) => !rows.includes(r));

  async function save() {
    setSaving(true);
    setSaveError(null);
    const r = await api<{ changed: boolean; branches: Array<{ repo: string; branch: string }> }>(`${base}/branches`, { method: "PUT", body: { branches: branchPayload(picks) }, timeoutMs: 30_000, fallbackError: "Could not save the branches" });
    setSaving(false);
    if (!r.ok || !r.data) {
      setSaveError(r.error);
      toast.error(r.error ?? "Could not save the branches");
      // A timeout, a dropped answer or a 5xx may still have saved them (and reset sign-offs): reload the view. The picks stay as typed; saving again is harmless.
      if (classifyFailure({ status: r.status, timedOut: r.timedOut, body: r.body }).reload) onSaved();
      return;
    }
    setSaved(r.data.branches);
    toast.success(r.data.changed ? "Branches saved; sign-offs are reset if the checklist changed" : "No change");
    onSaved();
  }

  if (loadError) {
    return (
      <div className="space-y-2 text-xs">
        <p role="alert" className="text-destructive">
          {loadError}
        </p>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setAttempt((n) => n + 1)} data-testid="movement-branches-retry">
          Retry
        </Button>
      </div>
    );
  }
  if (!repos) return <p className="text-xs text-muted-foreground">Loading repos…</p>;

  if (!isManager) {
    return (
      <div className="space-y-2" data-testid="movement-branches" data-readonly="true">
        <p className="text-[11px] text-muted-foreground">The repos this movement touches and the branch chosen for each. Only delivery managers can search and choose branches.</p>
        {rows.length === 0 && <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">No repo is named by the review comments yet.</p>}
        <BranchTable>
          {rows.map((repo) => {
            const aff = repos.affected.find((a) => a.repo === repo);
            const hint = branchHints(checklist, repo);
            const chosen = saved.find((b) => b.repo === repo)?.branch ?? "";
            return (
              <BranchRow
                key={repo}
                repo={repo}
                fullName={aff?.fullName ?? null}
                heldOnly={isHeldOnly(aff)}
                hint={hint.hint}
                pick={
                  <span className={cn("block truncate", !chosen && "text-muted-foreground")} title={chosen || undefined} data-testid={`movement-branch-value-${repo}`}>
                    {chosen || "no branch chosen yet"}
                  </span>
                }
                status={
                  <>
                    <HeldOnlyFlag repo={repo} heldOnly={isHeldOnly(aff)} />
                    {hint.mismatch && (
                      <Chip tone="danger" title={hint.mismatch.title} testId={`movement-branch-mismatch-${repo}`}>
                        differs from the review
                      </Chip>
                    )}
                    {chosen && !hint.mismatch && !isHeldOnly(aff) && <Chip tone="ok">saved</Chip>}
                  </>
                }
              />
            );
          })}
        </BranchTable>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="movement-branches">
      <p className="text-[11px] text-muted-foreground">One branch per affected repo. The review comments may state a prod branch; a pick that differs from it is flagged. Saving can change the checklist and reset the sign-offs.</p>
      {rows.length === 0 && <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">No repo is named by the review comments yet.</p>}
      <BranchTable>
        {rows.map((repo) => {
          const aff = repos.affected.find((a) => a.repo === repo);
          const hint = branchHints(checklist, repo);
          const value = picks[repo] ?? "";
          const unsaved = value !== (saved.find((b) => b.repo === repo)?.branch ?? "");
          return (
            <BranchRow
              key={repo}
              repo={repo}
              fullName={aff?.fullName ?? null}
              heldOnly={isHeldOnly(aff)}
              handAdded={!aff}
              hint={hint.hint}
              danger={!!hint.mismatch && !unsaved}
              pick={
                <div className="flex items-center gap-1">
                  <BranchPicker deliveryId={deliveryId} movementId={movementId} repo={repo} value={value} disabled={!edit.allowed} onChange={(b) => setPicks((p) => ({ ...p, [repo]: b }))} />
                  {value && edit.allowed && (
                    <Button variant="ghost" size="sm" className="h-6 shrink-0 text-[11px]" data-testid={`movement-branch-clear-${repo}`} onClick={() => setPicks((p) => ({ ...p, [repo]: "" }))}>
                      Clear
                    </Button>
                  )}
                </div>
              }
              status={
                <>
                  <HeldOnlyFlag repo={repo} heldOnly={isHeldOnly(aff)} />
                  {unsaved && <Chip tone="info">unsaved</Chip>}
                  {hint.mismatch && !unsaved && (
                    <Chip tone="danger" title={hint.mismatch.title} testId={`movement-branch-mismatch-${repo}`}>
                      differs from the review
                    </Chip>
                  )}
                  {!unsaved && value && !hint.mismatch && !isHeldOnly(aff) && <Chip tone="ok">saved</Chip>}
                  {!value && <Chip tone="muted">no branch</Chip>}
                </>
              }
            />
          );
        })}
      </BranchTable>
      {edit.allowed && addable.length > 0 && rows.length < 30 && (
        <Select value="" onValueChange={(r) => setExtra((e) => [...e, r])}>
          <SelectTrigger size="sm" className="h-7 w-56 text-[11px]" aria-label="Add another tracked repo" data-testid="movement-branch-add">
            <SelectValue placeholder="Add another tracked repo…" />
          </SelectTrigger>
          <SelectContent>
            {addable.slice(0, 200).map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {saveError && (
        <p role="alert" className="text-xs text-destructive" data-testid="movement-branches-save-error">
          {saveError}
        </p>
      )}
      <GuardedButton size="sm" className="h-7 text-[11px]" disabled={!edit.allowed || !dirty || saving} reason={!edit.allowed ? edit.reason : !dirty ? "Nothing to save" : null} onClick={save} data-testid="movement-branches-save">
        {saving ? "Saving…" : "Save branches"}
      </GuardedButton>
    </div>
  );
}

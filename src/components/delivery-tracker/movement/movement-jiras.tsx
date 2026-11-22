"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RiArrowRightSLine, RiExternalLinkLine, RiInformationLine, RiShieldCheckLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MovementStatus } from "@/lib/movement/values";
import { ALLOWED_STATUSES } from "@/lib/movement/service/state";
import { api } from "./api";
import { createTickBatcher, type TickBatcher } from "./logic";
import { blockerKind, plainWording, RECORD_HELP, todoLines, warningParts, warningRows, whyText, whyTitle, type BlockerKind } from "./jira-notes";
import type { Checklist, ItemDetail, ItemView } from "./api-types";
import { Chip, GuardedButton, useFocusReturn } from "./ui-bits";
import { Linkified } from "./linkified";
import { JiraChecklist } from "./jira-checklist-panel";
import { CommentEditButton } from "./comment-editor";
import {
  countItems,
  filterItems,
  formatIst,
  notesHidden,
  openerTestIds,
  reviewSummary,
  ROW_STATUS,
  rowStatus,
  signoffMark,
  tickOrigin,
  tickState,
  TICK_RESETS_SIGNOFFS,
  nextShown,
  NOTHING_SELECTED_HINT,
  nothingSelected,
  type ActionState,
  type ItemFilter,
} from "./view-model";

const ROWS_STEP = 100;
const REASON_MIN = 5;
const REASON_MAX = 500;

export interface JirasProps {
  /** The movement's status: the "nothing selected" hint is only for a selection that can still change. */
  status: string;
  items: readonly ItemView[];
  checklist: Checklist | null;
  /** `/api/deliveries/<id>/movements/<mid>`: the lazy per-Jira detail is GET `<base>/items/<issueId>`. */
  base: string;
  /** The movement's updatedAt: an expanded row re-reads its detail when it changes. */
  refreshKey: string;
  /** The checklist has a hash (it was built); without one the movement is still a draft. */
  hasHash: boolean;
  edit: ActionState;
  override: ActionState;
  revoke: ActionState;
  jiraBaseUrl: string | null;
  /** The movement's environment and checklist hash: the per-Jira checklist is named after the first and re-read when the second moves (optional: without them the expansion has no per-Jira checklist). */
  environment?: string;
  hash?: string | null;
  /** A review comment was saved or reset (the page reloads the view: the checklist hash and the "edited" marks change). */
  onCommentSaved?: () => void;
  /** Tick / untick; resolves true when the server accepted it. */
  onTick: (issueIds: string[], included: boolean) => Promise<boolean>;
  /** Override or revoke with the reason (`include`: also tick it, override only); resolves to an error message, or null on success. */
  onOverride: (item: ItemView, mode: "override" | "revoke", reason: string, include: boolean) => Promise<string | null>;
}

const FILTERS: Array<{ id: ItemFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "blocked", label: "Blocked" },
  { id: "ready", label: "Ready" },
  { id: "overridden", label: "Overridden" },
  { id: "unticked", label: "Not selected" },
  { id: "warnings", label: "Warnings" },
];

/** The columns: tick | Jira | Status | Why | Dev | Test | Warnings | expand. Under 768 px a row is two lines (tick, Jira, status, chevron / why, dev, test, warnings). */
const GRID = "grid grid-cols-[28px_minmax(0,1fr)_auto_32px] items-center gap-x-2 md:grid-cols-[28px_minmax(160px,1.5fr)_104px_minmax(180px,1.7fr)_64px_64px_48px_32px]";

function jiraHref(base: string | null, key: string): string | null {
  if (!base || !/^https?:\/\//i.test(base)) return null;
  return `${base.replace(/\/+$/, "")}/browse/${encodeURIComponent(key)}`;
}

/** The one place the review comment is explained. */
export function RecordHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground" data-testid="movement-record-help" aria-label="What is the review comment?">
          <RiInformationLine className="size-3.5" /> What is the review comment?
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs">
        {RECORD_HELP}
      </PopoverContent>
    </Popover>
  );
}

export function MovementJiras(props: JirasProps) {
  const { status, items, checklist, base, refreshKey, hasHash, edit, override, revoke, jiraBaseUrl, environment, hash, onCommentSaved, onTick, onOverride } = props;
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(ROWS_STEP);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<{ item: ItemView; mode: "override" | "revoke" } | null>(null);
  const focus = useFocusReturn();

  const counts = useMemo(() => countItems(items), [items]);
  const filtered = useMemo(() => filterItems(items, filter, query), [items, filter, query]);
  const filterCounts = useMemo(
    () => ({
      all: items.length,
      blocked: counts.blocked,
      ready: counts.ready,
      overridden: counts.overridden,
      unticked: counts.unticked,
      warnings: filterItems(items, "warnings", "").length,
    }),
    [items, counts]
  );

  // Rapid ticks are batched: consecutive changes within 300 ms are ONE PATCH (and one view reload), the last choice per Jira wins.
  // The optimistic state shows at once and is dropped when the batch is answered (success: the reloaded view; failure: back to the server's state).
  const onTickRef = useRef(onTick);
  useEffect(() => {
    onTickRef.current = onTick;
  });
  const batcher = useRef<TickBatcher | null>(null);
  useEffect(() => {
    const b = createTickBatcher({
      send: (ids, included) => onTickRef.current(ids, included),
      settled: (ids, included) =>
        setOptimistic((o) => {
          const next = { ...o };
          for (const i of ids) if (next[i] === included) delete next[i]; // a newer choice on the same row stays
          return next;
        }),
    });
    batcher.current = b;
    return () => {
      batcher.current = null;
      void b.flush(); // the panel closes or the tab changes: what was ticked is still sent
    };
  }, []);

  function tick(ids: string[], included: boolean, now = false) {
    if (ids.length === 0) return;
    setOptimistic((o) => ({ ...o, ...Object.fromEntries(ids.map((i) => [i, included])) }));
    batcher.current?.push(ids, included);
    if (now) void batcher.current?.flush();
  }

  const tickable = filtered.filter((i) => i.readiness !== "blocked");
  const toTick = tickable.filter((i) => !i.included).map((i) => i.issueId).slice(0, 200);
  const toUntick = tickable.filter((i) => i.included).map((i) => i.issueId).slice(0, 200);
  const visible = filtered.slice(0, shown);
  const pendingTicks = Object.keys(optimistic).length;
  const selectionOpen = ALLOWED_STATUSES.edit.includes(status as MovementStatus);

  return (
    <div className="space-y-2" data-testid="movement-jiras">
      {/* summary bar: counts that are also the filters, the help, the search, the bulk actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter Jiras" data-testid="movement-jira-counts">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              data-testid={`movement-filter-${f.id}`}
              onClick={() => {
                setFilter(f.id);
                setShown(ROWS_STEP);
              }}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] focus-visible:outline-2 focus-visible:outline-ring",
                filter === f.id ? "border-primary bg-primary/10 font-semibold" : "border-border text-muted-foreground hover:text-foreground",
                filterCounts[f.id] === 0 && filter !== f.id && "opacity-60"
              )}
            >
              {f.label} <span className="tabular-nums">{filterCounts[f.id]}</span>
            </button>
          ))}
        </div>
        <RecordHelp />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(ROWS_STEP);
            }}
            placeholder="Search key or summary…"
            aria-label="Search Jiras"
            className="h-7 w-44 text-xs"
            data-testid="movement-jira-search"
          />
          <GuardedButton variant="outline" size="sm" className="h-7 text-[11px]" disabled={!edit.allowed || toTick.length === 0} reason={edit.reason} onClick={() => tick(toTick, true, true)} data-testid="movement-tick-all">
            Select all filtered ({toTick.length})
          </GuardedButton>
          <GuardedButton variant="ghost" size="sm" className="h-7 text-[11px]" disabled={!edit.allowed || toUntick.length === 0} reason={edit.reason} onClick={() => tick(toUntick, false, true)} data-testid="movement-untick-all">
            Clear selection ({toUntick.length})
          </GuardedButton>
        </div>
      </div>
      {nothingSelected(items) && selectionOpen && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50/60 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200" data-testid="movement-nothing-selected">
          {NOTHING_SELECTED_HINT}
        </p>
      )}
      {pendingTicks > 0 && (
        <p role="status" className="text-[11px] text-muted-foreground" data-testid="movement-tick-note">
          {TICK_RESETS_SIGNOFFS}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">{items.length === 0 ? "No Jiras in this movement." : "No Jira matches this filter."}</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-border" data-testid="movement-jira-table-scroll">
          <div role="table" aria-label="Jiras of this movement" aria-rowcount={filtered.length + 1} data-testid="movement-jira-table" className="min-w-0 text-xs">
            <div role="row" className={cn(GRID, "sticky top-0 z-10 hidden border-b border-border bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground md:grid")}>
              <span role="columnheader" title={TICK_RESETS_SIGNOFFS} className="cursor-help">
                <span className="sr-only">Select. {TICK_RESETS_SIGNOFFS}</span>
                <span aria-hidden>✓</span>
              </span>
              <span role="columnheader">Jira</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Why</span>
              <span role="columnheader" title="Development test-case sign-off">
                Dev
              </span>
              <span role="columnheader" title="Tester test-case sign-off">
                Test
              </span>
              <span role="columnheader" title="Warnings (they never block)">
                Warn
              </span>
              <span role="columnheader">
                <span className="sr-only">Details</span>
              </span>
            </div>
            {visible.map((item, index) => (
              <JiraRow
                key={item.issueId}
                item={{ ...item, included: optimistic[item.issueId] ?? item.included }}
                zebra={index % 2 === 1}
                pending={item.issueId in optimistic}
                base={base}
                refreshKey={refreshKey}
                hasHash={hasHash}
                checklist={checklist}
                environment={environment}
                hash={hash}
                onCommentSaved={onCommentSaved}
                edit={edit}
                override={override}
                revoke={revoke}
                href={jiraHref(jiraBaseUrl, item.key)}
                onTick={tick}
                onOpenOverride={(mode) => {
                  focus.remember(openerTestIds(mode, item.key));
                  setDialog({ item, mode });
                }}
              />
            ))}
          </div>
        </div>
      )}
      {shown < filtered.length && (
        <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setShown((n) => nextShown(n, filtered.length, ROWS_STEP))} data-testid="movement-jiras-more">
          Show {Math.min(ROWS_STEP, filtered.length - shown)} more ({filtered.length - shown} not shown)
        </Button>
      )}

      <OverrideDialog
        state={dialog}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        onClose={() => setDialog(null)}
        onSubmit={async (reason, include) => {
          if (!dialog) return null;
          const err = await onOverride(dialog.item, dialog.mode, reason, include);
          if (!err) setDialog(null);
          return err;
        }}
      />
    </div>
  );
}

/**
 * "Dev ✓" (green, who and when in the tooltip) or "Dev –" (muted, labelled missing): always visible text, for every Jira (ticked or not, blocked or not),
 * with the words for a screen reader. They come from the Jira's own test-case sign-offs and never block.
 */
function SignoffChip({ role, mark, testId }: { role: "Dev" | "Test"; mark: ReturnType<typeof signoffMark>; testId?: string }) {
  return (
    <Chip tone={mark.signed ? "ok" : "muted"} title={mark.title} testId={testId} className="px-1.5">
      <span aria-hidden>
        {role} {mark.mark}
      </span>
      <span className="sr-only">{mark.label}</span>
    </Chip>
  );
}

function JiraRow({
  item,
  zebra,
  pending,
  base,
  refreshKey,
  hasHash,
  checklist,
  environment,
  hash,
  onCommentSaved,
  edit,
  override,
  revoke,
  href,
  onTick,
  onOpenOverride,
}: {
  item: ItemView;
  zebra: boolean;
  pending: boolean;
  base: string;
  refreshKey: string;
  hasHash: boolean;
  checklist: Checklist | null;
  environment?: string;
  hash?: string | null;
  onCommentSaved?: () => void;
  edit: ActionState;
  override: ActionState;
  revoke: ActionState;
  href: string | null;
  onTick: (ids: string[], included: boolean) => void;
  onOpenOverride: (mode: "override" | "revoke") => void;
}) {
  const [open, setOpen] = useState(false);
  const tick = tickState(item, edit.allowed, edit.reason);
  const origin = tickOrigin(item);
  const blocked = item.readiness === "blocked";
  const status = ROW_STATUS[rowStatus(item)];
  const why = whyText(item);
  const dev = signoffMark("Dev", item.signoffs.dev);
  const test = signoffMark("Tester", item.signoffs.tester);
  const warnCount = item.softWarnings.length;
  const bodyId = `movement-jira-${item.issueId}`;

  const checkbox = (
    <Checkbox
      checked={tick.checked}
      disabled={tick.disabled}
      onCheckedChange={(v) => onTick([item.issueId], v === true)}
      aria-label={`Include ${item.key} in this movement`}
      title={origin === "auto" && item.included ? "Ticked by default because its review comments are valid. Untick it to hold it back; a refresh will not change your choice." : undefined}
      data-testid={`movement-tick-${item.key}`}
    />
  );

  return (
    <div
      role="rowgroup"
      data-testid={`movement-jira-${item.key}`}
      data-readiness={item.readiness}
      data-group={item.readiness === "blocked" ? "blocked" : item.readiness === "override" ? "overridden" : item.softWarnings.length > 0 ? "warnings" : "clean"}
      aria-busy={pending || undefined}
      className={cn("border-b border-border last:border-b-0", blocked ? "bg-red-50/50 dark:bg-red-950/15" : zebra ? "bg-muted/25" : "bg-card", pending && "opacity-80")}
    >
      <div role="row" className={cn(GRID, "min-h-9 gap-y-0.5 px-2 py-1 hover:bg-muted/50")}>
        <div role="cell" className="order-1 md:order-none">
          {tick.disabled && tick.reason ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex" tabIndex={0} role="note" aria-label={tick.reason}>
                    {checkbox}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{tick.reason}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            checkbox
          )}
        </div>
        <div role="cell" className="order-2 min-w-0 md:order-none">
          <div className="flex min-w-0 items-baseline gap-1.5">
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-ring dark:text-blue-400">
                {item.key}
                <RiExternalLinkLine className="size-3" />
              </a>
            ) : (
              <span className="shrink-0 font-semibold">{item.key}</span>
            )}
            <span className="truncate text-muted-foreground" title={item.summary}>
              {item.summary}
            </span>
          </div>
        </div>
        <div role="cell" className="order-3 md:order-none">
          <span className="inline-flex flex-wrap items-center gap-1">
            <Chip tone={status.tone} testId="movement-readiness">
              {status.label}
            </Chip>
            {item.edited && (
              <Chip tone="info" testId={`movement-jira-edited-${item.key}`} title={`The review comment was corrected in Flux${item.editedBy ? ` by ${item.editedBy}` : ""}; the checklist uses the edited text`}>
                edited
              </Chip>
            )}
          </span>
        </div>
        {/* second line on a phone; on a wide screen its children are cells of the same grid */}
        <div className="order-5 col-span-4 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-9 md:contents md:pl-0">
          <div role="cell" className="flex min-w-0 flex-1 items-center gap-1.5 md:flex-none" data-testid={`movement-jira-why-${item.key}`}>
            {item.readiness === "override" && <RiShieldCheckLine className="size-3 shrink-0 text-amber-700 dark:text-amber-400" />}
            <span
              className={cn("min-w-0 truncate text-[11px]", blocked ? "text-red-700 dark:text-red-400" : item.readiness === "override" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}
              title={whyTitle(item) || undefined}
              data-testid={blocked ? `movement-blockers-${item.key}` : item.readiness === "override" ? `movement-override-info-${item.key}` : undefined}
            >
              {why}
            </span>
            {blocked && (
              <GuardedButton variant="outline" size="sm" className="ml-auto h-6 shrink-0 text-[11px]" disabled={!override.allowed} reason={override.reason} onClick={() => onOpenOverride("override")} data-testid={`movement-override-${item.key}`}>
                Override
              </GuardedButton>
            )}
            {item.readiness === "override" && (
              <GuardedButton variant="ghost" size="sm" className="ml-auto h-6 shrink-0 text-[11px]" disabled={!revoke.allowed} reason={revoke.reason} onClick={() => onOpenOverride("revoke")} data-testid={`movement-revoke-${item.key}`}>
                Revoke
              </GuardedButton>
            )}
          </div>
          <div role="cell" className="text-center">
            <SignoffChip role="Dev" mark={dev} testId={`movement-signoff-dev-${item.key}`} />
          </div>
          <div role="cell" className="text-center">
            <SignoffChip role="Test" mark={test} testId={`movement-signoff-tester-${item.key}`} />
          </div>
          <div role="cell" className="text-center">
            {warnCount > 0 && (
              <Chip tone="warn" title={`${warnCount}${item.warningsMore > 0 ? "+" : ""} warning${warnCount === 1 ? "" : "s"} (they never block)`} testId={`movement-jira-warncount-${item.key}`}>
                {warnCount}
                {item.warningsMore > 0 ? "+" : ""}
              </Chip>
            )}
          </div>
        </div>
        <div role="cell" className="order-4 flex justify-end md:order-none" data-testid={`movement-jira-expand-${item.key}`}>
          <Button variant="ghost" size="icon-sm" aria-expanded={open} aria-controls={bodyId} aria-label={`${open ? "Hide" : "Show"} detail of ${item.key}`} onClick={() => setOpen((v) => !v)} data-testid={`movement-jira-toggle-${item.key}`}>
            <RiArrowRightSLine className={cn("size-4 transition-transform", open && "rotate-90")} />
          </Button>
        </div>
      </div>
      {open && (
        <div role="row" id={bodyId}>
          <div role="cell">
            <JiraDetail item={item} checklist={checklist} base={base} refreshKey={refreshKey} hasHash={hasHash} environment={environment} hash={hash ?? null} edit={edit} onCommentSaved={onCommentSaved} />
          </div>
        </div>
      )}
    </div>
  );
}

type DetailState = { phase: "loading" } | { phase: "ok"; data: ItemDetail } | { phase: "error"; message: string; stale: boolean };

/**
 * The expanded part of a Jira, mounted only when opened. It fetches GET items/<issueId> once (and again when the movement changes): the view lists at
 * most 5 record pointers and 12 notes per Jira, the detail has them all.
 */
function JiraDetail({
  item,
  checklist,
  base,
  refreshKey,
  hasHash,
  environment,
  hash,
  edit,
  onCommentSaved,
}: {
  item: ItemView;
  checklist: Checklist | null;
  base: string;
  refreshKey: string;
  hasHash: boolean;
  environment?: string;
  hash: string | null;
  edit: ActionState;
  onCommentSaved?: () => void;
}) {
  const [state, setState] = useState<DetailState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    api<ItemDetail>(`${base}/items/${encodeURIComponent(item.issueId)}`, { signal: ctl.signal, timeoutMs: 30_000, fallbackError: "Could not load the review comments of this Jira" }).then((r) => {
      if (ctl.signal.aborted || r.aborted) return;
      if (!r.ok || !r.data) setState({ phase: "error", message: r.error ?? "Could not load the review comments of this Jira", stale: r.status === 409 && (r.body as { code?: unknown } | null)?.code === "inputs_stale" });
      else setState({ phase: "ok", data: r.data });
    });
    return () => ctl.abort();
  }, [base, item.issueId, attempt, refreshKey]);

  const contributions = useMemo(() => {
    if (!checklist) return [];
    const out: Array<{ number: number; title: string; count: number }> = [];
    for (const s of checklist.sections) {
      let n = 0;
      for (const it of s.items) if (it.sources.some((x) => x.jira === item.key)) n++;
      if (n) out.push({ number: s.number, title: s.title, count: n });
    }
    return out;
  }, [checklist, item.key]);

  return (
    <JiraDetailBody
      item={item}
      state={state}
      onRetry={() => {
        setState({ phase: "loading" });
        setAttempt((n) => n + 1);
      }}
      checklistLoaded={!!checklist}
      hasHash={hasHash}
      contributions={contributions}
      base={base}
      environment={environment}
      hash={hash}
      edit={edit}
      onCommentSaved={onCommentSaved}
    />
  );
}

function MiniTable({ testId, caption, head, children }: { testId?: string; caption: string; head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full table-fixed border-collapse text-[11px]" data-testid={testId} aria-label={caption}>
      <thead>
        <tr className="text-left text-muted-foreground">
          {head.map((h) => (
            <th key={h} scope="col" className="border-b border-border px-1.5 py-0.5 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

const TD = "border-b border-border/60 px-1.5 py-0.5 align-top [overflow-wrap:anywhere]";

function Section({ title, tone, children }: { title: string; tone?: "danger" | "warn"; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h4 className={cn("text-[11px] font-semibold", tone === "danger" && "text-red-700 dark:text-red-400", tone === "warn" && "text-amber-700 dark:text-amber-400")}>{title}</h4>
      {children}
    </section>
  );
}

const KIND_LABEL: Record<BlockerKind, string> = {
  no_comment: "No review comment",
  not_covered: "PR not covered",
  unreadable: "Jira unreadable",
  incomplete: "Too many sub-Jiras",
};

/**
 * What the expansion shows, as small tables, from the item detail: why it is blocked (problems and what to do), the warnings, the review comment
 * (one row per comment: version, status, posted, PRs covered, scope) and the PRs in it (branch, commit, what it does, state), and (collapsed)
 * what the Jira feeds into the checklist. The row itself carries only the short "why", so nothing here repeats it.
 */
export function JiraDetailBody({
  item,
  state,
  onRetry,
  checklistLoaded,
  hasHash,
  contributions,
  base,
  environment,
  hash = null,
  edit,
  onCommentSaved,
}: {
  item: ItemView;
  state: DetailState;
  onRetry: () => void;
  checklistLoaded: boolean;
  hasHash: boolean;
  contributions: Array<{ number: number; title: string; count: number }>;
  /** With `base` and `environment` the expansion shows the per-Jira checklist and (with `edit`) the Edit comment button. */
  base?: string;
  environment?: string;
  hash?: string | null;
  edit?: ActionState;
  onCommentSaved?: () => void;
}) {
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const [feedsOpen, setFeedsOpen] = useState(false);
  // The view cuts the notes at 12 per Jira (`warningsMore`); once the detail has loaded it has all of them.
  const blockers = state.phase === "ok" ? state.data.blockers : item.blockers;
  const softWarnings = state.phase === "ok" ? state.data.softWarnings : item.softWarnings;
  const notesMore = state.phase === "ok" ? 0 : notesHidden(item);
  const blocked = item.readiness === "blocked";
  const overridden = item.readiness === "override";
  const todo = blocked ? todoLines(blockers, item.key) : [];
  const warnings = warningRows(softWarnings, showAllWarnings);

  return (
    <div className="space-y-2.5 border-t border-border bg-background/60 px-3 py-2 text-[11px]" data-testid={`movement-jira-detail-${item.key}`}>
      <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground" data-testid={`movement-jira-signoffs-${item.key}`}>
        <span className="font-semibold text-foreground">Test-case sign-off</span>
        <SignoffChip role="Dev" mark={signoffMark("Dev", item.signoffs.dev)} />
        <SignoffChip role="Test" mark={signoffMark("Tester", item.signoffs.tester)} />
        <span>{item.signoffs.dev ? `Dev by ${item.signoffs.dev.by}` : "Dev missing"} · {item.signoffs.tester ? `Test by ${item.signoffs.tester.by}` : "Test missing"}</span>
      </p>
      {(blocked || overridden) && blockers.length > 0 && (
        <Section title={blocked ? "Not reviewed yet" : "Was not reviewed yet (overridden)"} tone={blocked ? "danger" : "warn"}>
          <MiniTable testId={`movement-jira-blockers-table-${item.key}`} caption="Problems" head={["Problem", "Details"]}>
            {blockers.map((b, i) => {
              const kind = blockerKind(b.code);
              return (
                <tr key={i}>
                  <td className={cn(TD, "w-40 font-medium")}>{kind ? KIND_LABEL[kind] : "Other"}</td>
                  <td className={TD}>
                    <Linkified text={plainWording(b.message)} />
                  </td>
                </tr>
              );
            })}
          </MiniTable>
        </Section>
      )}
      {todo.length > 0 && (
        <Section title="What to do">
          <ul className="list-disc space-y-0.5 pl-4" data-testid={`movement-jira-todo-${item.key}`}>
            {todo.map((t) => (
              <li key={t.kind}>
                <Linkified text={t.text} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {overridden && item.override && (
        <Section title="Override" tone="warn">
          <p className="[overflow-wrap:anywhere]">
            {item.override.by ?? "An admin"}
            {item.override.at ? ` on ${formatIst(item.override.at)}` : ""}: <Linkified text={item.override.reason} />
          </p>
        </Section>
      )}

      {(softWarnings.length > 0 || notesMore > 0) && (
        <Section title={`Warnings (${softWarnings.length}${notesMore > 0 ? "+" : ""}, they never block)`} tone="warn">
          <MiniTable testId={`movement-jira-warnings-table-${item.key}`} caption="Warnings" head={["Warning", "Where"]}>
            {warnings.shown.map((w, i) => {
              const p = warningParts(w);
              return (
                <tr key={i}>
                  <td className={TD}>
                    <Linkified text={p.text} />
                  </td>
                  <td className={cn(TD, "w-44 text-muted-foreground")}>{p.where ? <Linkified text={p.where} /> : "—"}</td>
                </tr>
              );
            })}
          </MiniTable>
          {warnings.hidden > 0 && (
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" aria-expanded={showAllWarnings} onClick={() => setShowAllWarnings(true)} data-testid={`movement-jira-warnings-toggle-${item.key}`}>
              Show all ({warnings.hidden} more)
            </Button>
          )}
          {showAllWarnings && softWarnings.length > 5 && (
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" aria-expanded onClick={() => setShowAllWarnings(false)}>
              Show fewer
            </Button>
          )}
          {notesMore > 0 && (
            <p className="text-muted-foreground" data-testid={`movement-jira-notes-more-${item.key}`}>
              +{notesMore} more note{notesMore === 1 ? "" : "s"}
              {state.phase === "loading" ? " (loading the full list…)" : state.phase === "error" ? " (not loaded)" : ""}
            </p>
          )}
        </Section>
      )}

      <Section title={item.reviews > 1 ? "Review comments" : "Review comment"}>
        <div data-testid={`movement-jira-records-${item.key}`} className="space-y-1.5">
          {item.reviews === 0 ? (
            <p className="text-muted-foreground">No review comment on this Jira.</p>
          ) : (
            <>
              <p className="text-muted-foreground">{reviewSummary(item)}</p>
              {state.phase === "loading" && <p className="text-muted-foreground">Loading the review comment…</p>}
              {state.phase === "error" && (
                <p role="alert" className="flex flex-wrap items-center gap-1.5 text-destructive">
                  {state.stale ? "The stored data must be re-read first; use Refresh." : state.message}
                  {!state.stale && (
                    <Button variant="outline" size="sm" className="h-6 text-[11px]" data-testid={`movement-jira-detail-retry-${item.key}`} onClick={onRetry}>
                      Retry
                    </Button>
                  )}
                </p>
              )}
              {edit && base && (
                <div className="flex flex-wrap items-center gap-1.5" data-testid={`movement-jira-record-actions-${item.key}`}>
                  {item.edited && (
                    <Chip tone="info" title={item.editedBy ? `Corrected in Flux by ${item.editedBy}` : "Corrected in Flux"}>
                      edited in Flux{item.editedBy ? ` by ${item.editedBy}` : ""}
                    </Chip>
                  )}
                  <CommentEditButton base={base} item={item} edit={edit} onSaved={onCommentSaved ?? (() => {})} />
                </div>
              )}
              {base && environment && <JiraChecklist base={base} item={item} environment={environment} hash={hash} detail={state.phase === "ok" ? state.data : null} />}
            </>
          )}
        </div>
      </Section>

      <section>
        <button type="button" className="flex items-center gap-1 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-ring" aria-expanded={feedsOpen} onClick={() => setFeedsOpen((v) => !v)} data-testid={`movement-jira-feeds-toggle-${item.key}`}>
          <RiArrowRightSLine className={cn("size-3.5 transition-transform", feedsOpen && "rotate-90")} /> Feeds the checklist
        </button>
        {feedsOpen && (
          <div className="mt-1 text-muted-foreground" data-testid={`movement-jira-feeds-${item.key}`}>
            {!checklistLoaded ? (
              <p>{hasHash ? "The checklist is not loaded yet (it loads when the Checklist tab is open)." : "The checklist is not built yet."}</p>
            ) : !item.included ? (
              <p>Not selected, so it adds nothing to the checklist.</p>
            ) : contributions.length === 0 ? (
              <p>No checklist line names this Jira.</p>
            ) : (
              <p>{contributions.map((c) => `${c.number}. ${c.title} (${c.count})`).join(" · ")}</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function OverrideDialog({ state, onClose, onSubmit, onCloseAutoFocus }: { state: { item: ItemView; mode: "override" | "revoke" } | null; onClose: () => void; onSubmit: (reason: string, include: boolean) => Promise<string | null>; onCloseAutoFocus: (e: Event) => void }) {
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      {state && <OverrideForm key={`${state.item.issueId}:${state.mode}`} state={state} onClose={onClose} onSubmit={onSubmit} onCloseAutoFocus={onCloseAutoFocus} />}
    </Dialog>
  );
}

function OverrideForm({ state, onClose, onSubmit, onCloseAutoFocus }: { state: { item: ItemView; mode: "override" | "revoke" }; onClose: () => void; onSubmit: (reason: string, include: boolean) => Promise<string | null>; onCloseAutoFocus: (e: Event) => void }) {
  const [reason, setReason] = useState("");
  const [include, setInclude] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOverride = state.mode === "override";
  const trimmed = reason.trim();
  const valid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;
  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const err = await onSubmit(trimmed, isOverride && include);
    setBusy(false);
    if (err) setError(err);
  }
  return (
    <DialogContent data-testid="movement-override-dialog" className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader>
        <DialogTitle>{isOverride ? `Override ${state.item.key}` : `Revoke the override on ${state.item.key}`}</DialogTitle>
        <DialogDescription>
          {isOverride
            ? "This Jira has no review comment. Overriding lets it be selected anyway. Your name, the time and this reason are recorded."
            : "The Jira goes back to blocked and is removed from the selection. Your name, the time and this reason are recorded."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1">
        <label htmlFor="movement-override-reason" className="text-xs font-medium">
          Reason (5 to {REASON_MAX} characters)
        </label>
        <Textarea id="movement-override-reason" data-testid="movement-override-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} placeholder="Why is it safe to move this Jira?" className="min-h-20" />
        <p className={cn("text-[11px]", valid || trimmed.length === 0 ? "text-muted-foreground" : "text-red-600 dark:text-red-400")}>
          {trimmed.length}/{REASON_MAX}
          {trimmed.length > 0 && trimmed.length < REASON_MIN ? ` · at least ${REASON_MIN} characters` : ""}
        </p>
      </div>
      {isOverride && (
        <label className="flex items-start gap-2 text-xs" htmlFor="movement-override-include">
          <Checkbox id="movement-override-include" checked={include} onCheckedChange={(v) => setInclude(v === true)} disabled={busy} data-testid="movement-override-include" className="mt-0.5" />
          <span>
            <span className="font-medium">Also tick this Jira</span>
            <span className="block text-muted-foreground">Overriding and ticking happen in one step. Untick this to override only and select it later.</span>
          </span>
        </label>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive" data-testid="movement-override-error">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy} data-testid="movement-override-cancel">
          Cancel
        </Button>
        <Button variant={isOverride ? "default" : "destructive"} onClick={submit} disabled={!valid || busy} data-testid="movement-override-submit">
          {busy ? "Saving…" : isOverride ? "Override" : "Revoke"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

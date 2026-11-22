"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RiArrowRightSLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "./api";
import type { Checklist, ItemDetail, ItemView, JiraServices } from "./api-types";
import { buildJiraChecklistView, jiraChecklistText, type JiraChecklistView } from "./jira-checklist";
import { buildJiraCards, cardText, type Block, type Card, type Cell, type CardTone } from "./jira-cards";
import { StateWord } from "./linkified";
import { isEmptyPlain, plainCopy, plainLines, type Plain } from "./plain-text";
import { PlainView, Rich } from "./plain-view";
import { Chip, CopyButton } from "./ui-bits";
import { formatIst, parseOpenPref } from "./view-model";

/** Whether the cards of the per-Jira panel are open (one switch for all cards; remembered, storage may be missing or blocked). */
export const JIRA_CARDS_OPEN_KEY = "flux.movement.jira.cards";

const TH = "border-b border-border px-1.5 py-1 text-left font-medium text-muted-foreground";
const TD = "border-b border-border/60 px-1.5 py-1 align-top [overflow-wrap:anywhere]";

const STATE_OF: Record<string, "done" | "notdone" | "na" | "yesno" | "unknown" | null> = { done: "done", notdone: "notdone", na: "na", yes: "yesno", no: "yesno", unknown: "unknown", other: null };

function CellView({ cell }: { cell: Cell }) {
  switch (cell.kind) {
    case "text":
      return <span className={cn(cell.strong && "font-medium", cell.muted && "text-muted-foreground")}>{cell.muted ? cell.text : <Rich text={cell.text} />}</span>;
    case "plain":
      return <PlainView plain={cell.plain} muted={cell.muted} />;
    case "answer": {
      const st = STATE_OF[cell.state];
      return st ? <StateWord state={st}>{cell.label}</StateWord> : <span className="text-muted-foreground">—</span>;
    }
    case "chips":
      return (
        <span className="inline-flex flex-wrap gap-1">
          {cell.chips.map((c, i) => (
            <Chip key={i} tone={c.tone}>
              {c.text}
            </Chip>
          ))}
        </span>
      );
    case "env":
      return (
        <ul className="space-y-0.5">
          {cell.values.map((e) => (
            <li key={e.env} data-target={e.target || undefined} className={cn("flex flex-wrap gap-1", e.target && "font-semibold")}>
              <span className="w-9 shrink-0 text-muted-foreground">{e.env}</span>
              {e.value === null ? <StateWord state="unknown">not set</StateWord> : <Rich text={e.value} />}
              {e.target && <span className="text-[10px] uppercase text-muted-foreground">target</span>}
            </li>
          ))}
        </ul>
      );
    case "stack":
      return (
        <div className="space-y-0.5">
          {cell.cells.map((c, i) => (
            <div key={i}>
              <CellView cell={c} />
            </div>
          ))}
        </div>
      );
  }
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "verdict":
      return null;
    case "facts":
      return (
        <ul className="flex flex-wrap gap-1.5" aria-label="Key facts" data-testid="movement-jira-facts">
          {block.chips.map((c) => (
            <li key={c.label}>
              <Chip tone={c.tone} className="whitespace-normal">
                <span className="font-normal opacity-80">{c.label}</span> {c.value}
              </Chip>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="relative overflow-x-auto" data-testid={block.testId ? `${block.testId}-scroll` : undefined}>
          <table className="w-full min-w-[480px] table-fixed border-collapse text-[11px]" aria-label={block.label} data-testid={block.testId}>
            {block.widths && (
              <colgroup>
                {block.widths.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
            )}
            <thead>
              <tr>
                {block.columns.map((c) => (
                  <th key={c} scope="col" className={TH}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r) => (
                <tr key={r.id} className={cn(r.attention && "bg-amber-50/50 dark:bg-amber-950/10")}>
                  {r.cells.map((c, i) => (
                    <td key={i} className={cn(TD, c.kind === "text" && i === 0 && /^\d+$/.test(c.text) && "tabular-nums")}>
                      <CellView cell={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <div className="space-y-0.5">
          {block.title && <p className={cn("font-semibold", block.tone === "danger" && "text-red-700 dark:text-red-400", block.tone === "warn" && "text-amber-700 dark:text-amber-400")}>{block.title}</p>}
          <List className={cn("space-y-0.5 pl-4", block.ordered ? "list-decimal" : "list-disc")}>
            {block.items.map((p, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                <PlainView plain={p} />
              </li>
            ))}
          </List>
        </div>
      );
    }
    case "note":
      return <p className={cn("[overflow-wrap:anywhere]", block.muted && "text-muted-foreground")}>{block.text}</p>;
  }
}

const isEmptyCard = (c: Card): boolean => c.blocks.every((b) => b.kind === "note" && b.muted);

/** A card: a short title, one plain line saying what it is for, its own Copy button, and a chevron to close it. */
function CardView({ card, jira, defaultOpen, children }: { card: Card; jira: string; defaultOpen: boolean; children?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen && !isEmptyCard(card));
  const bodyId = `movement-jira-card-${card.id}-body`;
  return (
    <section data-testid={`movement-jira-card-${card.id}`} className="rounded-md border border-border bg-card">
      <div className="flex items-start gap-1.5 px-2 py-1">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-start gap-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring" data-testid={`movement-jira-card-${card.id}-toggle`}>
          <RiArrowRightSLine className={cn("mt-0.5 size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
          <span className="min-w-0">
            <span className="text-[11px] font-semibold">{card.title}</span>
            {card.hint && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{card.hint}</span>}
            {open && <span className="block text-[11px] font-normal text-muted-foreground">{card.about}</span>}
          </span>
        </button>
        <CopyButton getText={() => cardText(jira, card)} label="Copy" testId={`movement-jira-copy-card-${card.id}-${jira}`} className="h-6 shrink-0 px-1.5" />
      </div>
      {open && (
        <div id={bodyId} className="space-y-1.5 border-t border-border px-2 py-1.5 text-[11px]">
          {card.id === "glance" && <GlanceTop card={card} jira={jira} />}
          {card.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
          {children}
        </div>
      )}
    </section>
  );
}

const STATUS_TONE: Record<string, CardTone> = { Ready: "ok", Held: "warn", "Partly reviewed": "warn", Blocked: "danger", "Not stated": "muted" };

/** The verdict of the review (a chip and its reason in plain words) and what the Jira does. */
function GlanceTop({ card, jira }: { card: Card; jira: string }) {
  const b = card.blocks.find((x) => x.kind === "verdict");
  if (!b || b.kind !== "verdict") return null;
  return (
    <div className="space-y-1" data-testid={`movement-jira-verdict-${jira}`}>
      <div className="flex flex-wrap items-start gap-1.5">
        <Chip tone={STATUS_TONE[b.verdict] ?? b.tone} testId={`movement-jira-status-${jira}`}>
          {b.verdict}
        </Chip>
        {plainLines(b.reason).length > 0 && (
          <div className="min-w-0 flex-1">
            <PlainView plain={b.reason} />
          </div>
        )}
      </div>
      {b.what && !isEmptyPlain(b.what) && (
        <div>
          <span className="font-semibold">What it does</span>
          <PlainView plain={b.what} />
        </div>
      )}
    </div>
  );
}

export interface JiraChecklistHeaderInfo {
  version: number | null;
  posted: string | null;
  scope: string | null;
  edited: boolean;
  editedBy: string | null;
}

/**
 * The checklist of ONE Jira as plain-language cards (at a glance, what to deploy, configuration, database and data, app and compatibility, testing,
 * order, rollback, verify, open questions, pull requests, the release checklist). Every card has its own Copy button. Presentational:
 * `JiraChecklist` fetches and passes the built view.
 */
export function JiraChecklistView({ v, itemKey, environment, info }: { v: JiraChecklistView; itemKey: string; environment: string; info?: JiraChecklistHeaderInfo | null }) {
  const cards = useMemo(() => buildJiraCards(v), [v]);
  const [allOpen, setAllOpen] = useState<boolean>(() => {
    try {
      return parseOpenPref(window.localStorage.getItem(JIRA_CARDS_OPEN_KEY));
    } catch {
      return true;
    }
  });
  const [epoch, setEpoch] = useState(0);
  function chooseAll(next: boolean) {
    setAllOpen(next);
    setEpoch((e) => e + 1);
    try {
      window.localStorage.setItem(JIRA_CARDS_OPEN_KEY, next ? "open" : "closed");
    } catch {
      // not remembered
    }
  }
  return (
    <div className="space-y-2" data-testid={`movement-jira-checklist-${itemKey}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <h4 className="text-[11px] font-semibold">Checklist of this Jira for {environmentLabel(environment)}</h4>
        <span className="ml-auto" />
        <Button variant="outline" size="sm" className="h-7 text-[11px]" aria-pressed={allOpen} onClick={() => chooseAll(!allOpen)} data-testid={`movement-jira-cards-toggle-all-${itemKey}`}>
          {allOpen ? "Collapse all" : "Expand all"}
        </Button>
        <CopyButton getText={() => jiraChecklistText(itemKey, environment, v)} label="Copy this Jira" testId={`movement-jira-copy-${itemKey}`} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1" data-testid={`movement-jira-header-strip-${itemKey}`}>
        {info?.version != null && <Chip tone="muted">v{info.version}</Chip>}
        {info?.scope && <Chip tone="muted">{info.scope === "union" ? "all PRs of the Jira" : "one PR"}</Chip>}
        {info?.posted && <span className="text-muted-foreground">posted {formatIst(info.posted)} IST</span>}
        {info?.edited && (
          <Chip tone="info" title={info.editedBy ? `Edited in Flux by ${info.editedBy}` : "Edited in Flux"} testId={`movement-jira-edited-note-${itemKey}`}>
            edited in Flux
          </Chip>
        )}
        {!info && <span className="text-muted-foreground">Read from the review comment of this Jira</span>}
      </div>

      {cards.map((c) => (
        <CardView key={`${c.id}:${epoch}`} card={c} jira={itemKey} defaultOpen={allOpen} />
      ))}

      {v.other.length > 0 && (
        <MoreItems v={v} itemKey={itemKey} epoch={epoch} />
      )}
    </div>
  );
}

const environmentLabel = (env: string): string => (env === "uat" ? "UAT" : env ? env[0].toUpperCase() + env.slice(1) : env);

function MoreItems({ v, itemKey, epoch }: { v: JiraChecklistView; itemKey: string; epoch: number }) {
  const card: Card = {
    id: "other",
    title: "More items",
    about: "Lines of the review comment that no card above shows.",
    hint: String(v.other.length),
    blocks: [{ kind: "list", items: v.other.map((o): Plain => ({ lead: `${o.section}: ${o.text}`, bullets: [], more: [], pointers: [] })) }],
  };
  void plainCopy;
  return <CardView key={`other:${epoch}`} card={card} jira={itemKey} defaultOpen={false} />;
}

type FetchState = { phase: "loading" } | { phase: "ok"; checklist: Checklist; services: JiraServices | null } | { phase: "error"; message: string; stale: boolean };

/**
 * Lazy per-Jira checklist: GET items/<issueId>/checklist when the Jira is expanded and has a review comment. Cached per checklist hash (the hash
 * changes with ticks, picks and comment edits), abortable, and a 409 inputs_stale says the stored data must be re-read.
 */
export function JiraChecklist({ base, item, environment, hash, detail }: { base: string; item: ItemView; environment: string; hash: string | null; detail: ItemDetail | null }) {
  const [state, setState] = useState<FetchState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<string, { checklist: Checklist; services: JiraServices | null }>());
  const key = `${hash ?? ""}|${item.edited ? 1 : 0}`;

  useEffect(() => {
    const cached = cache.current.get(key);
    if (cached) {
      queueMicrotask(() => setState({ phase: "ok", checklist: cached.checklist, services: cached.services }));
      return;
    }
    const ctl = new AbortController();
    api<{ checklist: Checklist; services?: JiraServices }>(`${base}/items/${encodeURIComponent(item.issueId)}/checklist`, { signal: ctl.signal, timeoutMs: 30_000, fallbackError: "Could not load the checklist of this Jira" }).then((r) => {
      if (ctl.signal.aborted || r.aborted) return;
      if (!r.ok || !r.data) setState({ phase: "error", message: r.error ?? "Could not load the checklist of this Jira", stale: r.status === 409 && (r.body as { code?: unknown } | null)?.code === "inputs_stale" });
      else {
        const entry = { checklist: r.data.checklist, services: r.data.services ?? null };
        cache.current.set(key, entry);
        if (cache.current.size > 4) cache.current.delete(cache.current.keys().next().value as string);
        setState({ phase: "ok", ...entry });
      }
    });
    return () => ctl.abort();
  }, [base, item.issueId, key, attempt]);

  const view = useMemo(() => (state.phase === "ok" ? buildJiraChecklistView(state.checklist, state.services) : null), [state]);
  const c = detail?.comments[0];
  const info: JiraChecklistHeaderInfo = { version: c?.version ?? null, posted: c?.updated ?? null, scope: c?.scope ?? null, edited: item.edited, editedBy: item.editedBy };

  if (state.phase === "loading")
    return (
      <div data-testid={`movement-jira-checklist-${item.key}`} data-state="loading">
        <p className="text-[11px] text-muted-foreground" data-testid={`movement-jira-checklist-loading-${item.key}`}>Loading the checklist of this Jira…</p>
      </div>
    );
  if (state.phase === "error")
    return (
      <div data-testid={`movement-jira-checklist-${item.key}`} data-state="error">
      <p role="alert" className="flex flex-wrap items-center gap-1.5 text-[11px] text-destructive" data-testid={`movement-jira-checklist-error-${item.key}`}>
        {state.stale ? "The stored data must be re-read first; use Refresh." : state.message}
        {!state.stale && (
          <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => { setState({ phase: "loading" }); setAttempt((n) => n + 1); }}>
            Retry
          </Button>
        )}
      </p>
      </div>
    );
  return view ? <JiraChecklistView v={view} itemKey={item.key} environment={environment} info={info} /> : null;
}

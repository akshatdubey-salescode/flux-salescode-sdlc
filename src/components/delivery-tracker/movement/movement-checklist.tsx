"use client";

import { memo, useMemo, useState } from "react";
import { RiArrowRightSLine, RiDownload2Line, RiErrorWarningLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Checklist, ChecklistItem, ChecklistSection, ChecklistConflict } from "./api-types";
import { Chip, CopyButton } from "./ui-bits";
import { Linkified } from "./linkified";
import { answerList, plainItems, sectionPlainText, type PlainItems } from "./plain-items";
import { isEmptyPlain } from "./plain-text";
import { PlainView } from "./plain-view";
import { SummaryPanel } from "./summary-panel";
import type { SummaryState } from "./use-summary";
import {
  conflictLabel,
  conflictsText,
  envCells,
  initialItemsPerSection,
  initialShown,
  OPEN_PREF_KEY,
  parseOpenPref,
  itemTone,
  nextShown,
  sectionStats,
  sourceChips,
  unknownsText,
  visibleSectionItems,
  type ItemTone,
} from "./view-model";

const MAX_SOURCE_CHIPS = 6;
const LONG_TEXT = 400;

const TONE_BORDER: Record<ItemTone, string> = {
  danger: "border-red-300 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/20",
  warn: "border-amber-300 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20",
  plain: "border-border bg-card",
};

function Sources({ sources, more }: { sources: ChecklistItem["sources"]; more?: number }) {
  const { chips, more: rest } = sourceChips(sources, MAX_SOURCE_CHIPS, more ?? 0);
  if (chips.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" aria-label="Sources">
      {chips.map((c) => (
        <Chip key={`${c.jira}|${c.pr}`} tone="muted" title={`Read on ${c.jira}, PR ${c.pr}`} className="font-medium">
          {c.label}
        </Chip>
      ))}
      {rest > 0 && <Chip tone="muted">+{rest} more</Chip>}
    </span>
  );
}

/** Free text: plain text only (never HTML), clamped when long with a toggle. */
function LongText({ text, className }: { text: string; className?: string }) {
  const [full, setFull] = useState(false);
  const long = text.length > LONG_TEXT;
  return (
    <>
      <p className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]", long && !full && "line-clamp-5", className)}>
        <Linkified text={text} />
      </p>
      {long && (
        <button type="button" className="text-[11px] text-blue-600 hover:underline dark:text-blue-400" aria-expanded={full} onClick={() => setFull((v) => !v)}>
          {full ? "Show less" : "Show full text"}
        </button>
      )}
    </>
  );
}

const ItemRow = memo(function ItemRow({ item, sectionId, plain }: { item: ChecklistItem; sectionId: string; plain?: PlainItems }) {
  const tone = itemTone(item);
  const p = plain?.byId.get(item.id);
  const repeat = !!plain?.repeats.has(item.id);
  const answers = answerList(item);
  const cells = envCells(item);
  return (
    <li data-testid={`movement-item-${sectionId}`} data-tone={tone} data-item-key={item.key} role="row" className={cn("rounded-md border px-2 py-1.5 text-xs", TONE_BORDER[tone])}>
      <div role="cell" className="grid items-start gap-x-3 gap-y-1 md:grid-cols-[minmax(0,1fr)_minmax(180px,34%)]">
        <div className="flex min-w-0 items-start gap-2">
        {item.seq !== undefined && <span className="mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums">{item.seq}</span>}
        <div className="min-w-0 flex-1">
          {item.config ? (
            <div>
              <p className="font-semibold [overflow-wrap:anywhere]">
                {item.config.key}
                {item.config.aliases?.length ? <span className="font-normal text-muted-foreground"> (also: {item.config.aliases.join(", ")})</span> : null}
              </p>
              <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                <Linkified text={[item.config.store ? `store: ${item.config.store}` : "", item.config.default !== undefined ? `default: ${item.config.default}` : ""].filter(Boolean).join(" · ")} />
              </p>
            </div>
          ) : answers ? (
            <div data-testid="movement-item-answers">
              <p className="font-semibold [overflow-wrap:anywhere]">{answers.label}</p>
              <ul className="mt-0.5 space-y-0.5">
                {answers.answers.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                    {a.word && <span className="font-medium">{a.word}</span>}
                    <span className="text-muted-foreground">{a.jiras.length > 4 ? `${a.jiras.slice(0, 3).join(", ")} +${a.jiras.length - 3} more` : a.jiras.join(", ")}</span>
                    {!isEmptyPlain(a.plain) && (
                      <span className="min-w-0 basis-full pl-3 sm:basis-auto">
                        <PlainView plain={a.plain} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : repeat ? (
            <p className="text-muted-foreground" data-testid="movement-item-repeat">
              Already listed above.
            </p>
          ) : p ? (
            <PlainView plain={p} />
          ) : (
            <LongText text={item.text} />
          )}
          {cells.length > 0 && (
            <div className="mt-1 grid gap-1 sm:grid-cols-3" data-testid="movement-env-cells">
              {cells.map((c) => (
                <div
                  key={c.env}
                  data-target={c.isTarget || undefined}
                  className={cn(
                    "rounded border px-1.5 py-1 text-[11px]",
                    c.attention
                      ? "border-red-400 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
                      : c.isTarget
                        ? "border-primary bg-primary/10 font-semibold"
                        : "border-border bg-muted/40 text-muted-foreground"
                  )}
                >
                  <span className="font-semibold">{c.label}</span>
                  {c.isTarget && <span className="ml-1 text-[10px] uppercase tracking-wide">target</span>}
                  <p className="[overflow-wrap:anywhere]">
                    <Linkified text={c.value ?? (c.attention ? "UNKNOWN: owner to confirm" : "unknown")} />
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
        <div className="flex flex-wrap items-start gap-1 md:justify-end">
          {item.label && <Chip tone={item.severity === "blocker" ? "danger" : item.severity === "warn" ? "warn" : "muted"}>{item.label}</Chip>}
          {!item.label && item.severity === "blocker" && <Chip tone="danger">Blocker</Chip>}
          {!item.label && item.severity === "warn" && <Chip tone="warn">Warn</Chip>}
          {item.needsAttention && <Chip tone="danger">Needs attention</Chip>}
          {item.conflict && (
            <Chip tone="warn">
              <RiErrorWarningLine className="size-3" /> Conflict
            </Chip>
          )}
          {item.raw && <Chip tone="muted" title="The review comment's own text, not a structured fact">raw text</Chip>}
          {(item.sources.length > 0 || item.moreSources) && (
            <div className="w-full md:text-right">
              <Sources sources={item.sources} more={item.moreSources} />
            </div>
          )}
        </div>
      </div>
      {item.conflict && (
        <ul className="mt-1 space-y-0.5 border-l-2 border-amber-400 pl-2" data-testid="movement-item-conflict">
          {item.conflict.variants.map((v, i) => (
            <li key={i} className="text-[11px]">
              <span className="font-medium [overflow-wrap:anywhere]">
                <Linkified text={v.text} />
              </span>
              {v.sources.length > 0 && (
                <span className="ml-1">
                  <Sources sources={v.sources} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
});

/** One section: open by default (the page's choice), its items are created when it is open and grow chunk by chunk (`perSection` first, then "Show more"). */
const SectionPanel = memo(function SectionPanel({ section, defaultOpen, perSection, plain, heading }: { section: ChecklistSection; defaultOpen: boolean; perSection: number; plain: PlainItems; heading?: { environment: string; deliveryName: string } }) {
  const [open, setOpen] = useState(defaultOpen);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const stats = useMemo(() => sectionStats(section), [section]);
  const bodyId = `movement-section-body-${section.id}`;
  const items = useMemo(() => (open ? visibleSectionItems(section, onlyFlagged) : []), [open, section, onlyFlagged]);
  const count = shown ?? initialShown(items.length, perSection);

  return (
    <section data-testid={`movement-section-${section.id}`} className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          data-testid={`movement-section-toggle-${section.id}`}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-left text-xs font-semibold"
        >
          <RiArrowRightSLine className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")} />
          <span>
            {section.number}. {section.title}
          </span>
          <Chip tone={stats.count ? "neutral" : "muted"}>{stats.count}</Chip>
          {stats.blockers > 0 && <Chip tone="danger">{stats.blockers} blocker{stats.blockers === 1 ? "" : "s"}</Chip>}
          {stats.warns > 0 && <Chip tone="warn">{stats.warns} warn</Chip>}
          {stats.conflicts > 0 && <Chip tone="warn">{stats.conflicts} conflict{stats.conflicts === 1 ? "" : "s"}</Chip>}
          {stats.attention > 0 && <Chip tone="danger">{stats.attention} need attention</Chip>}
        </button>
        <CopyButton getText={() => sectionPlainText(section, plain, heading)} label="Copy" testId={`movement-copy-section-${section.id}`} disabled={stats.count === 0} className="shrink-0" />
      </div>
      {open && (
        <div id={bodyId} className="space-y-1 border-t border-border p-2">
          {stats.flagged > 0 && stats.flagged < stats.count && (
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={onlyFlagged} onChange={(e) => { setOnlyFlagged(e.target.checked); setShown(null); }} />
              Only the {stats.flagged} that need a look
            </label>
          )}
          {items.length === 0 ? (
            <p className="py-2 text-center text-[11px] text-muted-foreground">Nothing recorded.</p>
          ) : (
            <ul className="space-y-1" role="table" aria-label={`Items of ${section.title}`}>
              {items.slice(0, count).map((it) => (
                <ItemRow key={it.id} item={it} sectionId={section.id} plain={plain} />
              ))}
            </ul>
          )}
          {count < items.length && (
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setShown(nextShown(count, items.length))} data-testid={`movement-section-more-${section.id}`}>
              Show {Math.min(50, items.length - count)} more ({items.length - count} not shown)
            </Button>
          )}
        </div>
      )}
    </section>
  );
});

function Block({ title, count, tone, testId, defaultOpen, copyText, children }: { title: string; count: number; tone: "danger" | "warn" | "neutral"; testId: string; defaultOpen: boolean; copyText?: () => string; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `${testId}-body`;
  return (
    <section data-testid={testId} className={cn("rounded-lg border", tone === "danger" ? "border-red-300 dark:border-red-900/60" : tone === "warn" ? "border-amber-300 dark:border-amber-900/60" : "border-border")}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="flex flex-1 items-center gap-1.5 text-left text-xs font-semibold" data-testid={`${testId}-toggle`}>
          <RiArrowRightSLine className={cn("size-4 transition-transform", open && "rotate-90")} />
          {title}
          <Chip tone={tone}>{count}</Chip>
        </button>
        {copyText && <CopyButton getText={copyText} testId={`${testId}-copy`} />}
      </div>
      {open && (
        <div id={id} className="space-y-1 border-t border-border p-2">
          {children}
        </div>
      )}
    </section>
  );
}

/** One conflict: its kind and title in the row, the disagreeing variants (with their sources) behind a chevron. */
function ConflictRow({ conflict: c }: { conflict: ChecklistConflict }) {
  const [open, setOpen] = useState(false);
  const bodyId = `movement-conflict-body-${c.id}`;
  return (
    <li role="row" className="rounded-md border border-amber-300 bg-amber-50/60 px-2 py-1 text-xs dark:border-amber-900/60 dark:bg-amber-950/20" data-testid="movement-conflict">
      <div role="cell" className="flex items-center gap-1.5">
        <button type="button" aria-expanded={open} aria-controls={bodyId} aria-label={`${open ? "Hide" : "Show"} the ${c.variants.length} variants of ${c.title}`} onClick={() => setOpen((v) => !v)} className="shrink-0 rounded focus-visible:outline-2 focus-visible:outline-ring" data-testid="movement-conflict-toggle">
          <RiArrowRightSLine className={cn("size-4 transition-transform", open && "rotate-90")} />
        </button>
        <Chip tone={c.severity === "blocker" ? "danger" : "warn"} title={c.kind} testId={`movement-conflict-kind-${c.kind}`}>
          {conflictLabel(c.kind)}
        </Chip>
        <span className="min-w-0 flex-1 truncate font-semibold" title={c.title}>
          <Linkified text={c.title} />
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{c.variants.length} variants</span>
      </div>
      {open && (
        <table id={bodyId} className="mt-1 w-full table-fixed border-collapse text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="border-b border-amber-300/60 px-1.5 py-0.5 font-medium">Variant</th>
              <th scope="col" className="w-2/5 border-b border-amber-300/60 px-1.5 py-0.5 font-medium">Read on</th>
            </tr>
          </thead>
          <tbody>
            {c.variants.map((v, i) => (
              <tr key={i}>
                <td className="px-1.5 py-0.5 align-top font-medium [overflow-wrap:anywhere]">
                  <Linkified text={v.text} />
                </td>
                <td className="px-1.5 py-0.5 align-top">
                  <Sources sources={v.sources} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}

function ConflictsBlock({ conflicts }: { conflicts: ChecklistConflict[] }) {
  // Derived from the current length (a reload can add or remove entries): the first chunk plus what was asked for.
  const [more, setMore] = useState(0);
  const shown = Math.min(conflicts.length, initialShown(conflicts.length, 10) + more);
  return (
    <Block title="Conflicts: review comments disagree, decide before moving" count={conflicts.length} tone="warn" testId="movement-conflicts" defaultOpen copyText={() => conflictsText(conflicts)}>
      <ul className="space-y-1" role="table" aria-label="Conflicts">
        {conflicts.slice(0, shown).map((c) => (
          <ConflictRow key={c.id} conflict={c} />
        ))}
      </ul>
      {shown < conflicts.length && (
        <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setMore((m) => m + 10)} data-testid="movement-conflicts-more">
          Show more ({conflicts.length - shown} not shown)
        </Button>
      )}
    </Block>
  );
}

function UnknownGroup({ group }: { group: Checklist["unknownsByOwner"][number] }) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(0);
  const shown = Math.min(group.items.length, initialShown(group.items.length, 25) + more);
  const total = group.items.length + (group.more ?? 0);
  const id = `movement-unknown-${group.owner || "none"}`;
  return (
    <li className="rounded-md border border-border" data-testid="movement-unknown-group" data-owner={group.owner || ""}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs font-semibold">
        <RiArrowRightSLine className={cn("size-4 transition-transform", open && "rotate-90")} />
        {group.owner || "owner not named"}
        <Chip tone="warn">{total}</Chip>
      </button>
      {open && (
        <div id={id} className="space-y-1 border-t border-border p-2">
          <ul className="space-y-1">
            {group.items.slice(0, shown).map((u, i) => (
              <li key={i} className="text-xs">
                <LongText text={u.text} />
                <Sources sources={u.sources} more={u.moreSources} />
              </li>
            ))}
          </ul>
          {shown < group.items.length && (
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setMore((m) => m + 25)}>
              Show more ({group.items.length - shown} not shown)
            </Button>
          )}
          {group.more ? <p className="text-[11px] text-muted-foreground">+{group.more} more not listed</p> : null}
        </div>
      )}
    </li>
  );
}

export function ExportMenu({ exportBase, disabled }: { exportBase: string; disabled?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={disabled} data-testid="movement-export">
          <RiDownload2Line className="size-3.5" /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={`${exportBase}?format=xlsx`} download data-testid="movement-export-xlsx">
            Excel (.xlsx)
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`${exportBase}?format=text`} download data-testid="movement-export-text">
            Plain text
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`${exportBase}?format=html`} target="_blank" rel="noopener noreferrer" data-testid="movement-export-print">
            Print / PDF (print view)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MovementChecklist({
  checklist,
  loading,
  error,
  onRetry,
  exportBase,
  needsRefresh = false,
  summary,
  heading,
}: {
  checklist: Checklist | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  exportBase: string;
  /** The stored Jira data is unreadable (the endpoint would answer 409 inputs_stale): say so instead of loading forever. */
  needsRefresh?: boolean;
  /** The summary of all Jiras (present: the tab opens on "Summary" with the "All items" list one switch away; absent: only the item list). */
  summary?: {
    state: SummaryState;
    canGenerate: boolean;
    onGenerate: (force: boolean) => void;
    onRetry: () => void;
  };
  /** The environment and delivery named in the heading of every copied text. */
  heading?: { environment: string; deliveryName: string };
}) {
  const [view, setView] = useState<"summary" | "all">(summary ? "summary" : "all");
  // Every section is open by default; "Collapse all" / "Expand all" changes all of them and is remembered (storage may be missing or blocked: then it is just open).
  const [allOpen, setAllOpen] = useState<boolean>(() => {
    try {
      return parseOpenPref(window.localStorage.getItem(OPEN_PREF_KEY));
    } catch {
      return true;
    }
  });
  const [epoch, setEpoch] = useState(0);
  function chooseAll(next: boolean) {
    setAllOpen(next);
    setEpoch((e) => e + 1); // the sections remount with the new default
    try {
      window.localStorage.setItem(OPEN_PREF_KEY, next ? "open" : "closed");
    } catch {
      // not remembered
    }
  }
  const perSection = initialItemsPerSection(checklist?.sections.length ?? 14);
  if (needsRefresh) {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground" data-testid="movement-checklist-needs-refresh">
        The checklist cannot be built until the stored data is re-read. Use Refresh.
      </p>
    );
  }
  if (error && !checklist) {
    return (
      <div className="space-y-2 text-xs">
        <p role="alert" className="text-destructive">
          {error}
        </p>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (!checklist) return <p className="text-xs text-muted-foreground">{loading ? "Loading the checklist…" : "No checklist yet."}</p>;

  return (
    <div className="space-y-2" data-testid="movement-checklist">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs font-semibold [overflow-wrap:anywhere]" data-testid="movement-checklist-summary">
          {checklist.summary}
        </p>
        <ExportMenu exportBase={exportBase} />
      </div>
      {summary && (
        <div role="group" aria-label="Checklist view" className="inline-flex rounded-md border border-border p-0.5" data-testid="movement-view-switch">
          {(["summary", "all"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn("rounded px-2 py-0.5 text-[11px] font-medium focus-visible:outline-2 focus-visible:outline-ring", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
              data-testid={`movement-view-${v}`}
            >
              {v === "summary" ? "Summary" : "All items"}
            </button>
          ))}
        </div>
      )}
      {summary && view === "summary" && (
        <>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" className="h-7 text-[11px]" aria-pressed={allOpen} onClick={() => chooseAll(!allOpen)} data-testid="movement-sections-toggle-all">
              {allOpen ? "Collapse all" : "Expand all"}
            </Button>
          </div>
          <SummaryPanel state={summary.state} canGenerate={summary.canGenerate} needsRefresh={needsRefresh} onGenerate={summary.onGenerate} onRetry={summary.onRetry} allOpen={allOpen} epoch={epoch} env={heading} />
        </>
      )}
      {(!summary || view === "all") && <ItemList checklist={checklist} allOpen={allOpen} epoch={epoch} perSection={perSection} chooseAll={chooseAll} heading={heading} />}
    </div>
  );
}

function ItemList({
  checklist,
  allOpen,
  epoch,
  perSection,
  chooseAll,
  heading,
}: {
  checklist: Checklist;
  allOpen: boolean;
  epoch: number;
  perSection: number;
  chooseAll: (next: boolean) => void;
  heading?: { environment: string; deliveryName: string };
}) {
  const plain = useMemo(() => plainItems(checklist), [checklist]);
  return (
    <>
      {checklist.conflicts.length > 0 && <ConflictsBlock conflicts={checklist.conflicts} />}
      {checklist.unknownsByOwner.length > 0 && (
        <Block title="Unknowns to resolve (by owner)" count={checklist.stats.unknowns} tone="warn" testId="movement-unknowns" defaultOpen copyText={() => unknownsText(checklist.unknownsByOwner)}>
          <ul className="space-y-1">
            {checklist.unknownsByOwner.map((g) => (
              <UnknownGroup key={g.owner || "__none"} group={g} />
            ))}
          </ul>
        </Block>
      )}
      {checklist.warnings.length > 0 && (
        <Block title="Warnings" count={checklist.warnings.length} tone="neutral" testId="movement-warnings" defaultOpen={false} copyText={() => ["Warnings", ...checklist.warnings.map((w) => `- ${w.message}`)].join("\n")}>
          <ul className="space-y-1">
            {checklist.warnings.map((w, i) => (
              <li key={i} className="text-xs">
                <span className="[overflow-wrap:anywhere]">
                  <Linkified text={w.message} />
                </span>{" "}
                <Sources sources={w.sources} />
              </li>
            ))}
          </ul>
        </Block>
      )}
      <div className="flex items-center justify-end gap-2">
        <span className="text-[11px] text-muted-foreground">{checklist.sections.length} sections</span>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" aria-pressed={allOpen} onClick={() => chooseAll(!allOpen)} data-testid="movement-sections-toggle-all">
          {allOpen ? "Collapse all" : "Expand all"}
        </Button>
      </div>
      <div className="space-y-1.5" data-testid="movement-sections">
        {checklist.sections.map((s) => (
          <SectionPanel key={`${s.id}:${epoch}`} section={s} defaultOpen={allOpen} perSection={perSection} plain={plain} heading={heading} />
        ))}
      </div>
    </>
  );
}

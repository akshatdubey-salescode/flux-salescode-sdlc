"use client";

import { memo, useMemo, useState } from "react";
import { RiArrowRightSLine, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Badge, Glance, RollupEntry, RollupSection } from "./api-types";
import { Linkified, StateWord } from "./linkified";
import { PlainView } from "./plain-view";
import { badgeLook, entryExpandable, glanceText, orderGlance, plainSummary, SEVERITY_BAR, statsStrip, summarySectionText, summaryStatusLine, type PlainEntry, type PlainGlance, type PlainSummary } from "./summary";
import { Chip, CopyButton, GuardedButton } from "./ui-bits";
import type { SummaryState } from "./use-summary";
import { envCells } from "./view-model";

/** A badge in the same fonts and colours as the state words everywhere else (Done green, NOT DONE red, ...). */
export function BadgeView({ badge }: { badge: Badge }) {
  const look = badgeLook(badge);
  if (look.kind === "chip")
    return (
      <Chip tone={look.tone} className="px-1.5 text-[10px] uppercase tracking-wide" testId={`movement-badge-${badge.toLowerCase().replace(/ /g, "-")}`}>
        {badge}
      </Chip>
    );
  return (
    <span className="inline-flex items-center rounded-full border border-border px-1.5 py-0.5 text-[10px]" data-testid={`movement-badge-${badge.toLowerCase().replace(/ /g, "-")}`}>
      <StateWord state={look.state}>{badge}</StateWord>
    </span>
  );
}

/** How many Jira chips an entry shows before it says "+N more" (the full list is in the expanded entry). */
export const MAX_JIRA_CHIPS = 3;

/**
 * Jira chips: "All 13 Jiras" when the entry covers every Jira of the movement, else at most three chips and "+N more" (up to four are all shown).
 * `full` shows every key (the expanded entry).
 */
export function JiraChips({ jiras, more, total, full }: { jiras: string[]; more?: number; total?: number; full?: boolean }) {
  const n = jiras.length + (more ?? 0);
  if (n === 0) return <span className="text-muted-foreground">—</span>;
  if (!full && total && total > 1 && n >= total)
    return (
      <span className="rounded bg-muted px-1 text-[11px]" data-testid="movement-jira-chips-all">
        All {total} Jiras
      </span>
    );
  const shown = full || n <= MAX_JIRA_CHIPS + 1 ? jiras : jiras.slice(0, MAX_JIRA_CHIPS);
  const rest = n - shown.length;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map((j) => (
        <span key={j} className="rounded bg-muted px-1 text-[11px]">
          <Linkified text={j} />
        </span>
      ))}
      {rest > 0 ? <span className="rounded bg-muted px-1 text-[11px] text-muted-foreground">+{rest} more</span> : null}
    </span>
  );
}

function GlanceCard({ g, n, plain, total }: { g: Glance; n: number; plain?: PlainGlance; total?: number }) {
  return (
    <li className="flex overflow-hidden rounded-lg border border-border bg-card" data-testid={`movement-glance-card-${n}`} data-severity={g.severity}>
      <span className={cn("w-1.5 shrink-0", SEVERITY_BAR[g.severity] ?? "bg-muted")} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1 p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <BadgeView badge={g.badge} />
          <span className="sr-only">{g.severity}</span>
          <p className="min-w-0 flex-1 text-xs font-semibold [overflow-wrap:anywhere]">
            <Linkified text={plain?.title ?? g.title} />
          </p>
        </div>
        {plain ? plain.detail && (
          <div className="text-[11px]">
            <PlainView plain={plain.detail} muted />
          </div>
        ) : g.detail && (
          <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
            <Linkified text={g.detail} />
          </p>
        )}
        {g.jiras.length > 0 && <JiraChips jiras={g.jiras} total={total} />}
      </div>
    </li>
  );
}

const EntryRow = memo(function EntryRow({ e, sectionId, pe, total }: { e: RollupEntry; sectionId: string; pe?: PlainEntry; total?: number }) {
  const [open, setOpen] = useState(false);
  const manyJiras = e.jiras.length + (e.moreJiras ?? 0) > MAX_JIRA_CHIPS + 1;
  const expandable = (entryExpandable(e) && (!pe || pe.details.length > 0 || !!e.env)) || manyJiras;
  const cells = e.env ? envCells({ env: e.env }) : [];
  const bodyId = `movement-summary-entry-${sectionId}-${e.key}`;
  return (
    <>
      <tr className={cn("border-b border-border/60", e.needsAttention && "bg-amber-50/50 dark:bg-amber-950/10")} data-testid={`movement-summary-entry-${sectionId}`}>
        <td className="px-2 py-1 align-top font-medium [overflow-wrap:anywhere]">
          <Linkified text={e.title} />
        </td>
        <td className="px-2 py-1 align-top">
          <BadgeView badge={e.badge} />
        </td>
        <td className="px-2 py-1 align-top [overflow-wrap:anywhere]">
          {(pe?.line ?? e.line) ? <Linkified text={pe?.line ?? e.line} /> : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-2 py-1 align-top">
          <JiraChips jiras={e.jiras} more={e.moreJiras} total={total} />
        </td>
        <td className="w-8 px-1 py-1 text-right align-top">
          {expandable && (
            <Button variant="ghost" size="icon-sm" aria-expanded={open} aria-controls={bodyId} aria-label={`${open ? "Hide" : "Show"} details of ${e.title}`} onClick={() => setOpen((v) => !v)}>
              <RiArrowRightSLine className={cn("size-4 transition-transform", open && "rotate-90")} />
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr id={bodyId} className="border-b border-border/60 bg-muted/20">
          <td colSpan={5} className="space-y-1 px-3 py-1.5 text-[11px]">
            {cells.length > 0 && (
              <div className="grid gap-1 sm:grid-cols-3" data-testid="movement-summary-env-cells">
                {cells.map((c) => (
                  <div key={c.env} className={cn("rounded border px-1.5 py-1", c.isTarget ? "border-primary bg-primary/10" : "border-border bg-card")}>
                    <span className="font-semibold">{c.label}</span>
                    {c.isTarget && <span className="ml-1 text-[10px] uppercase">target</span>}
                    <p className="[overflow-wrap:anywhere]">{c.value === null ? <StateWord state="unknown">not set</StateWord> : <Linkified text={c.value} />}</p>
                  </div>
                ))}
              </div>
            )}
            {manyJiras && (
              <p className="flex flex-wrap items-center gap-1" data-testid="movement-summary-entry-jiras">
                <span className="font-semibold">Jiras ({e.jiras.length + (e.moreJiras ?? 0)})</span>
                <JiraChips jiras={e.jiras} more={e.moreJiras} full />
              </p>
            )}
            {pe
              ? pe.details.map((d, i) => (
                  <div key={i} className="flex flex-wrap items-start gap-1 [overflow-wrap:anywhere]">
                    <div className="min-w-0 flex-1">
                      <PlainView plain={d.plain} />
                    </div>
                    {d.jiras.length > 0 && <JiraChips jiras={d.jiras} />}
                  </div>
                ))
              : e.details?.map((d, i) => (
                  <p key={i} className="[overflow-wrap:anywhere]">
                    <Linkified text={d.text} /> {d.jiras.length > 0 && <JiraChips jiras={d.jiras} />}
                  </p>
                ))}
          </td>
        </tr>
      )}
    </>
  );
});

/** One section of the rollup as a consolidated table: Entry | Badge | Summary | Jiras | expand. Entries come in the order the server delivered (severity first). */
export function SummarySection({ section, defaultOpen, plain, env, totalJiras }: { section: RollupSection; defaultOpen: boolean; plain?: PlainSummary; env?: { environment: string; deliveryName: string }; totalJiras?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `movement-summary-body-${section.id}`;
  const attention = section.entries.filter((e) => e.needsAttention).length;
  const plainFor = useMemo(() => plain ?? plainSummary({ glance: [], sections: [section] }), [plain, section]);
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card" data-testid={`movement-summary-table-${section.id}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-left text-xs font-semibold focus-visible:outline-2 focus-visible:outline-ring" data-testid={`movement-summary-toggle-${section.id}`}>
          <RiArrowRightSLine className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")} />
          {section.title}
          <Chip tone={section.entries.length ? "neutral" : "muted"}>{section.entries.length}</Chip>
          {attention > 0 && <Chip tone="danger">{attention} need attention</Chip>}
        </button>
        <CopyButton getText={() => summarySectionText(section, plainFor, env)} label="Copy" testId={`movement-summary-copy-${section.id}`} disabled={section.entries.length === 0} className="shrink-0" />
      </div>
      {open &&
        (section.entries.length === 0 ? (
          <p id={id} className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            Nothing recorded.
          </p>
        ) : (
          <div id={id} className="relative overflow-x-auto border-t border-border" data-testid={`movement-summary-scroll-${section.id}`}>
            <table className="w-full min-w-[640px] table-fixed border-collapse text-[11px]" aria-label={section.title}>
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="w-1/4 px-2 py-1 font-medium">Entry</th>
                  <th scope="col" className="w-28 px-2 py-1 font-medium">Badge</th>
                  <th scope="col" className="px-2 py-1 font-medium">Summary</th>
                  <th scope="col" className="w-1/5 px-2 py-1 font-medium">Jiras</th>
                  <th scope="col" className="w-8 px-1 py-1"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {section.entries.map((e) => (
                  <EntryRow key={e.key} e={e} sectionId={section.id} pe={plainFor.sections.get(section.id)?.get(e.key)} total={totalJiras} />
                ))}
              </tbody>
            </table>
            {section.more ? <p className="px-3 py-1 text-[11px] text-muted-foreground">+{section.more} more entries not listed.</p> : null}
          </div>
        ))}
    </section>
  );
}

/**
 * The Checklist tab's summary: the headline, the status line with its Generate / Regenerate button, the stats strip, the "At a glance" cards and
 * the sections as consolidated tables. The deterministic roll-up is on screen at once; the AI wording replaces it only when it is fresh.
 */
export function SummaryPanel({
  state,
  canGenerate,
  needsRefresh,
  onGenerate,
  onRetry,
  allOpen,
  epoch,
  env,
}: {
  state: SummaryState;
  canGenerate: boolean;
  needsRefresh: boolean;
  onGenerate: (force: boolean) => void;
  onRetry: () => void;
  allOpen: boolean;
  epoch: number;
  /** For the headings of the copied texts ("Summary of the PROD movement: <delivery>"). */
  env?: { environment: string; deliveryName: string };
}) {
  const d = state.data;
  const plain = useMemo(() => (d ? plainSummary(d.summary) : null), [d]);
  if (!d) {
    if (state.error)
      return (
        <div className="space-y-2 text-xs" data-testid="movement-summary-error">
          <p role="alert" className="text-destructive">
            {state.stale ? "The stored data must be re-read first; use Refresh." : state.error}
          </p>
          {!state.stale && (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      );
    return <p className="text-xs text-muted-foreground" data-testid="movement-summary-loading">Loading the summary…</p>;
  }
  const line = summaryStatusLine(d, canGenerate, needsRefresh);
  const glance = orderGlance(d.summary.glance);
  const stats = statsStrip(d.rollup.headline);
  return (
    <div className="space-y-3" data-testid="movement-summary">
      <p className="text-sm font-bold [overflow-wrap:anywhere]" data-testid="movement-summary-headline">
        <Linkified text={d.summary.headline} />
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className={cn(line.tone === "warn" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")} data-testid="movement-summary-status">
          {line.text}
        </span>
        <GuardedButton variant="outline" size="sm" className="h-7 gap-1 text-[11px]" disabled={state.generating || !!line.button.disabledReason} reason={line.button.disabledReason} onClick={() => onGenerate(true)} data-testid="movement-summary-generate">
          {state.generating && <RiLoader4Line className="size-3.5 animate-spin" />}
          {state.generating ? "Generating…" : line.button.label}
        </GuardedButton>
        {state.genError && (
          <span role="alert" className="text-destructive" data-testid="movement-summary-generate-error">
            {state.genError}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" data-testid="movement-summary-stats">
        {stats.map((s) => (
          <Chip key={s.label} tone={s.tone}>
            <span className="tabular-nums">{s.value}</span> {s.label}
          </Chip>
        ))}
      </div>
      <section aria-label="At a glance" data-testid="movement-glance">
        <div className="mb-1 flex items-center gap-2">
          <h3 className="text-xs font-semibold">At a glance</h3>
          <span className="ml-auto" />
          <CopyButton getText={() => glanceText(d.summary.glance, plain ?? plainSummary(d.summary), env)} label="Copy" testId="movement-glance-copy" disabled={glance.length === 0} />
        </div>
        {glance.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Nothing stands out.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {glance.map((g, i) => (
              <GlanceCard key={g.id} g={g} n={i} plain={plain?.glance.get(g.id)} total={d.rollup.jiraKeys.length} />
            ))}
          </ul>
        )}
      </section>
      <div className="space-y-1.5" data-testid="movement-summary-sections">
        {d.summary.sections.map((s) => (
          <SummarySection key={`${s.id}:${epoch}`} section={s} defaultOpen={allOpen} plain={plain ?? undefined} env={env} totalJiras={d.rollup.jiraKeys.length} />
        ))}
      </div>
    </div>
  );
}

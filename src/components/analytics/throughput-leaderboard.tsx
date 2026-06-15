"use client";

import { useState, type ReactNode } from "react";
import {
  RiExternalLinkLine,
  RiArrowDownSLine,
  RiCheckboxCircleLine,
  RiInboxLine,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChartInfo } from "@/components/ui/chart-info";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  getQuarterChips,
  getRangePresets,
  currentFiscalQuarterChip,
} from "@/lib/date-utils";
import type {
  ThroughputResponse,
  PersonThroughput,
} from "@/app/api/analytics/throughput/route";

type Props = {
  people: { email: string; name: string }[];
};

function fmt(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Wraps any element so hovering it shows an explanatory tooltip. */
function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-left leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export function ThroughputLeaderboard({ people }: Props) {
  const defaultChip = currentFiscalQuarterChip();
  const presets = getRangePresets();
  const chips = getQuarterChips();

  const [start, setStart] = useState(defaultChip.start);
  const [end, setEnd] = useState(defaultChip.end);
  const [emails, setEmails] = useState<string[]>([]);

  const [data, setData] = useState<ThroughputResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const peopleOptions = people.map((p) => ({
    value: p.email,
    label: `${p.name} · ${p.email}`,
  }));

  const isActiveRange = (c: { start: string; end: string }) =>
    c.start === start && c.end === end;

  function selectRange(c: { start: string; end: string }) {
    setStart(c.start);
    setEnd(c.end);
    setData(null);
  }

  function run() {
    setLoading(true);
    const params = new URLSearchParams({ start, end });
    if (emails.length) params.set("emails", emails.join(","));
    fetch(`/api/analytics/throughput?${params}`)
      .then((r) => r.json())
      .then((d: ThroughputResponse) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-5">
        <Card>
          <CardContent className="space-y-4 p-4">
            {/* Period */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                1 · Period
                <ChartInfo description="The window an issue must have been closed in to count. An issue counts toward a person if it first reached a Done status between these dates (inclusive). Use a quick range, pick a fiscal quarter, or set a custom From–To range." />
              </Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {presets.map((c) => (
                  <RangeChip
                    key={c.label}
                    label={c.label}
                    active={isActiveRange(c)}
                    onClick={() => selectRange(c)}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {chips.map((c) => (
                  <RangeChip
                    key={`${c.start}-${c.end}`}
                    label={c.label}
                    active={isActiveRange(c)}
                    onClick={() => selectRange(c)}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3 pt-1">
                <DateField label="From" value={start} onChange={(v) => { setStart(v); setData(null); }} />
                <DateField label="To" value={end} onChange={(v) => { setEnd(v); setData(null); }} />
              </div>
            </div>

            {/* Focus filter */}
            <div className="space-y-1.5 border-t border-border pt-4">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                2 · Focus on people (optional)
                <ChartInfo description="Leave empty to rank everyone in the org. Pick specific people to compare just them." />
              </Label>
              <MultiSelect
                options={peopleOptions}
                onValueChange={(v) => { setEmails(v); setData(null); }}
                placeholder="All people — or search to focus…"
                maxCount={4}
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button onClick={run} disabled={loading || end < start} size="lg">
                <RiCheckboxCircleLine />
                {loading ? "Counting…" : "View throughput"}
              </Button>
              {end < start && (
                <span className="text-xs text-muted-foreground">
                  &ldquo;To&rdquo; must be on or after &ldquo;From&rdquo;.
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {data && <Results data={data} loading={loading} />}
      </div>
    </TooltipProvider>
  );
}

function RangeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-muted/50"
      )}
    >
      {label}
    </button>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-40"
      />
    </div>
  );
}

function Results({ data, loading }: { data: ThroughputResponse; loading: boolean }) {
  const max = data.people.reduce((m, p) => Math.max(m, p.closed), 0);

  return (
    <div className={cn("space-y-2", loading && "opacity-50")}>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Issues closed {fmt(data.range.start)} – {fmt(data.range.end)}
          <ChartInfo description="Each issue is counted once per person who held it — the primary assignee and any additional assignees. The org total counts each issue only once, so it can be smaller than the sum of the rows. Cancelled issues are excluded." />
        </h2>
        <span className="text-xs text-muted-foreground">
          {data.totalClosed} issue{data.totalClosed === 1 ? "" : "s"} ·{" "}
          {data.people.length} {data.people.length === 1 ? "person" : "people"}
        </span>
      </div>

      {data.people.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
          <RiInboxLine className="size-4" /> No issues closed in this period.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {data.people.map((p) => (
            <PersonRow key={p.email} person={p} max={max} />
          ))}
        </div>
      )}
    </div>
  );
}

function PersonRow({ person, max }: { person: PersonThroughput; max: number }) {
  const [open, setOpen] = useState(false);
  const pct = max > 0 ? Math.round((person.closed / max) * 100) : 0;

  return (
    <div className="border-b border-border/60 last:border-0">
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/30"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{person.name}</p>
          <p className="truncate text-xs text-muted-foreground">{person.email}</p>
          {/* Proportional bar */}
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {person.asAdditional > 0 && (
          <Tip text={`${person.asPrimary} as primary assignee, ${person.asAdditional} as an additional assignee.`}>
            <Badge variant="outline" className="shrink-0 tabular-nums">
              {person.asPrimary} + {person.asAdditional}
            </Badge>
          </Tip>
        )}

        <span className="flex shrink-0 items-center gap-1.5">
          <Tip text="Distinct issues this person closed in the period.">
            <Badge className="shrink-0 tabular-nums">
              {person.closed} closed
            </Badge>
          </Tip>
          <RiArrowDownSLine
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </span>
      </div>

      {open && (
        <div className="space-y-1 bg-muted/20 px-4 py-2">
          {person.issues.map((i) => (
            <a
              key={i.jiraKey}
              href={i.jiraUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 text-xs"
            >
              <span className="font-mono font-medium text-primary group-hover:underline">
                {i.jiraKey}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {i.summary}
              </span>
              <span className="shrink-0 text-muted-foreground/70">{i.projectName}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground/80">
                {fmt(i.completedAt)}
              </span>
              <RiExternalLinkLine className="size-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

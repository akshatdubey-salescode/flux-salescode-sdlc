"use client";

import { useState, type ReactNode } from "react";
import {
  RiExternalLinkLine,
  RiArrowDownSLine,
  RiCalendarCheckLine,
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import type {
  AvailabilityResponse,
  PersonAvailability,
  AvailabilityScope,
  AvailabilityMode,
} from "@/app/api/analytics/availability/route";

type Props = {
  projects: { id: string; name: string }[];
  boards: { id: string; name: string }[];
  people: { email: string; name: string }[];
};

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function offset(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Fiscal-year start (1 April) — the default stale-work cutoff. */
function fiscalAprilFirst(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return `${m >= 4 ? y : y - 1}-04-01`;
}

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

const SCOPES: { value: AvailabilityScope; label: string; hint: string }[] = [
  { value: "project", label: "Project", hint: "Check everyone who has work assigned in a chosen project." },
  { value: "team", label: "Team", hint: "Check the members of an Observer Board (and its manager)." },
  { value: "global", label: "Global", hint: "Check every person across the whole org — useful for top-down planning." },
  { value: "people", label: "People", hint: "Hand-pick specific individuals to compare." },
];

export function AvailabilityFinder({ projects, boards, people }: Props) {
  const t = todayStr();

  const [scope, setScope] = useState<AvailabilityScope>("project");
  const [projectId, setProjectId] = useState("");
  const [boardId, setBoardId] = useState("");
  const [emails, setEmails] = useState<string[]>([]);

  const [mode, setMode] = useState<AvailabilityMode>("range");
  const [start, setStart] = useState(t);
  const [end, setEnd] = useState(offset(t, 6));
  const [duration, setDuration] = useState(3);
  const [from, setFrom] = useState(t);
  const [horizon, setHorizon] = useState(60);
  const [activeSince, setActiveSince] = useState(fiscalAprilFirst());

  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const peopleOptions = people.map((p) => ({ value: p.email, label: `${p.name} · ${p.email}` }));

  const canRun =
    scope === "global" ||
    (scope === "project" && !!projectId) ||
    (scope === "team" && !!boardId) ||
    (scope === "people" && emails.length > 0);

  function run() {
    if (!canRun) return;
    setLoading(true);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const nowStr = `${todayStr()}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const params = new URLSearchParams({ now: nowStr, scope, mode });
    if (scope === "project") params.set("projectId", projectId);
    if (scope === "team") params.set("boardId", boardId);
    if (scope === "people") params.set("emails", emails.join(","));
    if (mode === "range") {
      params.set("start", start);
      params.set("end", end);
    } else {
      params.set("duration", String(duration));
      params.set("from", from);
      params.set("horizon", String(horizon));
    }
    params.set("activeSince", activeSince);
    fetch(`/api/analytics/availability?${params}`)
      .then((r) => r.json())
      .then((d: AvailabilityResponse) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4 p-4">
          {/* Scope */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              1 · Who to check
              <ChartInfo description="Pick the pool of people to evaluate. Project = anyone who has work in that project. Team = members of an Observer Board (plus its manager). Global = everyone across the org (for top-down planning). People = specific individuals you choose. Availability itself is always global — it counts a person's work across ALL projects, no matter which pool you pick." />
            </Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {SCOPES.map((s) => (
                <Tip key={s.value} text={s.hint}>
                  <button
                    onClick={() => {
                      setScope(s.value);
                      setData(null);
                    }}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                      scope === s.value
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {s.label}
                  </button>
                </Tip>
              ))}
            </div>
          </div>

          {/* Scope-specific picker */}
          {scope === "project" && (
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue placeholder="Choose a project…" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {scope === "team" && (
            <Select value={boardId} onValueChange={setBoardId}>
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue placeholder="Choose a team / board…" />
              </SelectTrigger>
              <SelectContent>
                {boards.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No boards yet</div>
                ) : (
                  boards.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          )}
          {scope === "people" && (
            <MultiSelect
              options={peopleOptions}
              onValueChange={setEmails}
              placeholder="Search and select people…"
              maxCount={4}
            />
          )}
          {scope === "global" && (
            <p className="text-xs text-muted-foreground">
              Checking all {people.length} people across the org.
            </p>
          )}

          {/* Mode */}
          <div className="space-y-1.5 border-t border-border pt-4">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              2 · When
              <ChartInfo description="Specific date range → for an exact window you have in mind, see who is completely free during it. Free for N days → you only know the task takes N days; the tool finds each person's next free slot of that length, soonest first." />
            </Label>
            <div className="flex items-center gap-1.5">
              {(["range", "duration"] as AvailabilityMode[]).map((m) => (
                <Tip
                  key={m}
                  text={
                    m === "range"
                      ? "Check a fixed window (From–To): who has no overlapping task during it."
                      : "Give a task length in days: find each person's next free gap of that many consecutive days."
                  }
                >
                  <button
                    onClick={() => {
                      setMode(m);
                      setData(null);
                    }}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                      mode === m
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {m === "range" ? "Specific date range" : "Free for N days"}
                  </button>
                </Tip>
              ))}
            </div>

            {mode === "range" ? (
              <div className="flex flex-wrap items-end gap-3 pt-1">
                <DateField label="From" value={start} onChange={setStart} />
                <DateField label="To" value={end} onChange={setEnd} />
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3 pt-1">
                <NumField label="Days needed" value={duration} onChange={setDuration} min={1} className="w-28" info="How many consecutive free days the task needs." />
                <DateField label="Earliest start" value={from} onChange={setFrom} info="Don't look for slots before this date (defaults to today)." />
                <NumField label="Search horizon (days)" value={horizon} onChange={setHorizon} min={1} className="w-40" info="How far ahead to search for a free slot before giving up." />
              </div>
            )}
          </div>

          {/* Stale-work filter */}
          <div className="space-y-1.5 border-t border-border pt-4">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              3 · Ignore stale undated work
              <ChartInfo description="The system holds many stale Jiras — old open tickets with no dates that nobody touches. The 'undated' flag counts an undated task only if it was created on/after this date — the same rule the dashboard's 'Unplanned' metric uses, so the two agree. Dated tasks are always judged by their own start/due dates. Defaults to the fiscal-year start (1 April)." />
            </Label>
            <DateField
              label="Count undated tasks created since"
              value={activeSince}
              onChange={setActiveSince}
              info="Matches the dashboard's 'Unplanned' metric: an undated open task only counts toward the undated flag if it was created on/after this date. Older undated tickets are treated as stale and ignored."
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button onClick={run} disabled={!canRun || loading} size="lg">
              <RiCalendarCheckLine />
              {loading ? "Checking…" : "Find availability"}
            </Button>
            {!canRun && (
              <span className="text-xs text-muted-foreground">
                {scope === "project" && "Pick a project to continue."}
                {scope === "team" && "Pick a team to continue."}
                {scope === "people" && "Select at least one person."}
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

function FieldLabel({ label, info }: { label: string; info?: string }) {
  return (
    <Label className="flex items-center gap-1 text-[11px] text-muted-foreground">
      {label}
      {info && <ChartInfo description={info} />}
    </Label>
  );
}

function DateField({
  label,
  value,
  onChange,
  info,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  info?: string;
}) {
  return (
    <div className="space-y-1">
      <FieldLabel label={label} info={info} />
      <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="w-40" />
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  className,
  info,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  className?: string;
  info?: string;
}) {
  return (
    <div className="space-y-1">
      <FieldLabel label={label} info={info} />
      <Input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min ?? 0, parseInt(e.target.value, 10) || 0))}
        className={className}
      />
    </div>
  );
}

function Results({ data, loading }: { data: AvailabilityResponse; loading: boolean }) {
  const freeCount =
    data.mode === "range"
      ? data.people.filter((p) => p.free).length
      : data.people.filter((p) => p.freeNow).length;

  return (
    <div className={cn("space-y-2", loading && "opacity-50")}>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {data.mode === "range"
            ? `Free ${data.range ? `${fmt(data.range.start)} – ${fmt(data.range.end)}` : ""}`
            : `Next free ${data.duration?.days}-day slot`}
          <ChartInfo
            description={
              data.mode === "range"
                ? "People free for the whole window are listed first. 'Free' means no open task with a start–due date overlaps it. Click a busy row to see the clashing tasks."
                : "Sorted by who is free soonest. 'Free now' = available from the earliest start date; 'Free from' = their next slot of the required length."
            }
          />
        </h2>
        <span className="text-xs text-muted-foreground">
          {freeCount} of {data.people.length}{" "}
          {data.mode === "range" ? "free" : "free now"}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground/70">
        Undated counts only tasks created since {fmt(data.activeSince)} (matches the dashboard&apos;s Unplanned).
      </p>

      {data.people.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
          <RiInboxLine className="size-4" /> No people in this scope.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {data.people.map((p) => (
            <PersonRow key={p.email} person={p} mode={data.mode} from={data.duration?.from} />
          ))}
        </div>
      )}
    </div>
  );
}

function PersonRow({
  person,
  mode,
  from,
}: {
  person: PersonAvailability;
  mode: AvailabilityMode;
  from?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasConflicts = (person.conflicts?.length ?? 0) > 0;

  return (
    <div className="border-b border-border/60 last:border-0">
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-2.5",
          mode === "range" && hasConflicts && "cursor-pointer hover:bg-muted/30"
        )}
        onClick={() => mode === "range" && hasConflicts && setOpen((o) => !o)}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{person.name}</p>
          <p className="truncate text-xs text-muted-foreground">{person.email}</p>
        </div>

        {person.undated > 0 && (
          <Tip text={`${person.undated} open task${person.undated === 1 ? "" : "s"} with no start/due date. They can't overlap a window, so this person may be busier than "Free" suggests.`}>
            <Badge variant="outline" className="shrink-0">
              {person.undated} undated
            </Badge>
          </Tip>
        )}

        {mode === "range" ? (
          person.free ? (
            <Tip text="No open dated task overlaps the selected window — clear to take on work.">
              <Badge className="shrink-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Free</Badge>
            </Tip>
          ) : (
            <span className="flex shrink-0 items-center gap-1.5">
              <Tip text="Number of open tasks scheduled during this window. Click the row to see them.">
                <Badge variant="destructive">{person.conflicts!.length} conflict{person.conflicts!.length === 1 ? "" : "s"}</Badge>
              </Tip>
              <RiArrowDownSLine className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
            </span>
          )
        ) : (
          <DurationBadge person={person} from={from} />
        )}
      </div>

      {mode === "range" && open && hasConflicts && (
        <div className="space-y-1 bg-muted/20 px-4 py-2">
          {person.conflicts!.map((c) => (
            <a
              key={c.jiraKey}
              href={c.jiraUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 text-xs"
            >
              <span className="font-mono font-medium text-primary group-hover:underline">{c.jiraKey}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.summary}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground/80">
                {fmt(c.start)} – {fmt(c.due)}
              </span>
              <RiExternalLinkLine className="size-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function DurationBadge({ person, from }: { person: PersonAvailability; from?: string }) {
  if (person.freeNow) {
    return (
      <Tip text="Free for the whole task length starting on the earliest start date — available right away.">
        <Badge className="shrink-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Free now</Badge>
      </Tip>
    );
  }
  if (person.nextFreeFrom) {
    return (
      <Tip text="The start of this person's next free gap long enough for the task.">
        <Badge className="shrink-0 bg-amber-500/15 text-amber-700 dark:text-amber-400">
          Free from {fmt(person.nextFreeFrom)}
        </Badge>
      </Tip>
    );
  }
  return (
    <Tip text="No free gap of the required length within the search horizon — fully booked for that period.">
      <Badge variant="outline" className="shrink-0 text-muted-foreground">
        {from ? "No slot in horizon" : "No slot"}
      </Badge>
    </Tip>
  );
}

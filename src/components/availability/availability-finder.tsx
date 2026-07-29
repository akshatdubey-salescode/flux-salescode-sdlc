"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  RiExternalLinkLine,
  RiArrowDownSLine,
  RiCalendarCheckLine,
  RiInboxLine,
  RiErrorWarningLine,
  RiSearchLine,
  RiCloseLine,
  RiEqualizerLine,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type {
  AvailabilityResponse,
  PersonAvailability,
  AvailabilityScope,
  AvailabilityMode,
} from "@/app/api/analytics/availability/route";
import { DelayLogButton } from "@/components/delay-tracker/delay-log-button";
import { DeliveryBadge } from "@/components/delivery-tracker/delivery-badge";
import { TeamTreeSelect, collectSubtreeEmails } from "@/components/availability/team-tree-select";
import type { TeamTreeNode } from "@/lib/keka/directory";
import type { TeamTreeResponse } from "@/app/api/keka/team-tree/route";

type Props = {
  projects: { id: string; name: string }[];
  boards: { id: string; name: string; managerEmail: string | null }[];
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

  const [scope, setScope] = useState<AvailabilityScope>("global");
  const [projectId, setProjectId] = useState("");
  const [boardId, setBoardId] = useState("");
  const [emails, setEmails] = useState<string[]>([]);

  // Team tab: the board dropdown above stays the entry point, but who
  // actually gets queried is resolved from that board manager's full Keka
  // org subtree (every direct/indirect report), not the board's own flat
  // member list — see team-tree-select.tsx.
  const [teamTree, setTeamTree] = useState<TeamTreeNode | null>(null);
  // false ⇒ the board's manager isn't a current Keka employee; fall back to
  // the board's own member list exactly as before this feature existed.
  const [teamTreeFound, setTeamTreeFound] = useState(true);
  const [teamTreeLoading, setTeamTreeLoading] = useState(false);
  const [teamChecked, setTeamChecked] = useState<Set<string>>(new Set());
  const [teamCascade, setTeamCascade] = useState(true);
  const teamTreeReqId = useRef(0);

  const [mode, setMode] = useState<AvailabilityMode>("duration");
  const [start, setStart] = useState(t);
  const [end, setEnd] = useState(offset(t, 6));
  const [duration, setDuration] = useState(1);
  const [from, setFrom] = useState(t);
  const [horizon, setHorizon] = useState(60);
  const [activeSince, setActiveSince] = useState(fiscalAprilFirst());

  // The finder starts minimised: the default Global view auto-loads, so the
  // user lands on results and only opens the controls when they want to change
  // the search. Opens on demand, collapses again once a search is fired.
  const [expanded, setExpanded] = useState(false);

  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [error, setError] = useState(false);
  // Starts true: the default Global view auto-loads on mount, so we want the
  // skeleton on first paint rather than a one-frame empty flash.
  const [loading, setLoading] = useState(true);
  // Monotonic id of the latest in-flight request. A response is applied only if
  // it is still the latest, so a slow auto-loaded Global fetch can't leak its
  // result into a scope the user has since switched away from.
  const reqId = useRef(0);

  // Fetch the selected board's manager's Keka subtree whenever the board
  // changes. A monotonic request id (mirroring run()'s reqId) stops a slow
  // fetch for a previously-selected board from clobbering the tree for the
  // board the user has since switched to.
  useEffect(() => {
    const board = boards.find((b) => b.id === boardId);
    if (!board) {
      setTeamTree(null);
      setTeamTreeFound(true);
      setTeamChecked(new Set());
      return;
    }
    const myId = ++teamTreeReqId.current;
    setTeamTreeLoading(true);
    fetch(`/api/keka/team-tree?rootEmail=${encodeURIComponent(board.managerEmail ?? "")}`)
      .then((r) => r.json())
      .then((d: TeamTreeResponse) => {
        if (teamTreeReqId.current !== myId) return;
        if (d.found) {
          setTeamTree(d.root);
          setTeamTreeFound(true);
          // Default to the whole subtree checked — this is what makes
          // "select the entire team" the zero-effort default.
          setTeamChecked(new Set(collectSubtreeEmails(d.root)));
        } else {
          setTeamTree(null);
          setTeamTreeFound(false);
          setTeamChecked(new Set());
        }
      })
      .catch(() => {
        if (teamTreeReqId.current !== myId) return;
        setTeamTree(null);
        setTeamTreeFound(false);
        setTeamChecked(new Set());
      })
      .finally(() => {
        if (teamTreeReqId.current === myId) setTeamTreeLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boards is stable server-fetched data, re-running on it would refetch every render
  }, [boardId]);

  const peopleOptions = people.map((p) => ({ value: p.email, label: `${p.name} · ${p.email}` }));

  const canRun =
    scope === "global" ||
    (scope === "project" && !!projectId) ||
    (scope === "team" && (teamTreeFound ? teamChecked.size > 0 : !!boardId)) ||
    (scope === "people" && emails.length > 0);

  // One-line description of the current search, shown on the collapsed bar so
  // the user can see what's configured without opening the controls.
  const scopeSummary =
    scope === "global"
      ? `All ${people.length} people`
      : scope === "project"
      ? projects.find((p) => p.id === projectId)?.name ?? "Pick a project"
      : scope === "team"
      ? !boardId
        ? "Pick a team"
        : teamTreeFound
        ? `${teamChecked.size} of ${teamTree ? collectSubtreeEmails(teamTree).length : 0} people`
        : boards.find((b) => b.id === boardId)?.name ?? "Pick a team"
      : emails.length > 0
      ? `${emails.length} ${emails.length === 1 ? "person" : "people"}`
      : "Pick people";
  const modeSummary =
    mode === "range"
      ? `free ${fmt(start)} – ${fmt(end)}`
      : `free for ${duration} ${duration === 1 ? "day" : "days"}`;

  function run() {
    if (!canRun) return;
    // Fold the controls away so the results take focus once a search fires.
    setExpanded(false);
    const myId = ++reqId.current;
    setLoading(true);
    setError(false);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const nowStr = `${todayStr()}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const params = new URLSearchParams({ now: nowStr, scope, mode });
    if (scope === "project") params.set("projectId", projectId);
    if (scope === "team") {
      params.set("boardId", boardId);
      if (teamTreeFound) params.set("emails", [...teamChecked].join(","));
    }
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
      .then((d: AvailabilityResponse) => {
        if (reqId.current === myId) setData(d);
      })
      .catch(() => {
        if (reqId.current === myId) {
          setData(null);
          setError(true);
        }
      })
      .finally(() => {
        if (reqId.current === myId) setLoading(false);
      });
  }

  // Clear results and invalidate any in-flight request. Used when the user
  // changes scope/mode so a superseded fetch can't land stale results and the
  // skeleton doesn't linger for a request that was never re-started.
  function clearResults() {
    reqId.current++;
    setData(null);
    setError(false);
    setLoading(false);
  }

  // Auto-load the default Global view once when the page opens, so the user
  // sees everyone's next free date without picking a scope or clicking the
  // button. canRun is always true for the global scope, so this fires with no
  // user input. The ref guard stops React StrictMode from double-fetching in
  // dev; subsequent searches with other scopes still go through the button.
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (didAutoRun.current) return;
    didAutoRun.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-5">
      <Card className="gap-0 py-0">
        {/* Collapsed bar — summarises the current search and toggles the
            controls open. Always visible so the finder can be re-opened. */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        >
          <RiEqualizerLine className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="text-sm font-medium text-foreground">
              {expanded ? "Find availability" : scopeSummary}
            </span>
            {!expanded && (
              <span className="ml-2 text-xs text-muted-foreground">{modeSummary}</span>
            )}
          </span>
          {!expanded && (
            <span className="shrink-0 text-xs text-muted-foreground">Change search</span>
          )}
          <RiArrowDownSLine
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180"
            )}
          />
        </button>

        {expanded && (
        <CardContent className="space-y-4 border-t border-border p-4">
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
                      clearResults();
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
            <div className="space-y-2.5">
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

              {boardId && teamTreeLoading && (
                <Skeleton className="h-16 w-full sm:w-80" />
              )}
              {boardId && !teamTreeLoading && !teamTreeFound && (
                <p className="text-xs text-muted-foreground">
                  This board&rsquo;s manager isn&rsquo;t a current Keka employee — using the board&rsquo;s listed members instead.
                </p>
              )}
              {boardId && !teamTreeLoading && teamTree && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Switch checked={teamCascade} onCheckedChange={setTeamCascade} />
                    <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Selecting a person also selects everyone under them
                      <ChartInfo description="On: checking/unchecking anyone in the tree does the same to everyone below them. Off: checking/unchecking a person only affects that individual — their reports keep whatever selection they already had." />
                    </Label>
                  </div>
                  <TeamTreeSelect
                    root={teamTree}
                    checked={teamChecked}
                    onCheckedChange={setTeamChecked}
                    cascade={teamCascade}
                  />
                </div>
              )}
            </div>
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
              <ChartInfo description="Specific date range → for an exact window you have in mind, see who is completely free during it. Free for N days → you only know the task takes N days; the tool finds each person's next free slot of that length, soonest first. Weekends (Sat/Sun) are skipped — only working days count, so a free-from date is always a weekday." />
            </Label>
            <div className="flex items-center gap-1.5">
              {(["range", "duration"] as AvailabilityMode[]).map((m) => (
                <Tip
                  key={m}
                  text={
                    m === "range"
                      ? "Check a fixed window (From–To): who has no overlapping task during it."
                      : "Give a task length in working days: find each person's next free gap of that many consecutive working days. Weekends are skipped."
                  }
                >
                  <button
                    onClick={() => {
                      setMode(m);
                      clearResults();
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
                <NumField label="Days needed" value={duration} onChange={setDuration} min={1} className="w-28" info="How many consecutive free working days the task needs. Weekends (Sat/Sun) are skipped." />
                <DateField label="Earliest start" value={from} onChange={setFrom} info="Don't look for slots before this date (defaults to today)." />
                <NumField label="Search horizon (days)" value={horizon} onChange={setHorizon} min={1} max={365} className="w-40" info="How far ahead (calendar days, max 365) to search for a free slot before giving up." />
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
        )}
      </Card>

      {loading && !data ? (
        <AvailabilityLoading />
      ) : error ? (
        <AvailabilityError onRetry={run} />
      ) : data ? (
        <Results data={data} loading={loading} />
      ) : null}
    </div>
    </TooltipProvider>
  );
}

function AvailabilityLoading() {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-0"
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-5 w-24 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AvailabilityError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
      <RiErrorWarningLine className="size-5 text-destructive" />
      <p className="text-sm text-muted-foreground">
        Couldn&rsquo;t load availability. Please try again.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
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
  max,
  className,
  info,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
  info?: string;
}) {
  return (
    <div className="space-y-1">
      <FieldLabel label={label} info={info} />
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) =>
          onChange(
            Math.min(
              max ?? Infinity,
              Math.max(min ?? 0, parseInt(e.target.value, 10) || 0)
            )
          )
        }
        className={className}
      />
    </div>
  );
}

function Results({ data, loading }: { data: AvailabilityResponse; loading: boolean }) {
  // Client-side filter over whichever people are in the current result — most
  // useful for the default org-wide view. Matches name or email, case-insensitive.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q
    ? data.people.filter(
        (p) =>
          p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
      )
    : data.people;

  // Count over the visible set so the header agrees with the rows shown.
  const freeCount =
    data.mode === "range"
      ? visible.filter((p) => p.free).length
      : visible.filter((p) => p.freeNow).length;

  return (
    <div className={cn("space-y-2", loading && "opacity-50")}>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {data.mode === "range"
            ? `Free ${data.range ? `${fmt(data.range.start)} – ${fmt(data.range.end)}` : ""}`
            : data.duration?.days === 1
            ? "Next free date"
            : `Next free ${data.duration?.days}-day slot`}
          <ChartInfo
            description={
              data.mode === "range"
                ? "People free for the whole window are listed first. 'Free' means no open task with a start–due date overlaps it. Click a busy row to see the clashing tasks."
                : "Sorted by who is free soonest. 'Free now' = available from the earliest working day; 'Free from' = the next weekday their required-length slot begins. Weekends (Sat/Sun) are skipped."
            }
          />
        </h2>
        <span className="text-xs text-muted-foreground">
          {freeCount} of {visible.length}{" "}
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
        <>
          <div className="relative">
            <RiSearchLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people by name or email…"
              className="pl-9 pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                <RiCloseLine className="size-4" />
              </button>
            )}
          </div>
          {visible.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
              <RiInboxLine className="size-4" /> No people match &ldquo;{query.trim()}&rdquo;.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              {visible.map((p) => (
                <PersonRow key={p.email} person={p} mode={data.mode} from={data.duration?.from} />
              ))}
            </div>
          )}
        </>
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
            <div key={c.id} className="group flex items-center gap-2 text-xs">
              <a
                href={c.jiraUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <span className="font-mono font-medium text-primary group-hover:underline">{c.jiraKey}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.summary}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground/80">
                  {fmt(c.start)} – {fmt(c.due)}
                </span>
                <RiExternalLinkLine className="size-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground" />
              </a>
              <DelayLogButton issueId={c.id} />
              <DeliveryBadge issueId={c.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DurationBadge({ person, from }: { person: PersonAvailability; from?: string }) {
  if (person.freeNow) {
    return (
      <Tip text="Free for the whole task length starting on the earliest available working day — available right away.">
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

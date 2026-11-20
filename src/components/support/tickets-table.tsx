"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { RiCalendarLine, RiHistoryLine, RiRefreshLine, RiSearchLine } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDuration, salescodeMinutes } from "@/lib/support/time";
import {
  CATEGORY_LABELS,
  PRIORITIES,
  SUPPORT_CATEGORIES,
  type OfficeHours,
  type OwnerSide,
  type Priority,
  type SupportCategory,
} from "@/lib/support/types";
import {
  OwnershipDialog,
  SIDE_LABELS,
  formatIstDateTime,
  fromLocalInputValue,
  toLocalInputValue,
} from "./ownership-dialog";

/** SupportTicketRow as it arrives over JSON (dates are ISO strings). */
export type SupportTicketDto = {
  issueId: string;
  jiraKey: string;
  summary: string;
  priority: Priority;
  category: SupportCategory | null;
  createdAt: string;
  resolvedAt: string | null;
  firstRespondedAt: string | null;
  rcaGiven: boolean;
  usersReported: number | null;
  usersImpacted: number | null;
  eta: string | null;
  events: { side: OwnerSide; at: string }[];
  status: string;
  issueType: string;
  ownerSide: OwnerSide;
  storedCategory: SupportCategory | null;
  fluxEta: string | null;
  jiraDueDate: string | null;
};

type TicketsResponse = {
  tickets: SupportTicketDto[];
  settings: { supportLabel: string; enabled: boolean; officeHours: OfficeHours };
  jiraBaseUrl: string | null;
};

type TicketPatch = Partial<{
  category: SupportCategory;
  firstRespondedAt: string | null;
  usersReported: number | null;
  usersImpacted: number | null;
  eta: string | null;
}>;

type StatusFilter = "open" | "closed" | "all";
const UNCATEGORISED = "__uncategorised";
const ALL = "__all";

const PRIORITY_BADGE: Record<Priority, string> = {
  P1: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  P2: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  P3: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  P4: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const FIELD_LABELS: Record<keyof TicketPatch, string> = {
  category: "Category",
  firstRespondedAt: "First response",
  usersReported: "Users reported",
  usersImpacted: "Users impacted",
  eta: "ETA",
};

const TH = "px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap text-zinc-500";
const TD = "px-3 py-2 align-middle";

function formatYmd(ymd: string): string {
  return format(parseISO(ymd), "dd MMM yyyy");
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

type DialogTarget = { issueId: string; jiraKey: string; side: OwnerSide | null; nonce: number };

export function TicketsTable({ projectId }: { projectId: string }) {
  const [data, setData] = useState<TicketsResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // "Now" for open tickets' Salescode time; ticks every minute.
  const [now, setNow] = useState(() => new Date());

  const [status, setStatus] = useState<StatusFilter>("open");
  const [category, setCategory] = useState<string>(ALL);
  const [priority, setPriority] = useState<string>(ALL);
  const [search, setSearch] = useState("");

  const [dialogTarget, setDialogTarget] = useState<DialogTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const url = `/api/projects/${projectId}/support/tickets`;

  const fetchTickets = useCallback(async (): Promise<TicketsResponse> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as TicketsResponse;
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    fetchTickets()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoadError(false);
        setNow(new Date());
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchTickets]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await fetchTickets();
      setData(d);
      setLoadError(false);
      setNow(new Date());
    } catch {
      toast.error("Failed to refresh tickets");
    } finally {
      setRefreshing(false);
    }
  }, [fetchTickets]);

  function updateRow(issueId: string, fn: (t: SupportTicketDto) => SupportTicketDto) {
    setData((prev) =>
      prev ? { ...prev, tickets: prev.tickets.map((t) => (t.issueId === issueId ? fn(t) : t)) } : prev,
    );
  }

  /** Optimistic single-field save: apply locally, PATCH, roll back on failure. */
  async function save(row: SupportTicketDto, patch: TicketPatch, optimistic: Partial<SupportTicketDto>) {
    const keys = Object.keys(optimistic) as (keyof SupportTicketDto)[];
    const snapshot: Partial<SupportTicketDto> = {};
    for (const k of keys) (snapshot as Record<string, unknown>)[k] = row[k];
    const label = FIELD_LABELS[Object.keys(patch)[0] as keyof TicketPatch];

    updateRow(row.issueId, (t) => ({ ...t, ...optimistic }));
    try {
      const res = await fetch(`${url}/${row.issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `HTTP ${res.status}`));
      toast.success(`${row.jiraKey}: ${label} saved`);
    } catch (e) {
      updateRow(row.issueId, (t) => ({ ...t, ...snapshot }));
      toast.error(`${row.jiraKey}: couldn't save ${label.toLowerCase()}`, {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  function openOwnership(row: SupportTicketDto, side: OwnerSide | null) {
    setDialogTarget({ issueId: row.issueId, jiraKey: row.jiraKey, side, nonce: Date.now() });
    setDialogOpen(true);
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.tickets.filter((t) => {
      if (status === "open" && t.resolvedAt !== null) return false;
      if (status === "closed" && t.resolvedAt === null) return false;
      if (category === UNCATEGORISED ? t.category !== null : category !== ALL && t.category !== category)
        return false;
      if (priority !== ALL && t.priority !== priority) return false;
      if (q && !t.jiraKey.toLowerCase().includes(q) && !t.summary.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, status, category, priority, search]);

  const salescodeTime = useMemo(() => {
    const out = new Map<string, number>();
    if (!data) return out;
    for (const t of data.tickets) {
      const end = t.resolvedAt ? new Date(t.resolvedAt) : now;
      const events = t.events.map((e) => ({ side: e.side, at: new Date(e.at) }));
      out.set(t.issueId, salescodeMinutes(new Date(t.createdAt), end, events, data.settings.officeHours));
    }
    return out;
  }, [data, now]);

  if (loadError && !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-sm text-zinc-500">
        Couldn&apos;t load support tickets.
        <Button variant="outline" size="sm" onClick={reload} disabled={refreshing}>
          Try again
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const label = data.settings.supportLabel;

  if (data.tickets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 py-12 text-center text-sm text-zinc-500 dark:border-zinc-800">
        No Jira tickets carry the <span className="font-mono text-zinc-700 dark:text-zinc-300">{label}</span>{" "}
        label yet.
      </div>
    );
  }

  const uncategorisedCount = data.tickets.filter((t) => t.category === null).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-28" aria-label="Status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-40" aria-label="Category filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            <SelectItem value={UNCATEGORISED}>Uncategorised ({uncategorisedCount})</SelectItem>
            {SUPPORT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-32" aria-label="Priority filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All priorities</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative">
          <RiSearchLine className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search key or summary…"
            className="h-7 w-60 pl-8 text-xs"
          />
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          <span>
            {filtered.length} of {data.tickets.length} labelled{" "}
            <span className="font-mono">{label}</span>
          </span>
          <Button variant="ghost" size="icon-sm" onClick={reload} disabled={refreshing} aria-label="Refresh">
            <RiRefreshLine className={cn(refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <th className={TH}>Key</th>
              <th className={TH}>Summary</th>
              <th className={TH}>Jira status</th>
              <th className={TH}>Priority</th>
              <th className={TH}>Created (IST)</th>
              <th className={TH}>Category</th>
              <th className={TH}>On</th>
              <th className={TH}>First response</th>
              <th className={TH}>Users reported</th>
              <th className={TH}>Users impacted</th>
              <th className={TH}>ETA</th>
              <th className={TH}>Salescode time (office hrs)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-sm text-zinc-400">
                  No tickets match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.issueId} className="bg-white dark:bg-zinc-950">
                  <td className={cn(TD, "font-mono text-xs whitespace-nowrap")}>
                    {data.jiraBaseUrl ? (
                      <a
                        href={`${data.jiraBaseUrl}/browse/${t.jiraKey}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {t.jiraKey}
                      </a>
                    ) : (
                      t.jiraKey
                    )}
                  </td>
                  <td className={cn(TD, "max-w-xs")}>
                    <span className="line-clamp-2 text-zinc-700 dark:text-zinc-300" title={t.summary}>
                      {t.summary}
                    </span>
                  </td>
                  <td className={cn(TD, "text-xs whitespace-nowrap text-zinc-500")}>{t.status}</td>
                  <td className={TD}>
                    <Badge className={PRIORITY_BADGE[t.priority]}>{t.priority}</Badge>
                  </td>
                  <td className={cn(TD, "text-xs whitespace-nowrap text-zinc-500")}>
                    {formatIstDateTime(t.createdAt)}
                  </td>
                  <td className={TD}>
                    <Select
                      value={t.category ?? ""}
                      onValueChange={(v) => {
                        const c = v as SupportCategory;
                        if (c === t.category) return;
                        save(t, { category: c }, { category: c, storedCategory: c });
                      }}
                    >
                      <SelectTrigger
                        aria-label={`Category for ${t.jiraKey}`}
                        className={cn(
                          "w-36",
                          t.category === null &&
                            "border-amber-400 data-placeholder:text-amber-600 dark:border-amber-600 dark:data-placeholder:text-amber-400",
                        )}
                      >
                        <SelectValue placeholder="Uncategorised" />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORT_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CATEGORY_LABELS[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <Switch
                        checked={t.ownerSide === "salescode"}
                        onCheckedChange={(checked) => openOwnership(t, checked ? "salescode" : "client")}
                        aria-label={`Owner of ${t.jiraKey}`}
                      />
                      <span className="w-16 text-xs text-zinc-600 dark:text-zinc-400">
                        {SIDE_LABELS[t.ownerSide]}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => openOwnership(t, null)}
                            aria-label={`Ownership history for ${t.jiraKey}`}
                          >
                            <RiHistoryLine />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Ownership history</TooltipContent>
                      </Tooltip>
                    </div>
                  </td>
                  <td className={TD}>
                    <FirstResponseCell
                      key={`${t.issueId}:${t.firstRespondedAt ?? ""}`}
                      value={t.firstRespondedAt}
                      onCommit={(iso) => save(t, { firstRespondedAt: iso }, { firstRespondedAt: iso })}
                    />
                  </td>
                  <td className={TD}>
                    <NumberCell
                      key={`${t.issueId}:${t.usersReported ?? ""}`}
                      value={t.usersReported}
                      label={`Users reported for ${t.jiraKey}`}
                      onCommit={(n) => save(t, { usersReported: n }, { usersReported: n })}
                    />
                  </td>
                  <td className={TD}>
                    <NumberCell
                      key={`${t.issueId}:${t.usersImpacted ?? ""}`}
                      value={t.usersImpacted}
                      label={`Users impacted for ${t.jiraKey}`}
                      onCommit={(n) => save(t, { usersImpacted: n }, { usersImpacted: n })}
                    />
                  </td>
                  <td className={TD}>
                    <EtaCell
                      fluxEta={t.fluxEta}
                      jiraDueDate={t.jiraDueDate}
                      onCommit={(ymd) =>
                        save(t, { eta: ymd }, { fluxEta: ymd, eta: ymd ?? t.jiraDueDate })
                      }
                    />
                  </td>
                  <td className={cn(TD, "text-xs whitespace-nowrap text-zinc-600 dark:text-zinc-400")}>
                    {formatDuration(salescodeTime.get(t.issueId) ?? null)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {dialogTarget && (
        <OwnershipDialog
          key={dialogTarget.nonce}
          projectId={projectId}
          issueId={dialogTarget.issueId}
          jiraKey={dialogTarget.jiraKey}
          initialSide={dialogTarget.side}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onChanged={reload}
        />
      )}
    </div>
  );
}

/** Non-negative integer input; commits on blur or Enter, Escape reverts. */
function NumberCell({
  value,
  label,
  onCommit,
}: {
  value: number | null;
  label: string;
  onCommit: (n: number | null) => void;
}) {
  const initial = value === null ? "" : String(value);
  const [draft, setDraft] = useState(initial);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === initial) return;
    if (trimmed === "") {
      onCommit(null);
      return;
    }
    const n = Number(trimmed);
    if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(n)) {
      toast.error("Enter a whole number, 0 or more");
      setDraft(initial);
      return;
    }
    onCommit(n);
  }

  return (
    <Input
      // text + numeric keypad: type="number" reports "" for junk like "1e",
      // which would silently clear the stored value on blur.
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(initial);
      }}
      className="h-7 w-20 text-xs"
      placeholder="—"
    />
  );
}

/** datetime-local in browser time; commits ISO (or null when cleared) on blur or Enter. */
function FirstResponseCell({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (iso: string | null) => void;
}) {
  const initial = value ? toLocalInputValue(new Date(value)) : "";
  const [draft, setDraft] = useState(initial);

  function commit(el: HTMLInputElement) {
    // A half-filled datetime-local reads as "" with badInput set; don't treat it as a clear.
    if (el.validity.badInput) {
      toast.error("Enter a complete date and time");
      setDraft(initial);
      return;
    }
    if (draft === initial) return;
    if (draft === "") {
      onCommit(null);
      return;
    }
    const d = fromLocalInputValue(draft);
    if (!d) {
      toast.error("Enter a valid date and time");
      setDraft(initial);
      return;
    }
    onCommit(d.toISOString());
  }

  return (
    <Input
      type="datetime-local"
      aria-label="First response"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(initial);
      }}
      className="h-7 w-44 text-xs"
    />
  );
}

/** Flux ETA picker; shows the Jira due date (muted) when no Flux ETA is set. */
function EtaCell({
  fluxEta,
  jiraDueDate,
  onCommit,
}: {
  fluxEta: string | null;
  jiraDueDate: string | null;
  onCommit: (ymd: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-32 justify-start font-normal">
          <RiCalendarLine />
          {fluxEta ? (
            formatYmd(fluxEta)
          ) : jiraDueDate ? (
            <span className="text-muted-foreground" title="Jira due date">
              {formatYmd(jiraDueDate)}
            </span>
          ) : (
            <span className="text-muted-foreground">Set ETA</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={fluxEta ? parseISO(fluxEta) : undefined}
          defaultMonth={fluxEta ? parseISO(fluxEta) : jiraDueDate ? parseISO(jiraDueDate) : undefined}
          onSelect={(d) => {
            setOpen(false);
            if (!d) return;
            const ymd = format(d, "yyyy-MM-dd");
            if (ymd !== fluxEta) onCommit(ymd);
          }}
        />
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
          <span className="text-[11px] text-muted-foreground">
            {jiraDueDate ? `Jira due: ${formatYmd(jiraDueDate)}` : "No Jira due date"}
          </span>
          <Button
            variant="ghost"
            size="xs"
            disabled={!fluxEta}
            onClick={() => {
              setOpen(false);
              onCommit(null);
            }}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { useEffect, useState, useTransition, useMemo } from "react";
import {
  RiRefreshLine,
  RiExternalLinkLine,
  RiAlertLine,
  RiCheckLine,
  RiTimeLine,
  RiSearchLine,
  RiFilterLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import type { FreshdeskTicket } from "@/lib/db/schema";

// ─── helpers ────────────────────────────────────────────────────────────────

function statusColor(status: number) {
  if (status === 2) return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
  if (status === 3) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
  if (status === 4) return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
  if (status === 5) return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  if (status === 6) return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";
  if (status === 7) return "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300";
  return "bg-zinc-100 text-zinc-500";
}

function priorityColor(priority: number) {
  if (priority === 4) return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  if (priority === 3) return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";
  if (priority === 2) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
  return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
}

function jiraStatusColor(status: string | null) {
  if (!status) return "bg-zinc-100 text-zinc-500";
  const s = status.toLowerCase();
  if (s.includes("done") || s.includes("closed") || s.includes("resolved")) return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
  if (s.includes("progress")) return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
  if (s.includes("review") || s.includes("qa")) return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";
  if (s.includes("block")) return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
}

function daysOpen(createdAt: string | null): number {
  if (!createdAt) return 0;
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
}

function isSlaAtRisk(ticket: FreshdeskTicket): boolean {
  if (!ticket.dueBy) return false;
  const msLeft = new Date(ticket.dueBy).getTime() - Date.now();
  return msLeft > 0 && msLeft < 4 * 60 * 60 * 1000;
}

function isSlaBreach(ticket: FreshdeskTicket): boolean {
  if (!ticket.dueBy) return false;
  return new Date(ticket.dueBy).getTime() < Date.now() && ticket.fdStatus !== 4 && ticket.fdStatus !== 5;
}

// ─── summary cards ───────────────────────────────────────────────────────────

function SummaryCards({ tickets }: { tickets: FreshdeskTicket[] }) {
  const open = tickets.filter((t) => t.fdStatus === 2).length;
  const unlinked = tickets.filter((t) => !t.linkedJiraKey && t.fdStatus !== 4 && t.fdStatus !== 5).length;
  const breached = tickets.filter(isSlaBreach).length;
  const resolved = tickets.filter((t) => t.fdStatus === 4 || t.fdStatus === 5).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
      <StatCard label="Open" value={open} color="text-blue-600 dark:text-blue-400" />
      <StatCard label="Unlinked to Jira" value={unlinked} color={unlinked > 0 ? "text-orange-600 dark:text-orange-400" : "text-zinc-500"} />
      <StatCard label="SLA Breached" value={breached} color={breached > 0 ? "text-red-600 dark:text-red-400" : "text-zinc-500"} />
      <StatCard label="Resolved" value={resolved} color="text-green-600 dark:text-green-400" />
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

// ─── filter bar ──────────────────────────────────────────────────────────────

type SortKey = "newest" | "oldest" | "priority" | "days";
type JiraLinkFilter = "all" | "linked" | "unlinked";
type SlaFilter = "all" | "breached" | "at_risk";

interface Filters {
  search: string;
  fdStatus: string;   // "" = all, or stringified status number
  priority: string;   // "" = all, or stringified priority number
  jiraLink: JiraLinkFilter;
  sla: SlaFilter;
  sort: SortKey;
}

const FD_STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "2", label: "Open" },
  { value: "3", label: "Pending" },
  { value: "6", label: "Waiting on Customer" },
  { value: "7", label: "Waiting on Third Party" },
  { value: "4", label: "Resolved" },
  { value: "5", label: "Closed" },
];

const PRIORITY_OPTIONS = [
  { value: "", label: "All Priorities" },
  { value: "4", label: "Urgent" },
  { value: "3", label: "High" },
  { value: "2", label: "Medium" },
  { value: "1", label: "Low" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "priority", label: "Priority: high → low" },
  { value: "days", label: "Days open: most → least" },
];

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function FilterBar({
  filters,
  onChange,
  filteredCount,
  totalCount,
}: {
  filters: Filters;
  onChange: (f: Partial<Filters>) => void;
  filteredCount: number;
  totalCount: number;
}) {
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <RiSearchLine className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search subject or ticket ID…"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-7 pr-3 text-xs text-zinc-700 shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          />
        </div>

        {/* FD Status */}
        <Select
          value={filters.fdStatus}
          onChange={(v) => onChange({ fdStatus: v })}
          options={FD_STATUS_OPTIONS}
        />

        {/* Priority */}
        <Select
          value={filters.priority}
          onChange={(v) => onChange({ priority: v })}
          options={PRIORITY_OPTIONS}
        />

        {/* Jira Link */}
        <Select
          value={filters.jiraLink}
          onChange={(v) => onChange({ jiraLink: v as JiraLinkFilter })}
          options={[
            { value: "all", label: "All tickets" },
            { value: "linked", label: "Linked to Jira" },
            { value: "unlinked", label: "Not linked" },
          ]}
        />

        {/* SLA */}
        <Select
          value={filters.sla}
          onChange={(v) => onChange({ sla: v as SlaFilter })}
          options={[
            { value: "all", label: "All SLA" },
            { value: "breached", label: "SLA Breached" },
            { value: "at_risk", label: "SLA At Risk" },
          ]}
        />

        {/* Sort */}
        <Select
          value={filters.sort}
          onChange={(v) => onChange({ sort: v as SortKey })}
          options={SORT_OPTIONS}
        />

        {/* Clear */}
        {(filters.search || filters.fdStatus || filters.priority || filters.jiraLink !== "all" || filters.sla !== "all" || filters.sort !== "newest") && (
          <button
            onClick={() => onChange({ search: "", fdStatus: "", priority: "", jiraLink: "all", sla: "all", sort: "newest" })}
            className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Clear
          </button>
        )}
      </div>

      {/* Result count */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{filteredCount}</span>
        {filteredCount !== totalCount && (
          <> of {totalCount}</>
        )}{" "}
        ticket{filteredCount !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function ClientIssuesTab({ projectId }: { projectId: string }) {
  const [tickets, setTickets] = useState<FreshdeskTicket[]>([]);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, startSync] = useTransition();
  const [syncResult, setSyncResult] = useState<{ synced: number; linked: number } | null>(null);

  const [filters, setFilters] = useState<Filters>({
    search: "",
    fdStatus: "",
    priority: "",
    jiraLink: "all",
    sla: "all",
    sort: "newest",
  });

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/freshdesk/tickets/${projectId}`);
    if (res.ok) {
      const data = await res.json();
      setTickets(data.tickets ?? []);
      setJiraBaseUrl(data.jiraBaseUrl ?? null);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [projectId]);

  function handleSync() {
    startSync(async () => {
      setSyncResult(null);
      const res = await fetch(`/api/freshdesk/sync/${projectId}`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setSyncResult(data);
        await load();
      }
    });
  }

  function updateFilter(partial: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...partial }));
  }

  const filtered = useMemo(() => {
    let result = [...tickets];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (t) =>
          t.subject?.toLowerCase().includes(q) ||
          String(t.fdTicketId).includes(q)
      );
    }

    if (filters.fdStatus) {
      const s = parseInt(filters.fdStatus, 10);
      result = result.filter((t) => t.fdStatus === s);
    }

    if (filters.priority) {
      const p = parseInt(filters.priority, 10);
      result = result.filter((t) => t.fdPriority === p);
    }

    if (filters.jiraLink === "linked") {
      result = result.filter((t) => !!t.linkedJiraKey);
    } else if (filters.jiraLink === "unlinked") {
      result = result.filter((t) => !t.linkedJiraKey);
    }

    if (filters.sla === "breached") {
      result = result.filter(isSlaBreach);
    } else if (filters.sla === "at_risk") {
      result = result.filter(isSlaAtRisk);
    }

    result.sort((a, b) => {
      if (filters.sort === "oldest") {
        return new Date(a.fdCreatedAt!).getTime() - new Date(b.fdCreatedAt!).getTime();
      }
      if (filters.sort === "priority") {
        return (b.fdPriority ?? 0) - (a.fdPriority ?? 0);
      }
      if (filters.sort === "days") {
        return daysOpen(a.fdCreatedAt ? String(a.fdCreatedAt) : null) > daysOpen(b.fdCreatedAt ? String(b.fdCreatedAt) : null) ? -1 : 1;
      }
      // newest
      return new Date(b.fdCreatedAt!).getTime() - new Date(a.fdCreatedAt!).getTime();
    });

    return result;
  }, [tickets, filters]);

  const fdBaseUrl = process.env.NEXT_PUBLIC_FRESHDESK_BASE_URL;

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Client Issues</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Freshdesk tickets from CavinKare linked to Jira
          </p>
        </div>
        <div className="flex items-center gap-2">
          {syncResult && (
            <span className="text-xs text-zinc-500">
              {syncResult.synced} synced · {syncResult.linked} linked
            </span>
          )}
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RiRefreshLine className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </div>

      <SummaryCards tickets={tickets} />

      {tickets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 p-12 text-center dark:border-zinc-800">
          <p className="text-sm text-zinc-400">No tickets synced yet. Click "Sync now" to pull CavinKare tickets from Freshdesk.</p>
        </div>
      ) : (
        <>
          <FilterBar
            filters={filters}
            onChange={updateFilter}
            filteredCount={filtered.length}
            totalCount={tickets.length}
          />

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
              <p className="text-sm text-zinc-400">No tickets match the current filters.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Ticket</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Subject</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">FD Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Priority</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Jira Ticket</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Jira Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Requester</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Days Open</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">SLA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filtered.map((ticket) => {
                    const breach = isSlaBreach(ticket);
                    const atRisk = isSlaAtRisk(ticket);
                    return (
                      <tr
                        key={ticket.id}
                        className={`bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${breach ? "border-l-2 border-l-red-500" : atRisk ? "border-l-2 border-l-orange-400" : ""}`}
                      >
                        {/* FD Ticket ID */}
                        <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                          <a
                            href={`${fdBaseUrl}/helpdesk/tickets/${ticket.fdTicketId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 hover:text-blue-600"
                          >
                            #{ticket.fdTicketId}
                            <RiExternalLinkLine className="h-3 w-3" />
                          </a>
                        </td>

                        {/* Subject */}
                        <td className="max-w-xs px-4 py-3 text-xs text-zinc-900 dark:text-zinc-100">
                          <span className="line-clamp-2">{ticket.subject}</span>
                        </td>

                        {/* FD Status */}
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(ticket.fdStatus)}`}>
                            {ticket.fdStatusLabel}
                          </span>
                        </td>

                        {/* Priority */}
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${priorityColor(ticket.fdPriority)}`}>
                            {ticket.fdPriorityLabel}
                          </span>
                        </td>

                        {/* Jira Ticket */}
                        <td className="px-4 py-3 font-mono text-xs">
                          {ticket.linkedJiraKey ? (
                            jiraBaseUrl ? (
                              <a
                                href={`${jiraBaseUrl}/browse/${ticket.linkedJiraKey}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                              >
                                {ticket.linkedJiraKey}
                                <RiExternalLinkLine className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-zinc-700 dark:text-zinc-300">{ticket.linkedJiraKey}</span>
                            )
                          ) : (
                            <span className="flex items-center gap-1 text-orange-500">
                              <RiAlertLine className="h-3 w-3" />
                              Not linked
                            </span>
                          )}
                        </td>

                        {/* Jira Status */}
                        <td className="px-4 py-3">
                          {ticket.linkedJiraStatus ? (
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${jiraStatusColor(ticket.linkedJiraStatus)}`}>
                              {ticket.linkedJiraStatus}
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-400">—</span>
                          )}
                        </td>

                        {/* Requester */}
                        <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                          {ticket.requesterName ?? "—"}
                        </td>

                        {/* Days Open */}
                        <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                          {daysOpen(ticket.fdCreatedAt ? String(ticket.fdCreatedAt) : null)}d
                        </td>

                        {/* SLA */}
                        <td className="px-4 py-3">
                          {breach ? (
                            <span className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                              <RiAlertLine className="h-3 w-3" /> Breached
                            </span>
                          ) : atRisk ? (
                            <span className="flex items-center gap-1 text-xs font-medium text-orange-500">
                              <RiTimeLine className="h-3 w-3" /> At risk
                            </span>
                          ) : ticket.fdStatus === 4 || ticket.fdStatus === 5 ? (
                            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                              <RiCheckLine className="h-3 w-3" /> OK
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

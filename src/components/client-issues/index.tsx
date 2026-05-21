"use client";

import React, { useEffect, useState, useTransition, useMemo, useRef } from "react";
import {
  RiRefreshLine,
  RiExternalLinkLine,
  RiAlertLine,
  RiCheckLine,
  RiTimeLine,
  RiSearchLine,
  RiDownloadLine,
  RiLayoutColumnLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import type { FreshdeskTicket } from "@/lib/db/schema";

type TicketWithJiraDate = FreshdeskTicket & {
  jiraCreatedAt: string | null;
  jiraPriority: string | null;
};

// ─── column definitions ───────────────────────────────────────────────────────

type ColumnId =
  | "ticket" | "subject" | "fdStatus" | "priority"
  | "jiraTicket" | "jiraStatus" | "jiraAssignee" | "jiraPriority"
  | "requester" | "fdCreated" | "jiraCreated" | "response" | "daysOpen" | "sla";

interface ColDef {
  id: ColumnId;
  label: string;
  defaultVisible: boolean;
  required?: boolean;
}

const COLUMNS: ColDef[] = [
  { id: "ticket",      label: "Ticket",       defaultVisible: true,  required: true },
  { id: "subject",     label: "Subject",      defaultVisible: true,  required: true },
  { id: "fdStatus",    label: "FD Status",    defaultVisible: true  },
  { id: "priority",    label: "Priority",     defaultVisible: true  },
  { id: "jiraTicket",  label: "Jira Ticket",  defaultVisible: true  },
  { id: "jiraStatus",   label: "Jira Status",    defaultVisible: true  },
  { id: "jiraAssignee", label: "Jira Assignee", defaultVisible: true  },
  { id: "jiraPriority", label: "Jira Priority", defaultVisible: true  },
  { id: "requester",    label: "Requester",     defaultVisible: true  },
  { id: "fdCreated",   label: "FD Created",   defaultVisible: true  },
  { id: "jiraCreated", label: "Jira Created", defaultVisible: false },
  { id: "response",    label: "Response",     defaultVisible: true  },
  { id: "daysOpen",    label: "Days Open",    defaultVisible: false },
  { id: "sla",         label: "SLA",          defaultVisible: true  },
];

const DEFAULT_VISIBLE = new Set<ColumnId>(
  COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id)
);

// ─── helpers ────────────────────────────────────────────────────────────────

const FD_STATUS_SHORT: Record<number, string> = {
  2: "Open", 3: "Pending", 4: "Resolved", 5: "Closed",
  6: "Waiting (Cust.)", 7: "Waiting (3rd Party)",
};

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

function jiraPriorityColor(priority: string | null) {
  if (!priority) return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  const p = priority.toLowerCase();
  if (p === "highest" || p === "critical") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  if (p === "high") return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";
  if (p === "medium") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
  return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
}

function fmtDate(val: string | Date | null | undefined): string {
  if (!val) return "—";
  return new Date(val as string).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function daysOpen(createdAt: string | null): number {
  if (!createdAt) return 0;
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
}

function responseDays(fdCreatedAt: string | null, jiraCreatedAt: string | null): number | null {
  if (!fdCreatedAt || !jiraCreatedAt) return null;
  return Math.max(0, Math.floor(
    (new Date(jiraCreatedAt).getTime() - new Date(fdCreatedAt).getTime()) / 86_400_000
  ));
}

function responseTimeColor(days: number) {
  if (days <= 2) return "text-green-600 dark:text-green-400";
  if (days <= 5) return "text-yellow-600 dark:text-yellow-500";
  return "text-red-600 dark:text-red-400";
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

function slaLabel(ticket: FreshdeskTicket): string {
  if (isSlaBreach(ticket)) return "Breached";
  if (isSlaAtRisk(ticket)) return "At Risk";
  if (ticket.fdStatus === 4 || ticket.fdStatus === 5) return "OK";
  return "";
}

// ─── csv export ──────────────────────────────────────────────────────────────

function csvCell(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLS: { id: ColumnId; header: string; get: (t: TicketWithJiraDate) => string | number | null | undefined }[] = [
  { id: "ticket",      header: "FD Ticket",       get: (t) => `#${t.fdTicketId}` },
  { id: "subject",     header: "Subject",          get: (t) => t.subject },
  { id: "fdStatus",    header: "FD Status",        get: (t) => t.fdStatusLabel },
  { id: "priority",    header: "Priority",         get: (t) => t.fdPriorityLabel },
  { id: "jiraTicket",  header: "Jira Key",         get: (t) => t.linkedJiraKey },
  { id: "jiraStatus",   header: "Jira Status",    get: (t) => t.linkedJiraStatus },
  { id: "jiraAssignee", header: "Jira Assignee",  get: (t) => t.linkedJiraAssigneeName },
  { id: "jiraPriority", header: "Jira Priority",  get: (t) => t.jiraPriority },
  { id: "requester",    header: "Requester",      get: (t) => t.requesterName },
  { id: "fdCreated",   header: "FD Created",       get: (t) => fmtDate(t.fdCreatedAt ? String(t.fdCreatedAt) : null) },
  { id: "jiraCreated", header: "Jira Created",     get: (t) => fmtDate(t.jiraCreatedAt) },
  { id: "response",    header: "Response (days)",  get: (t) => { const r = responseDays(t.fdCreatedAt ? String(t.fdCreatedAt) : null, t.jiraCreatedAt ?? null); return r !== null ? r : ""; } },
  { id: "daysOpen",    header: "Days Open",        get: (t) => daysOpen(t.fdCreatedAt ? String(t.fdCreatedAt) : null) },
  { id: "sla",         header: "SLA",              get: (t) => slaLabel(t) },
];

function exportToCsv(tickets: TicketWithJiraDate[], visibleCols: Set<ColumnId>) {
  const cols = CSV_COLS.filter((c) => visibleCols.has(c.id));
  const headers = cols.map((c) => c.header);
  const rows = tickets.map((t) => cols.map((c) => csvCell(c.get(t))).join(","));
  const blob = new Blob(["﻿" + [headers.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cavinKare-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── column toggle dropdown ───────────────────────────────────────────────────

function ColumnToggle({
  visibleCols,
  onToggle,
}: {
  visibleCols: Set<ColumnId>;
  onToggle: (id: ColumnId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const hiddenCount = COLUMNS.filter((c) => !c.required && !visibleCols.has(c.id)).length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <RiLayoutColumnLine className="h-3.5 w-3.5" />
        Columns
        {hiddenCount > 0 && (
          <span className="ml-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {hiddenCount} hidden
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-lg border border-zinc-200 bg-white py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <p className="px-3 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Toggle columns
          </p>
          {COLUMNS.map((col) => (
            <label
              key={col.id}
              className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 ${col.required ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <input
                type="checkbox"
                checked={visibleCols.has(col.id)}
                disabled={col.required}
                onChange={() => !col.required && onToggle(col.id)}
                className="h-3.5 w-3.5 rounded accent-blue-600"
              />
              <span className="text-zinc-700 dark:text-zinc-300">{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── summary cards ───────────────────────────────────────────────────────────

function SummaryCards({ tickets }: { tickets: TicketWithJiraDate[] }) {
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

type SortKey = "newest" | "oldest" | "priority" | "days" | "response";
type JiraLinkFilter = "all" | "linked" | "unlinked";
type SlaFilter = "all" | "breached" | "at_risk";
type DateRange = "all" | "7d" | "30d" | "90d";

interface Filters {
  search: string;
  fdStatus: string;
  fdPriority: string;
  ticketType: string;
  jiraLink: JiraLinkFilter;
  jiraStatus: string;
  jiraAssignee: string;
  jiraPriority: string;
  sla: SlaFilter;
  escalated: string;   // "" = all | "yes" = escalated only
  sort: SortKey;
  dateRange: DateRange;
}

const DEFAULT_FILTERS: Filters = {
  search: "", fdStatus: "", fdPriority: "", ticketType: "",
  jiraLink: "all", jiraStatus: "", jiraAssignee: "", jiraPriority: "",
  sla: "all", escalated: "", sort: "newest", dateRange: "all",
};

interface FilterOptions {
  ticketTypes: string[];
  jiraStatuses: string[];
  jiraAssignees: string[];
  jiraPriorities: string[];
}

function Select({ value, onChange, options }: {
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
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function hasActiveFilters(f: Filters) {
  return (
    f.search !== "" || f.fdStatus !== "" || f.fdPriority !== "" || f.ticketType !== "" ||
    f.jiraLink !== "all" || f.jiraStatus !== "" || f.jiraAssignee !== "" || f.jiraPriority !== "" ||
    f.sla !== "all" || f.escalated !== "" || f.sort !== "newest" || f.dateRange !== "all"
  );
}

function FilterBar({
  filters, onChange, filteredCount, totalCount, onExport, visibleCols, onToggleCol, options,
}: {
  filters: Filters;
  onChange: (f: Partial<Filters>) => void;
  filteredCount: number;
  totalCount: number;
  onExport: () => void;
  visibleCols: Set<ColumnId>;
  onToggleCol: (id: ColumnId) => void;
  options: FilterOptions;
}) {
  const [expanded, setExpanded] = useState(false);

  const activeFilterCount = [
    filters.fdStatus !== "",
    filters.fdPriority !== "",
    filters.ticketType !== "",
    filters.dateRange !== "all",
    filters.jiraLink !== "all",
    filters.jiraStatus !== "",
    filters.jiraAssignee !== "",
    filters.jiraPriority !== "",
    filters.sla !== "all",
    filters.escalated !== "",
  ].filter(Boolean).length;

  return (
    <div className="mb-3 space-y-2">
      {/* Always-visible top bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <RiSearchLine className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search subject or ticket ID…"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-7 pr-3 text-xs text-zinc-700 shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          />
        </div>
        <Select value={filters.sort} onChange={(v) => onChange({ sort: v as SortKey })}
          options={[
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
            { value: "priority", label: "Priority: high → low" },
            { value: "days", label: "Days open: most" },
            { value: "response", label: "Response: slowest" },
          ]}
        />
        <button
          onClick={() => setExpanded((v) => !v)}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs shadow-sm transition-colors ${
            activeFilterCount > 0 || expanded
              ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 4h12M4 8h8M6 12h4" />
          </svg>
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-0.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
        <ColumnToggle visibleCols={visibleCols} onToggle={onToggleCol} />
        <button
          onClick={onExport}
          disabled={filteredCount === 0}
          className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <RiDownloadLine className="h-3.5 w-3.5" />
          Export
        </button>
      </div>

      {/* Expandable filter panel */}
      {expanded && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <LabeledSelect label="Date range">
              <Select value={filters.dateRange} onChange={(v) => onChange({ dateRange: v as DateRange })}
                options={[{ value: "all", label: "All time" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last 90 days" }]}
              />
            </LabeledSelect>
            <LabeledSelect label="FD Status">
              <Select value={filters.fdStatus} onChange={(v) => onChange({ fdStatus: v })}
                options={[{ value: "", label: "All" }, { value: "2", label: "Open" }, { value: "3", label: "Pending" }, { value: "6", label: "Waiting (Cust.)" }, { value: "7", label: "Waiting (3rd)" }, { value: "4", label: "Resolved" }, { value: "5", label: "Closed" }]}
              />
            </LabeledSelect>
            <LabeledSelect label="FD Priority">
              <Select value={filters.fdPriority} onChange={(v) => onChange({ fdPriority: v })}
                options={[{ value: "", label: "All" }, { value: "4", label: "Urgent" }, { value: "3", label: "High" }, { value: "2", label: "Medium" }, { value: "1", label: "Low" }]}
              />
            </LabeledSelect>
            <LabeledSelect label="SLA">
              <Select value={filters.sla} onChange={(v) => onChange({ sla: v as SlaFilter })}
                options={[{ value: "all", label: "All" }, { value: "breached", label: "Breached" }, { value: "at_risk", label: "At risk" }]}
              />
            </LabeledSelect>
            <LabeledSelect label="Escalated">
              <Select value={filters.escalated} onChange={(v) => onChange({ escalated: v })}
                options={[{ value: "", label: "All" }, { value: "yes", label: "Escalated only" }]}
              />
            </LabeledSelect>
            <LabeledSelect label="Jira Link">
              <Select value={filters.jiraLink} onChange={(v) => onChange({ jiraLink: v as JiraLinkFilter })}
                options={[{ value: "all", label: "All" }, { value: "linked", label: "Linked" }, { value: "unlinked", label: "Not linked" }]}
              />
            </LabeledSelect>
            {options.jiraStatuses.length > 0 && (
              <LabeledSelect label="Jira Status">
                <Select value={filters.jiraStatus} onChange={(v) => onChange({ jiraStatus: v })}
                  options={[{ value: "", label: "All" }, ...options.jiraStatuses.map((s) => ({ value: s, label: s }))]}
                />
              </LabeledSelect>
            )}
            {options.jiraAssignees.length > 0 && (
              <LabeledSelect label="Jira Assignee">
                <Select value={filters.jiraAssignee} onChange={(v) => onChange({ jiraAssignee: v })}
                  options={[{ value: "", label: "All" }, ...options.jiraAssignees.map((a) => ({ value: a, label: a }))]}
                />
              </LabeledSelect>
            )}
            {options.jiraPriorities.length > 0 && (
              <LabeledSelect label="Jira Priority">
                <Select value={filters.jiraPriority} onChange={(v) => onChange({ jiraPriority: v })}
                  options={[{ value: "", label: "All" }, ...options.jiraPriorities.map((p) => ({ value: p, label: p }))]}
                />
              </LabeledSelect>
            )}
            {options.ticketTypes.length > 0 && (
              <LabeledSelect label="Ticket Type">
                <Select value={filters.ticketType} onChange={(v) => onChange({ ticketType: v })}
                  options={[{ value: "", label: "All" }, ...options.ticketTypes.map((t) => ({ value: t, label: t }))]}
                />
              </LabeledSelect>
            )}
          </div>
          {activeFilterCount > 0 && (
            <div className="mt-3 border-t border-zinc-200 pt-2.5 dark:border-zinc-700">
              <button
                onClick={() => onChange(DEFAULT_FILTERS)}
                className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Count row */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{filteredCount}</span>
        {filteredCount !== totalCount && <> of {totalCount}</>}{" "}
        ticket{filteredCount !== 1 ? "s" : ""}
        {activeFilterCount > 0 && (
          <span className="ml-1 text-zinc-400">· {activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""} active</span>
        )}
      </p>
    </div>
  );
}

function LabeledSelect({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</span>
      <div className="[&>select]:w-full">{children}</div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function ClientIssuesTab({ projectId }: { projectId: string }) {
  const [tickets, setTickets] = useState<TicketWithJiraDate[]>([]);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, startSync] = useTransition();
  const [syncResult, setSyncResult] = useState<{ synced: number; linked: number } | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [visibleCols, setVisibleCols] = useState<Set<ColumnId>>(new Set(DEFAULT_VISIBLE));

  function toggleCol(id: ColumnId) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function col(id: ColumnId) { return visibleCols.has(id); }

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

  const filtered = useMemo(() => {
    let result = [...tickets];

    if (filters.dateRange !== "all") {
      const days = filters.dateRange === "7d" ? 7 : filters.dateRange === "30d" ? 30 : 90;
      const cutoff = Date.now() - days * 86_400_000;
      result = result.filter((t) => t.fdCreatedAt && new Date(t.fdCreatedAt).getTime() >= cutoff);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter((t) => t.subject?.toLowerCase().includes(q) || String(t.fdTicketId).includes(q));
    }
    if (filters.fdStatus) result = result.filter((t) => t.fdStatus === parseInt(filters.fdStatus, 10));
    if (filters.fdPriority) result = result.filter((t) => t.fdPriority === parseInt(filters.fdPriority, 10));
    if (filters.ticketType) result = result.filter((t) => t.ticketType === filters.ticketType);
    if (filters.jiraLink === "linked") result = result.filter((t) => !!t.linkedJiraKey);
    else if (filters.jiraLink === "unlinked") result = result.filter((t) => !t.linkedJiraKey);
    if (filters.jiraStatus) result = result.filter((t) => t.linkedJiraStatus === filters.jiraStatus);
    if (filters.jiraAssignee) result = result.filter((t) => t.linkedJiraAssigneeName === filters.jiraAssignee);
    if (filters.jiraPriority) result = result.filter((t) => t.jiraPriority === filters.jiraPriority);
    if (filters.escalated === "yes") result = result.filter((t) => t.isEscalated);
    if (filters.sla === "breached") result = result.filter(isSlaBreach);
    else if (filters.sla === "at_risk") result = result.filter(isSlaAtRisk);

    result.sort((a, b) => {
      if (filters.sort === "oldest") return new Date(a.fdCreatedAt!).getTime() - new Date(b.fdCreatedAt!).getTime();
      if (filters.sort === "priority") return (b.fdPriority ?? 0) - (a.fdPriority ?? 0);
      if (filters.sort === "days") return daysOpen(b.fdCreatedAt ? String(b.fdCreatedAt) : null) - daysOpen(a.fdCreatedAt ? String(a.fdCreatedAt) : null);
      if (filters.sort === "response") {
        const ra = responseDays(a.fdCreatedAt ? String(a.fdCreatedAt) : null, a.jiraCreatedAt) ?? -1;
        const rb = responseDays(b.fdCreatedAt ? String(b.fdCreatedAt) : null, b.jiraCreatedAt) ?? -1;
        return rb - ra;
      }
      return new Date(b.fdCreatedAt!).getTime() - new Date(a.fdCreatedAt!).getTime();
    });
    return result;
  }, [tickets, filters]);

  const filterOptions = useMemo<FilterOptions>(() => ({
    ticketTypes: [...new Set(tickets.map((t) => t.ticketType).filter((v): v is string => !!v))].sort(),
    jiraStatuses: [...new Set(tickets.map((t) => t.linkedJiraStatus).filter((v): v is string => !!v))].sort(),
    jiraAssignees: [...new Set(tickets.map((t) => t.linkedJiraAssigneeName).filter((v): v is string => !!v))].sort(),
    jiraPriorities: [...new Set(tickets.map((t) => t.jiraPriority).filter((v): v is string => !!v))].sort(),
  }), [tickets]);

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
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Client Issue Tracker</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Freshdesk tickets from CavinKare linked to Jira</p>
        </div>
        <div className="flex items-center gap-2">
          {syncResult && (
            <span className="text-xs text-zinc-500">{syncResult.synced} synced · {syncResult.linked} linked</span>
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
            onChange={(p) => setFilters((prev) => ({ ...prev, ...p }))}
            filteredCount={filtered.length}
            totalCount={tickets.length}
            onExport={() => exportToCsv(filtered, visibleCols)}
            visibleCols={visibleCols}
            onToggleCol={toggleCol}
            options={filterOptions}
          />

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
              <p className="text-sm text-zinc-400">No tickets match the current filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    {col("ticket")      && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">Ticket</th>}
                    {col("subject")     && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Subject</th>}
                    {col("fdStatus")    && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">FD Status</th>}
                    {col("priority")    && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Priority</th>}
                    {col("jiraTicket")  && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">Jira Ticket</th>}
                    {col("jiraStatus")   && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">Jira Status</th>}
                    {col("jiraAssignee") && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">Jira Assignee</th>}
                    {col("jiraPriority") && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">Jira Priority</th>}
                    {col("requester")    && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">Requester</th>}
                    {col("fdCreated")   && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">FD Created</th>}
                    {col("jiraCreated") && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">Jira Created</th>}
                    {col("response")    && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 whitespace-nowrap" title="Days between FD ticket creation and Jira issue creation">Response</th>}
                    {col("daysOpen")    && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">Days Open</th>}
                    {col("sla")         && <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">SLA</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filtered.map((ticket) => {
                    const breach = isSlaBreach(ticket);
                    const atRisk = isSlaAtRisk(ticket);
                    const fd = ticket.fdCreatedAt ? String(ticket.fdCreatedAt) : null;
                    const resp = responseDays(fd, ticket.jiraCreatedAt ?? null);
                    return (
                      <tr
                        key={ticket.id}
                        className={`bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${breach ? "border-l-2 border-l-red-500" : atRisk ? "border-l-2 border-l-orange-400" : ""}`}
                      >
                        {col("ticket") && (
                          <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            <a href={`${fdBaseUrl}/helpdesk/tickets/${ticket.fdTicketId}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-blue-600">
                              #{ticket.fdTicketId}
                              <RiExternalLinkLine className="h-3 w-3" />
                            </a>
                          </td>
                        )}
                        {col("subject") && (
                          <td className="max-w-xs px-4 py-3 text-xs text-zinc-900 dark:text-zinc-100">
                            <span className="line-clamp-2">{ticket.subject}</span>
                          </td>
                        )}
                        {col("fdStatus") && (
                          <td className="px-4 py-3">
                            <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(ticket.fdStatus)}`}>
                              {FD_STATUS_SHORT[ticket.fdStatus] ?? ticket.fdStatusLabel}
                            </span>
                          </td>
                        )}
                        {col("priority") && (
                          <td className="px-4 py-3">
                            <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${priorityColor(ticket.fdPriority)}`}>
                              {ticket.fdPriorityLabel}
                            </span>
                          </td>
                        )}
                        {col("jiraTicket") && (
                          <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                            {ticket.linkedJiraKey ? (
                              jiraBaseUrl ? (
                                <a href={`${jiraBaseUrl}/browse/${ticket.linkedJiraKey}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
                                  {ticket.linkedJiraKey}
                                  <RiExternalLinkLine className="h-3 w-3 shrink-0" />
                                </a>
                              ) : (
                                <span className="text-zinc-700 dark:text-zinc-300">{ticket.linkedJiraKey}</span>
                              )
                            ) : (
                              <span className="inline-flex items-center gap-1 text-orange-500">
                                <RiAlertLine className="h-3 w-3 shrink-0" /> Not linked
                              </span>
                            )}
                          </td>
                        )}
                        {col("jiraStatus") && (
                          <td className="px-4 py-3">
                            {ticket.linkedJiraStatus ? (
                              <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${jiraStatusColor(ticket.linkedJiraStatus)}`}>
                                {ticket.linkedJiraStatus}
                              </span>
                            ) : (
                              <span className="text-xs text-zinc-400">—</span>
                            )}
                          </td>
                        )}
                        {col("jiraAssignee") && (
                          <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {ticket.linkedJiraAssigneeName ?? <span className="text-zinc-400">—</span>}
                          </td>
                        )}
                        {col("jiraPriority") && (
                          <td className="px-4 py-3">
                            {ticket.jiraPriority ? (
                              <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${jiraPriorityColor(ticket.jiraPriority)}`}>
                                {ticket.jiraPriority}
                              </span>
                            ) : (
                              <span className="text-xs text-zinc-400">—</span>
                            )}
                          </td>
                        )}
                        {col("requester") && (
                          <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {ticket.requesterName ?? "—"}
                          </td>
                        )}
                        {col("fdCreated") && (
                          <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {fmtDate(fd)}
                          </td>
                        )}
                        {col("jiraCreated") && (
                          <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {fmtDate(ticket.jiraCreatedAt)}
                          </td>
                        )}
                        {col("response") && (
                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            {resp !== null ? (
                              <span className={`font-medium ${responseTimeColor(resp)}`}>
                                {resp === 0 ? "Same day" : `${resp}d`}
                              </span>
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                          </td>
                        )}
                        {col("daysOpen") && (
                          <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {daysOpen(fd)}d
                          </td>
                        )}
                        {col("sla") && (
                          <td className="px-4 py-3">
                            {breach ? (
                              <span className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400"><RiAlertLine className="h-3 w-3" /> Breached</span>
                            ) : atRisk ? (
                              <span className="flex items-center gap-1 text-xs font-medium text-orange-500"><RiTimeLine className="h-3 w-3" /> At risk</span>
                            ) : ticket.fdStatus === 4 || ticket.fdStatus === 5 ? (
                              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><RiCheckLine className="h-3 w-3" /> OK</span>
                            ) : (
                              <span className="text-xs text-zinc-400">—</span>
                            )}
                          </td>
                        )}
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

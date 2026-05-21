"use client";

import { useEffect, useState, useTransition } from "react";
import { RiRefreshLine, RiExternalLinkLine, RiAlertLine, RiCheckLine, RiTimeLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { FreshdeskTicket } from "@/lib/db/schema";

// ─── helpers ────────────────────────────────────────────────────────────────

function statusColor(status: number) {
  if (status === 2) return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
  if (status === 3) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
  if (status === 4) return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
  if (status === 5) return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
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
  return msLeft > 0 && msLeft < 4 * 60 * 60 * 1000; // within 4h
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
      <Card label="Open" value={open} color="text-blue-600 dark:text-blue-400" />
      <Card label="Unlinked to Jira" value={unlinked} color={unlinked > 0 ? "text-orange-600 dark:text-orange-400" : "text-zinc-500"} />
      <Card label="SLA Breached" value={breached} color={breached > 0 ? "text-red-600 dark:text-red-400" : "text-zinc-500"} />
      <Card label="Resolved" value={resolved} color="text-green-600 dark:text-green-400" />
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function ClientIssuesTab({ projectId }: { projectId: string }) {
  const [tickets, setTickets] = useState<FreshdeskTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, startSync] = useTransition();
  const [syncResult, setSyncResult] = useState<{ synced: number; linked: number } | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/freshdesk/tickets/${projectId}`);
    if (res.ok) setTickets(await res.json());
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
              {tickets.map((ticket) => {
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
                        <span className="text-zinc-700 dark:text-zinc-300">{ticket.linkedJiraKey}</span>
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
    </div>
  );
}

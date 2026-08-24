"use client";

// The actual "LOC Sync Status" content (fetch, table, CSV download, multi-PR
// picker) — shared between LocSyncStatusModal (performance-review's drill-
// down, tucked behind a button since that page already has 7 dense tabs) and
// My PRs (rendered directly inline, since that page's whole point is showing
// this at a glance, not gating it behind another click).
import { useEffect, useState } from "react";
import { RiCloseLine, RiDownload2Line, RiExternalLinkLine, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PrLink = { repoFullName: string; number: number; url: string };

export type LocSyncStatusRow = {
  jiraKey: string;
  summary: string;
  jiraUrl?: string;
  status: "synced" | "credited_elsewhere" | "not_synced";
  reason: string | null;
  additions: number | null;
  deletions: number | null;
  prCount: number | null;
  creditedEmail: string | null;
  prLinks: PrLink[];
};

const STATUS_LABEL: Record<LocSyncStatusRow["status"], string> = {
  synced: "Synced",
  credited_elsewhere: "Credited elsewhere",
  not_synced: "Not synced",
};

const STATUS_BADGE: Record<LocSyncStatusRow["status"], string> = {
  synced: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  credited_elsewhere: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  not_synced: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
};

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows: LocSyncStatusRow[], email: string, quarterKey: string) {
  const header = [
    "Jira Key", "Summary", "Status", "Reason", "Additions", "Deletions", "PR Count", "Credited Email", "Jira URL", "PR Links",
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.jiraKey,
        r.summary,
        STATUS_LABEL[r.status],
        r.reason ?? "",
        r.additions ?? "",
        r.deletions ?? "",
        r.prCount ?? "",
        r.creditedEmail ?? "",
        r.jiraUrl ?? "",
        r.prLinks.map((p) => p.url).join(" "),
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `loc-sync-status-${email}-${quarterKey}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function LocSyncStatusPanel({
  email,
  quarterKey,
  active = true,
}: {
  email: string;
  quarterKey: string;
  /** Only starts fetching once true — lets a modal wrapper defer the fetch
   *  until it's actually opened; inline usage just leaves this at its
   *  default (true) and fetches as soon as it mounts. */
  active?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LocSyncStatusRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A separate, independently-controlled Dialog for "more than one PR" — its
  // own open state (derived from prPickerRow !== null) so dismissing it via
  // an outside click only closes this picker, never anything behind it.
  const [prPickerRow, setPrPickerRow] = useState<LocSyncStatusRow | null>(null);

  useEffect(() => {
    if (!active || rows !== null || loading) return;
    setLoading(true);
    setError(null);
    fetch(`/api/performance-review/loc-sync-status?email=${encodeURIComponent(email)}&quarter=${encodeURIComponent(quarterKey)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}) as { error?: string });
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        return res.json() as Promise<{ rows: LocSyncStatusRow[] }>;
      })
      .then((data) => setRows(data.rows))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const syncedCount = rows?.filter((r) => r.status === "synced").length ?? 0;
  const notSyncedCount = (rows?.length ?? 0) - syncedCount;

  return (
    <div className="space-y-3">
      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
          <RiLoader4Line className="size-4 animate-spin" />
          Loading…
        </div>
      )}

      {error && <p className="py-6 text-center text-sm text-destructive">{error}</p>}

      {rows && rows.length === 0 && (
        <p className="py-6 text-center text-sm text-zinc-500">
          No completed Jiras this quarter to check.
        </p>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              {syncedCount} synced, {notSyncedCount} not synced — {rows.length} total.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => downloadCsv(rows, email, quarterKey)}
            >
              <RiDownload2Line className="size-3.5" />
              Download CSV
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium text-zinc-500">Jira</th>
                  <th className="px-3 py-2 font-medium text-zinc-500">Status</th>
                  <th className="px-3 py-2 font-medium text-zinc-500">Reason</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-500">+/-</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-500">PRs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((r) => (
                  <tr key={r.jiraKey}>
                    <td className="px-3 py-2 align-top">
                      {r.jiraUrl ? (
                        <a
                          href={r.jiraUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-primary hover:underline"
                        >
                          {r.jiraKey}
                        </a>
                      ) : (
                        <span className="font-mono">{r.jiraKey}</span>
                      )}
                      <div className="mt-0.5 max-w-[220px] truncate text-zinc-500" title={r.summary}>
                        {r.summary}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Badge variant="secondary" className={cn("shrink-0", STATUS_BADGE[r.status])}>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 align-top text-zinc-600 dark:text-zinc-400">
                      {r.reason ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {r.additions == null ? (
                        "—"
                      ) : r.prLinks.length === 1 ? (
                        <a
                          href={r.prLinks[0].url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                          title={`${r.prLinks[0].repoFullName}#${r.prLinks[0].number} — view changed files`}
                        >
                          {`+${r.additions}/-${r.deletions}`}
                        </a>
                      ) : r.prLinks.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setPrPickerRow(r)}
                          className="text-primary hover:underline"
                          title={`${r.prLinks.length} PRs — click to choose one`}
                        >
                          {`+${r.additions}/-${r.deletions}`}
                        </button>
                      ) : (
                        `+${r.additions}/-${r.deletions}`
                      )}
                    </td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">{r.prCount ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Independently-controlled nested modal for the "more than one PR"
          case. Its own open state means an outside click here only dismisses
          this picker via its own overlay. */}
      <Dialog open={prPickerRow !== null} onOpenChange={(next) => { if (!next) setPrPickerRow(null); }}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[85vh] max-w-sm flex-col overflow-hidden"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center justify-between gap-3">
              <span>{prPickerRow?.jiraKey} — Pull Requests</span>
              <DialogClose asChild>
                <Button variant="ghost" size="icon-sm">
                  <RiCloseLine />
                  <span className="sr-only">Close</span>
                </Button>
              </DialogClose>
            </DialogTitle>
          </DialogHeader>
          <div className="-mx-4 -mb-4 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-4">
            {prPickerRow?.prLinks.map((p) => (
              <a
                key={`${p.repoFullName}#${p.number}`}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
              >
                <span className="min-w-0 truncate font-mono">
                  {p.repoFullName}#{p.number}
                </span>
                <RiExternalLinkLine className="size-3.5 shrink-0 text-zinc-400" />
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

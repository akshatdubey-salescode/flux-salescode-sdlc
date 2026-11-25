"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { RiDownload2Line, RiErrorWarningLine, RiRefreshLine } from "@remixicon/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DEFAULT_TIME_ZONE, formatZonedDateTime, zoneLabel } from "@/lib/support/tz";
import { formatDayMonthYear, ytdAttachmentFilename } from "@/lib/support/ytd";
import {
  CATEGORY_LABELS,
  SUPPORT_CATEGORIES,
  type SupportCategory,
  type SupportReportData,
} from "@/lib/support/types";

type ReportStatus = "awaiting_approval" | "sending" | "sent" | "failed" | "lapsed";

/** A support_reports row over JSON, without `data` (as GET /reports lists it). */
type ReportRow = {
  id: string;
  reportDate: string;
  status: ReportStatus;
  builtAt: string;
  builtByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  recipientsTo: string[] | null;
  recipientsCc: string[] | null;
  providerMessageId: string | null;
  error: string | null;
};

type ListResponse = {
  reports: ReportRow[];
  canApprove: boolean;
  sendEnabled: boolean;
  today: string; // the project's calendar day
  timeZone?: string; // the project's IANA timezone
};

type DetailResponse = {
  report: ReportRow & { data: SupportReportData };
  html: string;
  subject: string;
  blocker: string | null;
};

type Recipients = { toEmails: string[]; ccEmails: string[] };

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const STATUS_LABELS: Record<ReportStatus, string> = {
  awaiting_approval: "Awaiting approval",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  lapsed: "Lapsed",
};

const STATUS_BADGE: Record<ReportStatus, string> = {
  awaiting_approval: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  sending: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  sent: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  lapsed: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const TH = "px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap text-zinc-500";
const TD = "px-3 py-2 align-middle";

function formatYmd(ymd: string): string {
  return format(parseISO(ymd), "dd MMM yyyy");
}

/**
 * fetch + JSON with failures normalised. An auth guard that redirects (to
 * sign-in or /home) lands on an HTML page, so a redirected or non-JSON
 * response is a failure, never a success.
 */
async function requestJson<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, status: 0, error: "Network error — check your connection" };
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  if (res.redirected || !isJson) {
    return { ok: false, status: res.status, error: "Not allowed — your session may have expired; reload the page" };
  }
  try {
    const body = (await res.json()) as T & { error?: unknown };
    if (!res.ok) {
      return { ok: false, status: res.status, error: typeof body.error === "string" ? body.error : `HTTP ${res.status}` };
    }
    return { ok: true, data: body };
  } catch {
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  }
}

function StatusBadge({ status }: { status: ReportStatus }) {
  return <Badge className={STATUS_BADGE[status]}>{STATUS_LABELS[status]}</Badge>;
}

/** A disabled button can't host a tooltip, so the trigger is a focusable span. */
function Gated({ reason, children }: { reason: string | null; children: React.ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

type Busy = "build" | "rebuild" | "approve" | null;
type Delivery = { loading: boolean; text: string | null; error: boolean };

export function ReportsView({ projectId }: { projectId: string }) {
  const base = `/api/projects/${projectId}/support`;

  const [list, setList] = useState<ListResponse | null>(null);
  const [listError, setListError] = useState(false);
  const [recipients, setRecipients] = useState<Recipients | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  // null = today's report.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listNonce, setListNonce] = useState(0);
  const [detailNonce, setDetailNonce] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Categories set inline since the current build, keyed by `${id}@${builtAt}`
  // so a rebuild (new builtAt) drops them.
  const [fixed, setFixed] = useState<{ key: string; cats: Record<string, SupportCategory> }>({ key: "", cats: {} });
  const [delivery, setDelivery] = useState<Record<string, Delivery>>({});

  const todayReport = list?.reports.find((r) => r.reportDate === list.today) ?? null;
  const tz = list?.timeZone ?? DEFAULT_TIME_ZONE;
  const zone = zoneLabel(tz);
  const fmtTime = (iso: string) => formatZonedDateTime(iso, tz);
  const currentId = selectedId ?? todayReport?.id ?? null;

  const listSeq = useRef(0);
  const detailSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const seq = ++listSeq.current;
    Promise.all([
      requestJson<ListResponse>(`${base}/reports`),
      requestJson<Recipients>(`${base}/settings`),
    ]).then(([l, s]) => {
      if (cancelled || seq !== listSeq.current) return;
      if (l.ok) {
        setList(l.data);
        setListError(false);
      } else {
        setListError(true);
        toast.error("Couldn't load support reports", { description: l.error });
      }
      if (s.ok) setRecipients({ toEmails: s.data.toEmails, ccEmails: s.data.ccEmails });
    });
    return () => {
      cancelled = true;
    };
  }, [base, listNonce]);

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    const seq = ++detailSeq.current;
    requestJson<DetailResponse>(`${base}/reports/${currentId}`).then((r) => {
      if (cancelled || seq !== detailSeq.current) return;
      if (r.ok) {
        setDetail(r.data);
        setDetailError(null);
      } else {
        setDetailError(r.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [base, currentId, detailNonce]);

  /** After any action: refetch the list and the report on screen. */
  const refreshAll = useCallback(() => {
    setListNonce((n) => n + 1);
    setDetailNonce((n) => n + 1);
  }, []);

  const shown = detail && detail.report.id === currentId ? detail : null;
  const shownKey = shown ? `${shown.report.id}@${shown.report.builtAt}` : "";
  const fixedCats = fixed.key === shownKey ? fixed.cats : {};

  async function buildNow() {
    setBusy("build");
    const r = await requestJson<{ id: string; created: boolean }>(`${base}/reports`, { method: "POST" });
    setBusy(null);
    if (r.ok) toast.success(r.data.created ? "Today's report built" : "Today's report rebuilt");
    else toast.error("Couldn't build the report", { description: r.error });
    setSelectedId(null);
    refreshAll();
  }

  async function rebuild(id: string) {
    setBusy("rebuild");
    const r = await requestJson<{ id: string }>(`${base}/reports/${id}/rebuild`, { method: "POST" });
    setBusy(null);
    if (r.ok) toast.success("Report rebuilt from current ticket data");
    else toast.error("Couldn't rebuild the report", { description: r.error });
    refreshAll();
  }

  async function approve(d: DetailResponse) {
    const retry = d.report.status === "failed";
    setBusy("approve");
    // The exact builtAt of the preview on screen: the server sends only if the
    // stored report is still this build, so what goes out is what was reviewed.
    const r = await requestJson<{ status: "sent" | "failed"; error?: string }>(`${base}/reports/${d.report.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ builtAt: d.report.builtAt }),
    });
    setBusy(null);
    if (r.ok && r.data.status === "failed") {
      // Claimed, but the provider refused it: the row is now `failed` (Retry).
      toast.error("Send failed", { description: r.data.error });
    } else if (r.ok) {
      toast.success(retry ? "Report re-sent" : "Report approved and sent");
    } else if (r.status === 409) {
      toast.error("Not sent: the report changed or is blocked", {
        description: `${r.error}. The preview has been reloaded — review it again.`,
      });
    } else {
      toast.error(retry ? "Retry failed" : "Send failed", { description: r.error });
    }
    refreshAll();
  }

  async function categorise(issueId: string, jiraKey: string, category: SupportCategory) {
    const key = shownKey;
    const prev = fixedCats[issueId];
    setFixed((cur) => ({ key, cats: { ...(cur.key === key ? cur.cats : {}), [issueId]: category } }));
    const r = await requestJson<unknown>(`${base}/tickets/${issueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    if (r.ok) {
      toast.success(`${jiraKey}: categorised as ${CATEGORY_LABELS[category]}`, {
        description: "Rebuild the report to include it.",
      });
      return;
    }
    setFixed((cur) => {
      if (cur.key !== key) return cur;
      const cats = { ...cur.cats };
      if (prev) cats[issueId] = prev;
      else delete cats[issueId];
      return { key, cats };
    });
    toast.error(`${jiraKey}: couldn't save category`, { description: r.error });
  }

  async function checkDelivery(id: string) {
    setDelivery((d) => ({ ...d, [id]: { loading: true, text: d[id]?.text ?? null, error: false } }));
    const r = await requestJson<{ lastEvent: string | null }>(`${base}/reports/${id}/delivery`);
    setDelivery((d) => ({
      ...d,
      [id]: r.ok
        ? { loading: false, text: r.data.lastEvent ?? "no events yet", error: false }
        : { loading: false, text: r.error, error: true },
    }));
  }

  if (listError && !list) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-sm text-zinc-500">
        Couldn&apos;t load support reports.
        <Button variant="outline" size="sm" onClick={refreshAll}>
          Try again
        </Button>
      </div>
    );
  }

  if (!list) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const { canApprove, sendEnabled, today } = list;
  const viewingToday = selectedId === null || selectedId === todayReport?.id;
  const report = shown?.report ?? null;
  const uncategorised = report?.data.uncategorised ?? [];
  const fixedCount = uncategorised.filter((u) => fixedCats[u.issueId]).length;
  // The YTD Excel snapshot stored on the build; absent on reports built before 2026-11-20.
  const ytdTickets = report?.data.ytdTickets;
  const attachmentName = report ? ytdAttachmentFilename(report.data.clientName ?? report.data.projectName, report.data.reportDate) : null;
  const approveReason = !shown
    ? "Loading…"
    : shown.blocker ?? (!canApprove ? "Only this project's approvers can send the report" : null);

  return (
    <div className="space-y-4">
      {!sendEnabled && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <RiErrorWarningLine className="size-4 shrink-0" />
          Sending is disabled in this environment — preview only.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {viewingToday ? "Today's report" : "Report"} ·{" "}
            {formatYmd(report?.reportDate ?? list.reports.find((r) => r.id === currentId)?.reportDate ?? today)}
            {report && <StatusBadge status={report.status} />}
          </CardTitle>
          <CardDescription>
            {report
              ? `Built ${fmtTime(report.builtAt)} ${zone} by ${report.builtByName ?? "the 17:00 schedule"}`
              : `Built automatically at 17:00 ${zone}, then held here for approval.`}
            {report?.status === "sent" && report.sentAt && (
              <>
                {" "}
                · Sent {fmtTime(report.sentAt)} {zone}
                {report.approvedByName ? ` by ${report.approvedByName}` : ""}
              </>
            )}
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            {!viewingToday && (
              <Button variant="outline" size="sm" onClick={() => setSelectedId(null)}>
                Back to today
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={refreshAll} aria-label="Refresh">
              <RiRefreshLine />
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4">
          {!currentId ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">
              No report has been built for today yet.
              {canApprove ? (
                <Button size="sm" onClick={buildNow} disabled={busy !== null}>
                  {busy === "build" ? "Building…" : "Build now"}
                </Button>
              ) : (
                <span>It is built at 17:00 {zone}; an approver can also build it on demand.</span>
              )}
            </div>
          ) : detailError && !shown ? (
            <div className="flex items-center gap-3 text-sm text-zinc-500">
              Couldn&apos;t load this report: {detailError}
              <Button variant="outline" size="sm" onClick={refreshAll}>
                Try again
              </Button>
            </div>
          ) : !shown || !report ? (
            <Skeleton className="h-[480px] w-full" />
          ) : (
            <>
              {(report.status === "awaiting_approval" || report.status === "failed") && (
                <div className="flex flex-wrap items-center gap-2">
                  {report.status === "awaiting_approval" && canApprove && (
                    <Button variant="outline" size="sm" onClick={() => rebuild(report.id)} disabled={busy !== null}>
                      {busy === "rebuild" ? "Rebuilding…" : "Rebuild"}
                    </Button>
                  )}
                  <Gated reason={approveReason}>
                    <Button
                      size="sm"
                      onClick={() => setConfirmOpen(true)}
                      disabled={approveReason !== null || busy !== null}
                    >
                      {busy === "approve"
                        ? "Sending…"
                        : report.status === "failed"
                          ? "Retry send"
                          : "Approve & send"}
                    </Button>
                  </Gated>
                  {shown.blocker && <span className="text-xs text-amber-700 dark:text-amber-400">{shown.blocker}</span>}
                </div>
              )}

              {report.status === "failed" && report.error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  Last attempt failed: {report.error}
                </p>
              )}

              {uncategorised.length > 0 && (
                <div className="space-y-2 rounded-lg border border-amber-300 p-3 dark:border-amber-800">
                  <p className="text-sm font-medium">
                    {uncategorised.length} uncategorised ticket{uncategorised.length === 1 ? "" : "s"} in this build
                  </p>
                  <ul className="space-y-1.5">
                    {uncategorised.map((u) => (
                      <li key={u.issueId} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono text-xs">{u.jiraKey}</span>
                        <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-400" title={u.summary}>
                          {u.summary}
                        </span>
                        <Select
                          value={fixedCats[u.issueId] ?? ""}
                          onValueChange={(v) => categorise(u.issueId, u.jiraKey, v as SupportCategory)}
                        >
                          <SelectTrigger aria-label={`Category for ${u.jiraKey}`} className="w-40">
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
                      </li>
                    ))}
                  </ul>
                  {fixedCount > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                      {fixedCount} categorised since this build — rebuild so the report includes them.
                      {report.status === "awaiting_approval" && canApprove && (
                        <Button size="sm" onClick={() => rebuild(report.id)} disabled={busy !== null}>
                          {busy === "rebuild" ? "Rebuilding…" : "Rebuild now"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs text-zinc-500">
                  Subject: <span className="text-zinc-800 dark:text-zinc-200">{shown.subject}</span>
                </p>
                <div className="flex flex-wrap items-center gap-2 py-1 text-xs text-zinc-500">
                  {ytdTickets ? (
                    <>
                      <Button variant="outline" size="sm" asChild>
                        <a href={`${base}/reports/${report.id}/attachment`} download={attachmentName ?? undefined}>
                          <RiDownload2Line className="size-3.5" />
                          Download Excel
                        </a>
                      </Button>
                      <span>
                        {ytdTickets.length === 0
                          ? "No support tickets yet"
                          : `Attached to the email: ${ytdTickets.length} ticket${ytdTickets.length === 1 ? "" : "s"} raised from project start to ${formatDayMonthYear(report.data.reportDate)}`}
                      </span>
                    </>
                  ) : (
                    <span>Rebuild to include the Excel attachment</span>
                  )}
                </div>
                <iframe
                  title={`Support report preview for ${report.reportDate}`}
                  srcDoc={shown.html}
                  sandbox=""
                  className="h-[75vh] min-h-[480px] w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800"
                />
              </div>

              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {report.status === "failed" ? "Retry sending this report?" : "Approve and send this report?"}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      The report exactly as previewed goes to the client now. This can&apos;t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-xs text-zinc-500">Subject</dt>
                      <dd>{shown.subject}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">To</dt>
                      <dd className="break-all">
                        {recipients ? recipients.toEmails.join(", ") || "—" : "Couldn't load recipients"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">CC</dt>
                      <dd className="break-all">{recipients ? recipients.ccEmails.join(", ") || "—" : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Attachment</dt>
                      <dd className="break-all">
                        {ytdTickets ? attachmentName : "None — rebuild to include the Excel attachment"}
                      </dd>
                    </div>
                  </dl>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction disabled={!recipients} onClick={() => void approve(shown)}>
                      {report.status === "failed" ? "Retry send" : "Approve & send"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>The last 60 reports. Unapproved reports lapse when the next day&apos;s is built.</CardDescription>
        </CardHeader>
        <CardContent>
          {list.reports.length === 0 ? (
            <p className="text-sm text-zinc-500">No reports yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    <th className={TH}>Date</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Approver</th>
                    <th className={TH}>Sent at ({zone})</th>
                    <th className={TH}>Recipients</th>
                    <th className={TH}>Delivery</th>
                    <th className={TH} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {list.reports.map((r) => {
                    const count = (r.recipientsTo?.length ?? 0) + (r.recipientsCc?.length ?? 0);
                    const d = delivery[r.id];
                    return (
                      <tr
                        key={r.id}
                        className={cn("bg-white dark:bg-zinc-950", r.id === currentId && "bg-zinc-50 dark:bg-zinc-900")}
                      >
                        <td className={cn(TD, "whitespace-nowrap")}>{formatYmd(r.reportDate)}</td>
                        <td className={TD}>
                          <StatusBadge status={r.status} />
                        </td>
                        <td className={cn(TD, "text-xs text-zinc-600 dark:text-zinc-400")}>{r.approvedByName ?? "–"}</td>
                        <td className={cn(TD, "text-xs whitespace-nowrap text-zinc-500")}>
                          {r.sentAt ? fmtTime(r.sentAt) : "–"}
                        </td>
                        <td className={cn(TD, "text-xs text-zinc-600 dark:text-zinc-400")}>
                          {r.recipientsTo ? (
                            <span title={[...(r.recipientsTo ?? []), ...(r.recipientsCc ?? [])].join(", ")}>{count}</span>
                          ) : (
                            "–"
                          )}
                        </td>
                        <td className={cn(TD, "text-xs")}>
                          {r.providerMessageId && canApprove ? (
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => checkDelivery(r.id)}
                                disabled={d?.loading}
                              >
                                {d?.loading ? "Checking…" : "Check delivery"}
                              </Button>
                              {d?.text && (
                                <span className={cn(d.error ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300")}>
                                  {d.text}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-zinc-400">–</span>
                          )}
                        </td>
                        <td className={cn(TD, "text-right")}>
                          {r.id !== currentId && (
                            <Button variant="ghost" size="xs" onClick={() => setSelectedId(r.id)}>
                              View
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

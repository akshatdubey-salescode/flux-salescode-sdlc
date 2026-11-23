"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RiArrowLeftLine, RiCheckboxCircleLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MovementSlot } from "@/lib/movement/values";
import { api, movementBase } from "./api";
import type { ChangesResponse, ItemView } from "./api-types";
import { MovementBranches } from "./movement-branches";
import { MovementChecklist } from "./movement-checklist";
import { MovementDoneDialog } from "./movement-done-dialog";
import { MovementEvents } from "./movement-events";
import { MovementHeader } from "./movement-header";
import { MovementJiras } from "./movement-jiras";
import { AfterStartBanner, ChangesBanner, NeedsRefreshBanner, RefreshNotice } from "./movement-notices";
import { SignoffBar, type SignerSaveError } from "./movement-signoff-bar";
import { CopyHandled, useFocusReturn } from "./ui-bits";
import { LinkProvider } from "./linkified";
import { useMovement } from "./use-movement";
import { useSummary } from "./use-summary";
import { summaryCopyText } from "./summary";
import { classifyFailure, type MutateResult } from "./logic";
import {
  actionState,
  AUTO_RETURN_MS,
  cancelBody,
  changesBannerVisible,
  changesKey,
  completedBackPath,
  completionPlan,
  deliveryBackPath,
  loadErrorActions,
  openerTestIds,
  skippedPreview,
  refreshNeededCode,
  refreshNeededMessage,
  shouldFetchChanges,
  wholeText,
  type ApiErrorBody,
  type CompletionPlan,
} from "./view-model";

type Tab = "jiras" | "branches" | "checklist" | "history";

export interface MovementPageProps {
  projectId: string;
  deliveryId: string;
  movementId: string;
  /** From the project row, on the server. */
  jiraBaseUrl: string | null;
}

/**
 * The movement as a page of its own (header, notices, four tabs, sign-off bar). It reuses the pieces of the old dialog panel as a normal
 * full-width page; the nested dialogs (Override, Cancel, Signers, Done / Confirm) stay dialogs. The header sticks to the top, the sign-off
 * bar to the bottom. When the movement is completed the page returns to the delivery (see CompletionBanner); "Back to delivery" is always there.
 */
export function MovementPage({ projectId, deliveryId, movementId, jiraBaseUrl }: MovementPageProps) {
  const router = useRouter();
  const backPath = deliveryBackPath(projectId, deliveryId);
  /** Go back to the delivery tab. `completion` makes it reload its list and say what happened (it also refreshes the router cache). */
  const goBack = useCallback(
    (plan?: CompletionPlan) => {
      router.push(plan?.completion ? completedBackPath(projectId, deliveryId, plan.completion) : backPath);
      router.refresh();
    },
    [router, projectId, deliveryId, backPath]
  );
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-testid="movement-page">
      <LinkProvider jiraBaseUrl={jiraBaseUrl}>
        <PageBody deliveryId={deliveryId} movementId={movementId} jiraBaseUrl={jiraBaseUrl} backPath={backPath} goBack={goBack} />
      </LinkProvider>
    </div>
  );
}

/** The standing way back. Shown while the movement loads and once it is loaded; the load-error view has its own button instead (one, not two). */
function BackBar({ backPath }: { backPath: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
      <Button asChild variant="outline" size="sm" className="h-7 gap-1 text-[11px]">
        <Link href={backPath} data-testid="movement-back-to-delivery">
          <RiArrowLeftLine className="size-3.5" /> Back to delivery
        </Link>
      </Button>
    </div>
  );
}

/**
 * "Movement completed" with the way back. `plan.autoReturn` (nothing skipped, nothing failed) returns by itself after AUTO_RETURN_MS unless
 * the user clicks "Stay here"; an attention state never leaves on its own.
 */
export function CompletionBanner({ plan, onBack, onReconfirm, autoReturnMs = AUTO_RETURN_MS }: { plan: CompletionPlan; onBack: () => void; onReconfirm?: () => void; autoReturnMs?: number }) {
  const [stay, setStay] = useState(false);
  const backRef = useRef(onBack);
  useEffect(() => {
    backRef.current = onBack;
  });
  useEffect(() => {
    if (!plan.autoReturn || stay) return;
    const t = setTimeout(() => backRef.current(), autoReturnMs);
    return () => clearTimeout(t); // "Stay here", or the page goes away: no late navigation
  }, [plan.autoReturn, stay, autoReturnMs]);
  const waiting = plan.autoReturn && !stay;
  const skipped = skippedPreview(plan.skippedRows);
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="movement-completed"
      data-state={plan.state}
      className={`space-y-2 rounded-lg border p-3 text-sm ${plan.state === "completed" ? "border-emerald-300 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-amber-400 bg-amber-50/70 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <RiCheckboxCircleLine className="size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold [overflow-wrap:anywhere]">{plan.state === "completed" ? "Movement completed" : "Movement done, needs your attention"}</p>
          <p className="text-xs [overflow-wrap:anywhere]">{plan.message}</p>
          {waiting && <p className="text-xs">Returning to the delivery in a moment…</p>}
        </div>
        {waiting && (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setStay(true)} data-testid="movement-completed-stay">
            Stay here
          </Button>
        )}
        {plan.state === "attention" && onReconfirm && (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onReconfirm} data-testid="movement-completed-reconfirm">
            Confirm delivery statuses
          </Button>
        )}
        <Button size="sm" className="h-7 text-[11px]" onClick={onBack} data-testid="movement-completed-back">
          Back to delivery
        </Button>
      </div>
      {skipped.shown.length > 0 && (
        <ul className="space-y-0.5 text-xs" data-testid="movement-completed-skipped">
          {skipped.shown.map((r) => (
            <li key={r.key} className="[overflow-wrap:anywhere]">
              <span className="font-semibold">{r.key}</span>: {r.reason}
            </li>
          ))}
          {skipped.more > 0 && <li data-testid="movement-completed-skipped-more">and {skipped.more} more</li>}
        </ul>
      )}
    </div>
  );
}

function PageBody({ deliveryId, movementId, jiraBaseUrl, backPath, goBack }: { deliveryId: string; movementId: string; jiraBaseUrl: string | null; backPath: string; goBack: (plan?: CompletionPlan) => void }) {
  const base = movementBase(deliveryId, movementId);
  const [tab, setTab] = useState<Tab>("jiras");
  // The checklist (the big payload) is fetched only when a tab shows it (Checklist, Branches: the record's branch hints) or the user can sign.
  const { view, checklist, loading, loadError, loadStatus, checklistLoading, checklistError, refreshUi, serverRefreshing, refresh, reload, retryChecklist, ensureChecklist, dismissRefreshError, receivedAt } = useMovement(deliveryId, movementId, true, tab === "checklist" || tab === "branches");
  const hashNow = view?.movement.hash ?? null;
  const summary = useSummary(base, tab === "checklist" && !!view && !view.needsRefresh, hashNow);
  const [busy, setBusy] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const doneFocus = useFocusReturn();
  /** Set when the movement is finished (see completionPlan); shows the banner and, when nothing needs reading, returns to the delivery. */
  const [completion, setCompletion] = useState<CompletionPlan | null>(null);
  const [changes, setChanges] = useState<{ key: string; data: ChangesResponse } | null>(null);

  const hash = view?.movement.hash ?? null;
  // "Changed since you signed": only when the server says the user is a signer (permissions.changes: never asked for anyone else) and a reset happened; fetched per hash.
  const fetchChanges = !!view && shouldFetchChanges(view);
  // Keyed on the hash AND the latest reset: signing the current hash hides the banner, and a reset that returns to an older hash fetches again.
  const cKey = view ? changesKey(view) : null;

  useEffect(() => {
    if (!fetchChanges || !hash || !cKey) return;
    const ctl = new AbortController();
    api<ChangesResponse>(`${base}/changes`, { signal: ctl.signal, timeoutMs: 30_000 }).then((r) => {
      if (ctl.signal.aborted || r.aborted || !r.ok || !r.data) return;
      setChanges({ key: cKey, data: r.data });
    });
    return () => ctl.abort();
  }, [fetchChanges, hash, cKey, base]);

  /** Reload the view: the one request every change needs. */
  const afterChange = useCallback(async () => {
    await reload();
  }, [reload]);

  /**
   * Runs one change and says what happened: {ok:true,data}, or {ok:false, reported, message, slot}. `reported` = a toast
   * already told the user (stale hash, refresh needed), so the caller must not repeat it; `message` is always there, so a dialog
   * can keep itself OPEN and show it. After any failure that may have reached the server (timeout, no answer, 5xx) or says the
   * state moved on (403, 409) the view is reloaded BEFORE returning, so the buttons match reality.
   */
  async function mutateDetailed<T>(label: string, fn: () => ReturnType<typeof api<T>>, ok?: (d: T) => string | null): Promise<MutateResult<T>> {
    setBusy(label);
    const r = await fn();
    setBusy(null);
    if (r.aborted) return { ok: false, reported: true, message: "Cancelled", slot: null };
    if (!r.ok) {
      const info = classifyFailure({ status: r.status, timedOut: r.timedOut, body: r.body as ApiErrorBody | null });
      let message = r.error ?? "Something went wrong";
      let reported = false;
      if (info.kind === "stale_hash") {
        message = "The checklist changed while you were reading it. Review the changes, then sign again.";
        toast.error(message);
        reported = true;
      } else if (info.kind === "refresh_needed") {
        // The stored data is unreadable / the last refresh failed: explain, and offer the Refresh that fixes it.
        const code = refreshNeededCode(r.status, r.body as ApiErrorBody | null)!;
        message = refreshNeededMessage(code, r.body as ApiErrorBody | null);
        toast.error(message, view?.permissions.refresh ? { action: { label: "Refresh", onClick: () => void refresh(false) } } : undefined);
        reported = true;
      }
      if (info.reload) await afterChange();
      return { ok: false, reported, message, slot: info.slot };
    }
    const msg = r.data ? ok?.(r.data) : null;
    if (msg) toast.success(msg);
    await afterChange();
    return { ok: true, data: r.data };
  }

  /** The message of a failed change for a dialog (it stays open and shows it), or null on success. */
  const errorOf = <T,>(res: MutateResult<T>): string | null => (res.ok ? null : res.message);
  /** A failure the user has not been told about yet. */
  const toastUnreported = <T,>(res: MutateResult<T>) => {
    if (!res.ok && !res.reported) toast.error(res.message);
  };

  async function tick(issueIds: string[], included: boolean): Promise<boolean> {
    const res = await mutateDetailed("tick", () => api(`${base}/items`, { method: "PATCH", body: { issueIds, included }, timeoutMs: 30_000, fallbackError: "Could not change the selection" }));
    toastUnreported(res);
    return res.ok;
  }

  async function overrideItem(item: ItemView, mode: "override" | "revoke", reason: string, include: boolean): Promise<string | null> {
    return errorOf(
      await mutateDetailed(
        "override",
        () => api(`${base}/items/${encodeURIComponent(item.issueId)}/override`, { method: mode === "override" ? "POST" : "DELETE", body: mode === "override" ? { reason, include } : { reason }, timeoutMs: 30_000, fallbackError: "Could not save the override" }),
        () => (mode === "override" ? `${item.key} overridden${include ? " and ticked" : ""}` : `Override on ${item.key} revoked`)
      )
    );
  }

  async function sign(slot: MovementSlot) {
    if (!checklist) return;
    // The hash of the checklist that is on screen: the server refuses it if the checklist moved on.
    toastUnreported(await mutateDetailed(`sign:${slot}`, () => api(`${base}/sign`, { method: "POST", body: { slot, hash: checklist.hash }, timeoutMs: 30_000, fallbackError: "Could not sign" }), () => "Signed"));
  }

  async function start() {
    // A repeat (double click, a retry) answers alreadyStarted: that is a success, not an error.
    toastUnreported(
      await mutateDetailed("start", () => api<{ alreadyStarted?: boolean }>(`${base}/start`, { method: "POST", timeoutMs: 30_000, fallbackError: "Could not start the deployment" }), (d) => (d.alreadyStarted ? "The deployment was already started" : "Deployment started"))
    );
  }

  async function cancel(reason: string) {
    return errorOf(await mutateDetailed("cancel", () => api(`${base}/cancel`, { method: "POST", body: cancelBody(reason), timeoutMs: 30_000, fallbackError: "Could not cancel" }), () => "Movement cancelled"));
  }

  async function changeSigners(next: Partial<Record<MovementSlot, { email: string; name: string }>>): Promise<SignerSaveError | null> {
    const res = await mutateDetailed("signers", () => api(`${base}/signers`, { method: "PUT", body: next, timeoutMs: 30_000, fallbackError: "Could not change the signers" }), () => "Signers changed");
    return res.ok ? null : { message: res.message, slot: res.slot };
  }

  /** Copy the whole checklist: the loaded one, or fetched now (no tab needs to be open). A refusal is explained here, once, with the Refresh that fixes it. */
  async function copyAll(): Promise<string> {
    const r = await ensureChecklist();
    if (r.ok) return wholeText(r.checklist);
    if (r.stale) toast.error(refreshNeededMessage("inputs_stale", null), view?.permissions.refresh ? { action: { label: "Refresh", onClick: () => void refresh(false) } } : undefined);
    else if (r.message !== "Cancelled") toast.error(`Could not copy: ${r.message}`);
    throw new CopyHandled(r.message);
  }

  /** Copy the summary of all Jiras: the loaded one, or fetched now. */
  async function copySummary(): Promise<string> {
    if (view?.needsRefresh) {
      toast.error(refreshNeededMessage("inputs_stale", null), view.permissions.refresh ? { action: { label: "Refresh", onClick: () => void refresh(false) } } : undefined);
      throw new CopyHandled("needs refresh");
    }
    const s = await summary.ensure();
    if (!s || !view) {
      toast.error("Could not copy: the summary could not be loaded");
      throw new CopyHandled("summary unavailable");
    }
    return summaryCopyText({ environment: view.movement.environment, deliveryName: view.delivery.name, summary: s.summary, source: s.summary.source });
  }

  async function markDone(payload: unknown) {
    const res = await mutateDetailed("done", () => api<{ alreadyDone?: boolean }>(`${base}/done`, { method: "POST", body: payload, timeoutMs: 60_000, fallbackError: "Could not mark it done" }), (d) => (d.alreadyDone ? "It was already marked done" : "Marked done"));
    // demo / uat end here (no status step); prod ends after the confirm step.
    if (res.ok && view && view.movement.environment !== "prod") setCompletion(completionPlan(view.movement.environment, null));
    return errorOf(res);
  }

  if (loading && !view) {
    return (
      <div data-testid="movement-loading" role="status" aria-live="polite">
        <BackBar backPath={backPath} />
        <div className="space-y-2 p-4">
        <h1 className="sr-only">Environment movement</h1>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="space-y-2 p-4" data-testid="movement-load-error">
        <h1 className="text-sm font-semibold">Environment movement</h1>
        <p role="alert" className="text-xs text-destructive">
          {loadError ?? "Could not load the movement"}
        </p>
        {loadErrorActions(loadStatus).retry && (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void reload()} data-testid="movement-load-error-retry">
            Retry
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => goBack()} data-testid="movement-load-error-close">
          Back to delivery
        </Button>
      </div>
    );
  }

  const edit = actionState("edit", view);
  const override = actionState("override", view);
  const revoke = actionState("revoke", view);
  const showChanges = changesBannerVisible(view, changes);
  const refreshRunning = refreshUi.phase === "running" || serverRefreshing;

  return (
    <>
      <BackBar backPath={backPath} />
      <MovementHeader view={view} onCopyAll={copyAll} onCopySummary={copySummary} jiraBaseUrl={jiraBaseUrl} refreshUi={refreshUi} refreshing={serverRefreshing} receivedAt={receivedAt} onRefresh={() => void refresh(false)} exportBase={`${base}/export`} />
      <div className="min-w-0 flex-1 space-y-2 px-3 py-2" data-testid="movement-body">
        {completion && (
          <CompletionBanner
            plan={completion}
            onBack={() => goBack(completion)}
            onReconfirm={
              view.movement.environment === "prod" && view.movement.status === "done"
                ? () => {
                    doneFocus.remember(openerTestIds("done"));
                    setDoneOpen(true);
                  }
                : undefined
            }
          />
        )}
        {view.movement.status === "cancelled" && (
          <div role="status" data-testid="movement-cancelled-banner" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="min-w-0 flex-1 font-medium">This movement was cancelled.</p>
            <Button size="sm" className="h-7 text-[11px]" onClick={() => goBack()} data-testid="movement-cancelled-back">
              Back to delivery
            </Button>
          </div>
        )}
        {loadError && (
          <p role="alert" className="text-xs text-destructive">
            {loadError} (showing the last loaded data)
          </p>
        )}
        <RefreshNotice ui={refreshUi} serverRunning={serverRefreshing} serverError={view.refreshError} canRefresh={view.permissions.refresh} onRetry={() => void refresh(false)} onDismiss={dismissRefreshError} />
        {view.needsRefresh && <NeedsRefreshBanner canRefresh={view.permissions.refresh} running={refreshRunning} onRefresh={() => void refresh(false)} />}
        {view.deliveryChanged && view.deliveryChanged.added + view.deliveryChanged.removed > 0 && !refreshRunning && (
          <p className="rounded-lg border border-border bg-muted/40 p-2 text-xs" role="status" data-testid="movement-delivery-changed">
            {[view.deliveryChanged.added > 0 && `${view.deliveryChanged.added} Jira${view.deliveryChanged.added === 1 ? " was" : "s were"} added to the delivery`, view.deliveryChanged.removed > 0 && `${view.deliveryChanged.removed} removed from it`].filter(Boolean).join(", ")}
            {view.permissions.refresh ? (
              <>
                {" "}— <button type="button" className="underline" onClick={() => void refresh(false)}>Refresh</button> to bring {view.deliveryChanged.added + view.deliveryChanged.removed === 1 ? "it" : "them"} in.
              </>
            ) : (
              " — a delivery manager needs to refresh this movement."
            )}
          </p>
        )}
        {showChanges && changes && <ChangesBanner changes={changes.data} />}
        {view.movement.changedAfterStart && view.movement.status === "in_progress" && <AfterStartBanner />}
        {view.movement.status === "draft" && <p className="rounded-lg border border-dashed border-border p-2 text-xs text-muted-foreground">The Jira review comments have not been read yet. Use Refresh to build the checklist.</p>}

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="flex-wrap" aria-label="Movement sections">
            <TabsTrigger value="jiras" data-testid="movement-tab-jiras">
              Jiras ({view.items.length})
            </TabsTrigger>
            <TabsTrigger value="branches" data-testid="movement-tab-branches">
              Branches
            </TabsTrigger>
            <TabsTrigger value="checklist" data-testid="movement-tab-checklist">
              Checklist{view.checklist.stats.items ? ` (${view.checklist.stats.items})` : ""}
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="movement-tab-history">
              History
            </TabsTrigger>
          </TabsList>
          <TabsContent value="jiras" className="pt-2">
            <MovementJiras status={view.movement.status} items={view.items} checklist={checklist} base={base} refreshKey={view.movement.updatedAt} hasHash={!!view.movement.hash} edit={edit} override={override} revoke={revoke} jiraBaseUrl={jiraBaseUrl} environment={view.movement.environment} hash={view.movement.hash} onCommentSaved={() => void afterChange()} onTick={tick} onOverride={overrideItem} />
          </TabsContent>
          <TabsContent value="branches" className="pt-2">
            <MovementBranches deliveryId={deliveryId} movementId={movementId} checklist={checklist} edit={edit} isManager={view.me.isManager} onSaved={() => void afterChange()} />
          </TabsContent>
          <TabsContent value="checklist" className="pt-2">
            <MovementChecklist checklist={checklist} loading={checklistLoading} error={checklistError} onRetry={retryChecklist} exportBase={`${base}/export`} needsRefresh={view.needsRefresh} heading={{ environment: view.movement.environment, deliveryName: view.delivery.name }} summary={{ state: summary, canGenerate: view.me.isManager, onGenerate: (f) => void summary.generate(f), onRetry: summary.retry }} />
          </TabsContent>
          <TabsContent value="history" className="pt-2">
            <MovementEvents eventsBase={`${base}/events`} refreshKey={view.movement.updatedAt} initial={view.events} />
          </TabsContent>
        </Tabs>
      </div>
      <SignoffBar
        view={view}
        checklist={checklist}
        busy={busy}
        onSign={(s) => void sign(s)}
        onStart={() => void start()}
        onOpenDone={() => {
          doneFocus.remember(openerTestIds("done"));
          setDoneOpen(true);
        }}
        onOpenConfirm={() => {
          doneFocus.remember(openerTestIds("done"));
          setDoneOpen(true);
        }}
        onCancel={cancel}
        onChangeSigners={changeSigners}
      />
      <MovementDoneDialog
        deliveryId={deliveryId}
        movementId={movementId}
        environment={view.movement.environment}
        status={view.movement.status}
        items={view.items}
        open={doneOpen}
        onOpenChange={setDoneOpen}
        onCloseAutoFocus={doneFocus.onCloseAutoFocus}
        onDone={markDone}
        onConfirmed={(counts, skippedRows) => setCompletion(completionPlan("prod", { ...counts, skippedRows }))}
        onConfirmFailed={() => setCompletion(completionPlan("prod", null, true))}
      />
    </>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deliveryStatusLabel, deliveryStatusStyles } from "@/lib/deliveries/status";
import { cn } from "@/lib/utils";
import { api, movementBase } from "./api";
import type { ConfirmOutcome, ItemView, StatusProposals } from "./api-types";
import { Chip } from "./ui-bits";
import {
  buildDonePayload,
  confirmHeading,
  confirmSummary,
  nowStatusAfter,
  doneCounts,
  doneRows,
  fitDonePayload,
  envLabel,
  hasStatusStep,
  initialShown,
  MAX_DONE_COMMENT,
  nextShown,
  nonProdDoneHint,
  notSelectedCount,
  notSelectedNote,
  proposalSkip,
  proposedStatusFor,
  type DoneResult,
  type SkippedRow,
  type DoneRow,
} from "./view-model";

type DonePayload = ReturnType<typeof buildDonePayload>;

/**
 * "Mark done" (the deployer): step 1 lists the included Jiras with a moved / held choice and the
 * delivery status Flux would set for each; marking it done calls /done. Step 2 (movement is done)
 * loads Flux's proposal, and one click calls confirm-statuses, then shows what was updated and
 * which rows were skipped and why. The dialog follows the movement's own status, so a deployer who
 * comes back later lands in step 2. Statuses are only a fact after a PROD movement: for demo / uat there
 * is no confirm step, the server's note is shown instead and the dialog just closes.
 */
export function MovementDoneDialog({
  deliveryId,
  movementId,
  environment,
  status,
  items,
  open,
  onOpenChange,
  onDone,
  onConfirmed,
  onConfirmFailed,
  onCloseAutoFocus,
}: {
  deliveryId: string;
  movementId: string;
  environment: string;
  status: string;
  items: readonly ItemView[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** POST /done; resolves to an error message or null. */
  onDone: (payload: DonePayload) => Promise<string | null>;
  /** Focus goes back to the control that opened the dialog (see useFocusReturn). */
  onCloseAutoFocus: (e: Event) => void;
  /**
   * The confirm step finished writing: the counts say whether rows were skipped. With none skipped the dialog closes by itself (the page
   * shows "Movement completed" and returns to the delivery); with some it stays open so their reasons can be read.
   */
  onConfirmed: (counts: { updated: number; unchanged: number; skipped: number }, skippedRows: SkippedRow[]) => void;
  /** The confirm step failed (nothing to return to yet). */
  onConfirmFailed: () => void;
}) {
  const close = (o: boolean) => onOpenChange(o);
  return (
    <Dialog open={open} onOpenChange={close}>
      {open &&
        (status === "done" ? (
          hasStatusStep(environment) ? (
            <ConfirmStep deliveryId={deliveryId} movementId={movementId} onClose={() => close(false)} onConfirmed={(c, rows) => {
                onConfirmed(c, rows);
                if (c.skipped === 0) close(false);
              }} onConfirmFailed={onConfirmFailed} onCloseAutoFocus={onCloseAutoFocus} />
          ) : (
            <NonProdFinished environment={environment} onClose={() => close(false)} onCloseAutoFocus={onCloseAutoFocus} />
          )
        ) : (
          <DoneStep environment={environment} items={items} onClose={() => close(false)} onDone={onDone} onCloseAutoFocus={onCloseAutoFocus} />
        ))}
    </Dialog>
  );
}

function DoneStep({ environment, items, onClose, onDone, onCloseAutoFocus }: { environment: string; items: readonly ItemView[]; onClose: () => void; onDone: (p: DonePayload) => Promise<string | null>; onCloseAutoFocus: (e: Event) => void }) {
  const [rows, setRows] = useState<DoneRow[]>(() => doneRows(items));
  const [comment, setComment] = useState("");
  const [shown, setShown] = useState(initialShown(rows.length, 50));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heldOut = notSelectedCount(items);
  const counts = doneCounts(rows, heldOut);
  const fit = useMemo(() => fitDonePayload(rows, comment), [rows, comment]);
  const prod = hasStatusStep(environment);

  function patch(i: number, p: Partial<DoneRow>) {
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  }
  async function submit() {
    setBusy(true);
    setError(null);
    const err = await onDone(fit.payload);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl" data-testid="movement-done-dialog" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader>
        <DialogTitle>Mark the deployment done</DialogTitle>
        <DialogDescription>
          Say what was actually moved. {prod ? "Next, Flux proposes Delivered for moved Jiras and Not delivered for held ones, and you confirm. " : ""}{notSelectedNote(heldOut)}
        </DialogDescription>
      </DialogHeader>
      {!prod && (
        <p className="rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground" data-testid="movement-nonprod-note">
          {nonProdDoneHint(environment)}
        </p>
      )}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto" data-testid="movement-done-rows">
        {rows.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No Jira was selected for this movement.</p>}
        {rows.slice(0, shown).map((r, i) => (
          <div key={r.issueId} data-testid={`movement-done-row-${r.key}`} className={cn("rounded-md border p-2 text-xs", r.result === "held" ? "border-amber-300 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20" : "border-border")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{r.key}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={r.summary}>
                {r.summary}
              </span>
              <div role="radiogroup" aria-label={`Result for ${r.key}`} className="flex gap-1">
                {(["moved", "held"] as DoneResult[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={r.result === v}
                    data-testid={`movement-done-${v}-${r.key}`}
                    onClick={() => patch(i, { result: v })}
                    className={cn("rounded-md border px-2 py-0.5 text-[11px]", r.result === v ? "border-primary bg-primary/10 font-semibold" : "border-border text-muted-foreground")}
                  >
                    {v === "moved" ? "Moved" : "Held"}
                  </button>
                ))}
              </div>
              {prod && (
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", deliveryStatusStyles(proposedStatusFor(r.result)).badge)} title="Status Flux will propose">
                  {deliveryStatusLabel(proposedStatusFor(r.result))}
                </span>
              )}
            </div>
            {r.result === "held" && (
              <Input value={r.comment} onChange={(e) => patch(i, { comment: e.target.value })} maxLength={MAX_DONE_COMMENT} placeholder="Why was it held? (optional)" aria-label={`Why ${r.key} was held`} className="mt-1 h-7 text-xs" />
            )}
          </div>
        ))}
        {shown < rows.length && (
          <Button variant="outline" size="sm" className="h-7 text-[11px]" data-testid="movement-done-more" onClick={() => setShown((n) => nextShown(n, rows.length, 50))}>
            Show more ({rows.length - shown} not shown)
          </Button>
        )}
      </div>
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder="Comment for the record (optional)" aria-label="Comment" className="min-h-14" data-testid="movement-done-comment" />
      {fit.trimmed && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400" data-testid="movement-done-trimmed">
          Some comments were shortened to fit the size the server accepts (about 48 KB for the whole request).
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive" data-testid="movement-done-error">
          {error}
        </p>
      )}
      <DialogFooter className="items-center">
        <span className="text-[11px] text-muted-foreground sm:mr-auto">
          {counts.moved} moved, {counts.held} held{counts.notSelected > 0 ? ` (${counts.notSelected} not selected)` : ""}
        </span>
        <Button variant="outline" onClick={onClose} disabled={busy} data-testid="movement-done-cancel">
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy} data-testid="movement-done-submit">
          {busy ? "Marking done…" : "Mark done"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ConfirmStep({ deliveryId, movementId, onClose, onConfirmed, onConfirmFailed, onCloseAutoFocus }: { deliveryId: string; movementId: string; onClose: () => void; onConfirmed: (c: { updated: number; unchanged: number; skipped: number }, rows: SkippedRow[]) => void; onConfirmFailed: () => void; onCloseAutoFocus: (e: Event) => void }) {
  const base = movementBase(deliveryId, movementId);
  const [proposals, setProposals] = useState<StatusProposals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ConfirmOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState(50);

  useEffect(() => {
    const ctl = new AbortController();
    api<StatusProposals>(`${base}/confirm-statuses`, { signal: ctl.signal, timeoutMs: 30_000, fallbackError: "Could not load the proposed statuses" }).then((r) => {
      if (ctl.signal.aborted || r.aborted) return;
      if (!r.ok || !r.data) setError(r.error ?? "Could not load the proposed statuses");
      else {
        setError(null);
        setProposals(r.data);
      }
    });
    return () => ctl.abort();
  }, [base, attempt]);

  const resultByIssue = useMemo(() => new Map((outcome?.results ?? []).map((r) => [r.issueId, r])), [outcome]);

  async function confirm() {
    setBusy(true);
    setError(null);
    const r = await api<ConfirmOutcome>(`${base}/confirm-statuses`, { method: "POST", body: {}, timeoutMs: 120_000, fallbackError: "Could not confirm the statuses" });
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(r.error);
      onConfirmFailed();
      return;
    }
    setOutcome(r.data);
    toast.success(`Statuses: ${confirmSummary(r.data.counts)}`);
    onConfirmed(
      r.data.counts,
      r.data.results.filter((x) => x.outcome === "skipped").map((x) => ({ key: x.key, reason: x.reason ?? "left as it is" }))
    );
  }

  return (
    <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl" data-testid="movement-confirm-dialog" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader>
        <DialogTitle>Confirm the delivery statuses</DialogTitle>
        <DialogDescription>Flux proposes Delivered for the Jiras that moved and Not delivered for the others. Confirming writes the statuses and their history; a Jira whose status is gated (for example, test cases not signed off) is skipped with the reason. Confirming twice changes nothing.</DialogDescription>
      </DialogHeader>
      {error && (
        <div role="alert" className="flex items-center gap-2 text-xs text-destructive" data-testid="movement-confirm-error">
          <span className="flex-1">{error}</span>
          {!proposals && (
            <Button size="sm" variant="outline" className="h-6 text-[11px]" data-testid="movement-confirm-retry" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </Button>
          )}
        </div>
      )}
      {!proposals && !error && <p className="text-xs text-muted-foreground">Loading the proposal…</p>}
      {proposals && (
        <>
          <p className="text-xs font-semibold" data-testid="movement-confirm-counts">
            {confirmHeading(proposals, outcome?.counts ?? null)}
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="movement-confirm-rows">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-popover text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Jira</th>
                  <th className="py-1 pr-2 font-medium">Now</th>
                  <th className="py-1 pr-2 font-medium">Proposed</th>
                  <th className="py-1 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {proposals.proposals.slice(0, shown).map((p) => {
                  const res = resultByIssue.get(p.issueId);
                  return (
                    <tr key={p.issueId} className="border-t border-border align-top" data-testid={`movement-confirm-row-${p.key}`} data-outcome={res?.outcome}>
                      <td className="py-1 pr-2">
                        <span className="font-semibold">{p.key}</span>
                        <p className="max-w-56 truncate text-muted-foreground" title={p.summary}>
                          {p.summary}
                        </p>
                      </td>
                      <td className="py-1 pr-2" data-testid={`movement-confirm-now-${p.key}`}>{deliveryStatusLabel(nowStatusAfter(p.current, p.to, res?.outcome))}</td>
                      <td className="py-1 pr-2">
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", deliveryStatusStyles(p.to).badge)}>{deliveryStatusLabel(p.to)}</span>
                        {!res && !p.willChange && !proposalSkip(p) && <span className="ml-1 text-[11px] text-muted-foreground">already</span>}
                        {proposalSkip(p) && (
                          <p className="text-[11px] text-amber-700 [overflow-wrap:anywhere] dark:text-amber-400" data-testid={`movement-confirm-skip-${p.key}`}>
                            Left as it is: {proposalSkip(p)}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{p.reason}</p>
                      </td>
                      <td className="py-1">
                        {res ? (
                          <>
                            <Chip tone={res.outcome === "updated" ? "ok" : res.outcome === "skipped" ? "danger" : "muted"}>{res.outcome}</Chip>
                            {res.reason && <p className="text-[11px] text-red-700 [overflow-wrap:anywhere] dark:text-red-400">{res.reason}</p>}
                          </>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown < proposals.proposals.length && (
              <Button variant="outline" size="sm" className="mt-1 h-7 text-[11px]" data-testid="movement-confirm-more" onClick={() => setShown((n) => nextShown(n, proposals.proposals.length, 50))}>
                Show more ({proposals.proposals.length - shown} not shown)
              </Button>
            )}
          </div>
        </>
      )}
      {outcome && (
        <p className="text-xs font-semibold" data-testid="movement-confirm-result">
          Done: {confirmSummary(outcome.counts)}
          {outcome.counts.skipped > 0 ? ". Skipped rows are listed above with their reason; fix the gate and confirm again." : "."}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy} data-testid="movement-confirm-close">
          Close
        </Button>
        <Button onClick={confirm} disabled={busy || !proposals} data-testid="movement-confirm-submit">
          {busy ? "Confirming…" : outcome ? "Confirm again" : "Confirm statuses"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * A demo / uat movement after "done": no proposal and no confirm, so the server is NOT asked for one (GET confirm-statuses would
 * only answer with its note): the note is shown straight from the movement's environment.
 */
function NonProdFinished({ environment, onClose, onCloseAutoFocus }: { environment: string; onClose: () => void; onCloseAutoFocus: (e: Event) => void }) {
  return (
    <DialogContent className="sm:max-w-md" data-testid="movement-confirm-dialog" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader>
        <DialogTitle>The {envLabel(environment)} movement is done</DialogTitle>
        <DialogDescription>There is nothing more to confirm.</DialogDescription>
      </DialogHeader>
      <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground" data-testid="movement-nonprod-note">
        {nonProdDoneHint(environment)}
      </p>
      <DialogFooter>
        <Button onClick={onClose} data-testid="movement-nonprod-close">
          Close
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

"use client";

import { useMemo, useState } from "react";
import { RiCheckboxCircleLine, RiPencilLine, RiTimeLine, RiUserLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { MOVEMENT_SLOT_VALUES, type MovementSlot } from "@/lib/movement/values";
import type { Checklist, MovementView } from "./api-types";
import { EMPTY_SIGNERS, SignerFields, signersComplete, type SignerErrors, type SignerPeople } from "./signer-fields";
import { Chip, GuardedButton, useFocusReturn } from "./ui-bits";
import { actionState, formatIst, hasStatusStep, openerTestIds, pendingActionReason, signerConflicts, signerRows, statusLabel, type SignerRow, type Tone } from "./view-model";

const STATE_TONE: Record<SignerRow["state"], Tone> = { signed: "ok", waiting: "muted", you: "info", stale: "warn" };
const STATE_TEXT: Record<SignerRow["state"], string> = { signed: "Signed", waiting: "Waiting", you: "Your turn", stale: "Signed an older checklist" };

/** A refused signer change: the message, and the slot it is about when the server named one (400 "not a Flux user"). */
export interface SignerSaveError {
  message: string;
  slot: MovementSlot | null;
}

export interface SignoffBarProps {
  view: MovementView;
  checklist: Checklist | null;
  busy: string | null;
  onSign: (slot: MovementSlot) => void;
  onStart: () => void;
  onOpenDone: () => void;
  onOpenConfirm: () => void;
  onCancel: (reason: string) => Promise<string | null>;
  onChangeSigners: (next: Partial<Record<MovementSlot, { email: string; name: string }>>) => Promise<SignerSaveError | null>;
}

/** The signers with their state, each signer's own Sign button, and Start / Mark done / Confirm / Cancel. */
export function SignoffBar({ view, checklist, busy, onSign, onStart, onOpenDone, onOpenConfirm, onCancel, onChangeSigners }: SignoffBarProps) {
  const rows = useMemo(() => signerRows(view, checklist?.hash ?? null), [view, checklist]);
  const status = view.movement.status;
  const start = actionState("start", view);
  const done = actionState("done", view);
  const confirm = actionState("confirm", view);
  const cancel = actionState("cancel", view);
  const setSigners = actionState("setSigners", view);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [signersOpen, setSignersOpen] = useState(false);
  // Under 640 px the signer cards fold into one summary row (a big part of a phone's height otherwise); the viewer's own Sign stays in it.
  const [expanded, setExpanded] = useState(false);
  const focus = useFocusReturn();
  const signedCount = rows.filter((r) => r.state === "signed").length;
  const frozen = status === "done" || status === "cancelled";
  const mine = rows.filter((r) => r.state === "you");
  // A disabled control says WHY in text, not only in a tooltip: Sign (the viewer's own slot), and Start / Done / Confirm for the deployer or an admin.
  const signBlocked = mine.filter((r) => !r.canSign && r.signReason);
  const actionReason = pendingActionReason({ status, environment: view.movement.environment, me: view.me }, { start, done, confirm });

  return (
    <div className="sticky bottom-0 z-20 space-y-2 border-t border-border bg-background px-3 py-2" data-testid="movement-signoff-bar">
      <div className="flex flex-wrap items-center gap-2 sm:hidden" data-testid="movement-signoff-summary">
        <span className="text-[11px] font-semibold">
          Sign-offs {signedCount}/{rows.length}
        </span>
        {mine.map((r) => (
          <GuardedButton key={r.slot} size="sm" className="h-7 text-[11px]" disabled={!r.canSign || busy !== null} reason={r.signReason} onClick={() => onSign(r.slot)} data-testid={`movement-sign-compact-${r.slot}`}>
            {busy === `sign:${r.slot}` ? "Signing…" : `Sign as ${r.label}`}
          </GuardedButton>
        ))}
        <Button variant="ghost" size="sm" className="ml-auto h-7 text-[11px]" aria-expanded={expanded} aria-controls="movement-signers-detail" onClick={() => setExpanded((v) => !v)} data-testid="movement-signoff-expand">
          {expanded ? "Hide signers" : "Show signers"}
        </Button>
        {signBlocked.length > 0 && (
          <p className="w-full text-[11px] text-muted-foreground" data-testid="movement-sign-reason-compact">
            {signBlocked[0].signReason}
          </p>
        )}
      </div>
      <div id="movement-signers-detail" className={cn("flex-wrap items-stretch gap-2", expanded ? "flex" : "hidden sm:flex")}>
        {rows.map((r) => (
          <div key={r.slot} data-testid={`movement-signer-${r.slot}`} data-state={r.state} className={cn("flex min-w-44 flex-1 items-center gap-2 rounded-lg border p-2", r.state === "you" ? "border-sky-400 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/20" : "border-border")}>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1 text-[11px] font-semibold">
                {r.label}
                {r.isMe && (
                  <Chip tone="info" testId={`movement-signer-me-${r.slot}`} title="You hold this slot">
                    You
                  </Chip>
                )}
                <Chip tone={STATE_TONE[r.state]} testId={`movement-signer-state-${r.slot}`}>
                  {r.state === "signed" ? <RiCheckboxCircleLine className="size-3" /> : r.state === "you" ? <RiUserLine className="size-3" /> : <RiTimeLine className="size-3" />}
                  {STATE_TEXT[r.state]}
                </Chip>
              </p>
              <p className="truncate text-[11px] text-muted-foreground" title={r.email}>
                {r.name || r.email}
              </p>
              {r.signedAt && r.state === "signed" && <p className="text-[10px] text-muted-foreground">{formatIst(r.signedAt)}</p>}
              {r.state === "you" && !r.canSign && r.signReason && (
                <p className="text-[10px] text-amber-700 dark:text-amber-400" data-testid={`movement-sign-reason-${r.slot}`}>
                  {r.signReason}
                </p>
              )}
            </div>
            {r.state === "you" && (
              <GuardedButton size="sm" className="h-7 text-[11px]" disabled={!r.canSign || busy !== null} reason={r.signReason} onClick={() => onSign(r.slot)} data-testid={`movement-sign-${r.slot}`}>
                {busy === `sign:${r.slot}` ? "Signing…" : "Sign"}
              </GuardedButton>
            )}
          </div>
        ))}
      </div>
      {mine.length > 0 && <p className={cn("text-[11px] text-muted-foreground", !expanded && "hidden sm:block")}>Signing says you reviewed the checklist as shown now. If it changes, the sign-offs are cleared and you sign again.</p>}

      <div className="flex flex-wrap items-center gap-2">
        {setSigners.allowed && (
          <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => {
              focus.remember(openerTestIds("signers"));
              setSignersOpen(true);
            }}
            data-testid="movement-change-signers"
          >
            <RiPencilLine className="size-3.5" /> Change signers
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {frozen && <span className="text-[11px] text-muted-foreground">{status === "done" ? `Done${view.movement.doneAt ? ` ${formatIst(view.movement.doneAt)}` : ""}${view.movement.doneByName ? ` by ${view.movement.doneByName}` : ""}` : "Cancelled"}</span>}
          {!frozen && (
            <GuardedButton variant="ghost" size="sm" className="h-7 text-[11px] text-destructive" disabled={!cancel.allowed || busy !== null} reason={cancel.reason}
              onClick={() => {
                focus.remember(openerTestIds("cancel"));
                setCancelOpen(true);
              }}
              data-testid="movement-cancel"
            >
              Cancel movement
            </GuardedButton>
          )}
          {status !== "in_progress" && !frozen && (
            <GuardedButton size="sm" className="h-7 text-[11px]" disabled={!start.allowed || busy !== null} reason={start.reason} onClick={onStart} data-testid="movement-start">
              {busy === "start" ? "Starting…" : "Start deployment"}
            </GuardedButton>
          )}
          {status === "in_progress" && (
            <GuardedButton size="sm" className="h-7 text-[11px]" disabled={!done.allowed || busy !== null} reason={done.reason} onClick={onOpenDone} data-testid="movement-mark-done">
              Mark done
            </GuardedButton>
          )}
          {status === "done" && !hasStatusStep(view.movement.environment) && (
            <span className="text-[11px] text-muted-foreground" data-testid="movement-nonprod-bar-note">
              Nothing more to do: delivery statuses are only set after a Prod movement.
            </span>
          )}
          {status === "done" && hasStatusStep(view.movement.environment) && (
            <GuardedButton size="sm" className="h-7 text-[11px]" disabled={!confirm.allowed || busy !== null} reason={confirm.reason} onClick={onOpenConfirm} data-testid="movement-confirm-statuses">
              Confirm delivery statuses
            </GuardedButton>
          )}
        </div>
      </div>

      {actionReason && (
        <p className="text-right text-[11px] text-muted-foreground" data-testid={`movement-action-reason-${actionReason.action}`}>
          {actionReason.reason}
        </p>
      )}

      <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} status={statusLabel(status)} onCancel={onCancel} onCloseAutoFocus={focus.onCloseAutoFocus} />
      <Dialog open={signersOpen} onOpenChange={setSignersOpen}>
        {signersOpen && <SignersForm key="signers" view={view} onClose={() => setSignersOpen(false)} onSave={onChangeSigners} onCloseAutoFocus={focus.onCloseAutoFocus} />}
      </Dialog>
    </div>
  );
}

function CancelDialog({ open, onOpenChange, status, onCancel, onCloseAutoFocus }: { open: boolean; onOpenChange: (o: boolean) => void; status: string; onCancel: (reason: string) => Promise<string | null>; onCloseAutoFocus: (e: Event) => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {open && <CancelForm status={status} onClose={() => onOpenChange(false)} onCancel={onCancel} onCloseAutoFocus={onCloseAutoFocus} />}
    </AlertDialog>
  );
}

function CancelForm({ status, onClose, onCancel, onCloseAutoFocus }: { status: string; onClose: () => void; onCancel: (reason: string) => Promise<string | null>; onCloseAutoFocus: (e: Event) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AlertDialogContent data-testid="movement-cancel-dialog" onCloseAutoFocus={onCloseAutoFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle>Cancel this movement?</AlertDialogTitle>
        <AlertDialogDescription>It is {status.toLowerCase()} now. Cancelling frees the environment for a new movement; the checklist and the sign-offs of this one stay in the history.</AlertDialogDescription>
      </AlertDialogHeader>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Reason (optional)" aria-label="Reason for cancelling" className="min-h-16" data-testid="movement-cancel-reason" />
      {error && (
        <p role="alert" className="text-xs text-destructive" data-testid="movement-cancel-error">
          {error}
        </p>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy} data-testid="movement-cancel-keep">
          Keep it
        </AlertDialogCancel>
        <Button
          variant="destructive"
          disabled={busy}
          data-testid="movement-cancel-confirm"
          onClick={async () => {
            setBusy(true);
            const err = await onCancel(reason.trim());
            setBusy(false);
            if (err) setError(err);
            else onClose();
          }}
        >
          {busy ? "Cancelling…" : "Cancel movement"}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

function SignersForm({ view, onClose, onSave, onCloseAutoFocus }: { view: MovementView; onClose: () => void; onSave: SignoffBarProps["onChangeSigners"]; onCloseAutoFocus: (e: Event) => void }) {
  const initial = useMemo<SignerPeople>(() => {
    const out: SignerPeople = { ...EMPTY_SIGNERS };
    // a slot nobody holds (the QA lead of a movement made before that slot existed) starts empty
    for (const s of view.signers) out[s.slot] = s.email ? { email: s.email, name: s.name ?? s.email } : null;
    return out;
  }, [view.signers]);
  const [value, setValue] = useState<SignerPeople>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slotErrors, setSlotErrors] = useState<SignerErrors>({});
  const changed = MOVEMENT_SLOT_VALUES.filter((s) => value[s] && value[s]!.email.toLowerCase() !== (initial[s]?.email ?? "").toLowerCase());
  // Same person in two slots: the server refuses it; say so on the fields and keep Save off.
  const conflicts = signerConflicts(value);
  return (
    <DialogContent className="sm:max-w-md" data-testid="movement-signers-dialog" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader>
        <DialogTitle>Change signers</DialogTitle>
        <DialogDescription>A changed slot loses its sign-off and the new person is told. Possible until everyone has signed.</DialogDescription>
      </DialogHeader>
      <SignerFields
        deliveryId={view.delivery.id}
        value={value}
        onChange={(next) => {
          setValue(next);
          setSlotErrors({});
        }}
        errors={{ ...conflicts, ...slotErrors }}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive" data-testid="movement-signers-error">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy} data-testid="movement-signers-cancel">
          Cancel
        </Button>
        <Button
          disabled={busy || changed.length === 0 || !signersComplete(value) || Object.keys(conflicts).length > 0}
          data-testid="movement-signers-save"
          onClick={async () => {
            setBusy(true);
            setError(null);
            setSlotErrors({});
            const err = await onSave(Object.fromEntries(changed.map((s) => [s, value[s]!])));
            setBusy(false);
            if (!err) onClose();
            else if (err.slot) setSlotErrors({ [err.slot]: err.message });
            else setError(err.message);
          }}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { MovementEnvironment } from "@/lib/movement/values";
import { api, movementsBase } from "./api";
import type { MovementListItem, RefreshResult } from "./api-types";
import { EMPTY_SIGNERS, SignerFields, signersComplete, type SignerErrors, type SignerPeople } from "./signer-fields";
import { useNow } from "./ui-bits";
import { createDialogUi, describeCreateError, ENV_OPTIONS, envLabel, signerConflicts, slotFromError, type ApiErrorBody } from "./view-model";

/** Server maxDuration is 300 s; past this we stop waiting and look the movement up instead. */
const CREATE_TIMEOUT_MS = 290_000;

/**
 * Start a movement: environment + the three signers, then the create call, which also runs the
 * first refresh (reads the Jira comments: it can take a minute or more for a big delivery). The
 * dialog cannot be closed while that runs; a timeout or a 409 "already exists" is resolved by
 * looking the live movement up, never by blindly creating a second one.
 */
export function MovementCreateDialog({
  deliveryId,
  deliveryName,
  itemCount,
  environment,
  open,
  onOpenChange,
  onCreated,
  onCloseAutoFocus,
}: {
  deliveryId: string;
  deliveryName: string;
  itemCount: number;
  environment: MovementEnvironment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The movement to open (created now, or found because it already existed). */
  onCreated: (movementId: string, note: string | null) => void;
  /** Where focus goes when the dialog closes (the Start button, or nowhere when the panel is opening). */
  onCloseAutoFocus: (e: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => onOpenChange(o)}>
      {open && <CreateForm key={environment} deliveryId={deliveryId} deliveryName={deliveryName} itemCount={itemCount} environment={environment} onOpenChange={onOpenChange} onCreated={onCreated} onCloseAutoFocus={onCloseAutoFocus} />}
    </Dialog>
  );
}

function CreateForm({ deliveryId, deliveryName, itemCount, environment, onOpenChange, onCreated, onCloseAutoFocus }: { deliveryId: string; deliveryName: string; itemCount: number; environment: MovementEnvironment; onOpenChange: (o: boolean) => void; onCreated: (id: string, note: string | null) => void; onCloseAutoFocus: (e: Event) => void }) {
  const [env, setEnv] = useState<MovementEnvironment>(environment);
  const [signers, setSigners] = useState<SignerPeople>(EMPTY_SIGNERS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slotErrors, setSlotErrors] = useState<SignerErrors>({});
  /** 409 delivery_closed: nothing can be created for this delivery, so the submit stays off. */
  const [closed, setClosed] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  /** Created (or found): the page is opening. The dialog stays up, busy, until the navigation takes over, so there is no dead moment. */
  const [opening, setOpening] = useState(false);
  const now = useNow(busy);
  const elapsed = busy ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  // Two slots holding the same person is refused by the server (400); say it on the fields before asking.
  const conflicts = signerConflicts(signers);
  const distinct = Object.keys(conflicts).length === 0;
  const ready = signersComplete(signers) && distinct;
  const ui = createDialogUi(busy, opening);

  async function findLive(target: MovementEnvironment): Promise<MovementListItem | null> {
    const r = await api<{ movements: MovementListItem[] }>(movementsBase(deliveryId), { timeoutMs: 30_000 });
    return r.data?.movements.find((m) => m.environment === target && m.status !== "cancelled") ?? null;
  }

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setSlotErrors({});
    setStartedAt(Date.now());
    const body = { environment: env, signers: Object.fromEntries((["deployer", "ba", "lead"] as const).map((s) => [s, { email: signers[s]!.email, name: signers[s]!.name }])) };
    const r = await api<{ movementId: string; refresh: RefreshResult }>(movementsBase(deliveryId), { method: "POST", body, timeoutMs: CREATE_TIMEOUT_MS, fallbackError: "Could not create the movement" });
    if (r.ok && r.data) {
      setOpening(true); // stays busy: the tab navigates to the movement's page
      toast.info("Opening the movement…", { id: "opening-movement" });
      const refreshError = r.data.refresh?.error;
      onCreated(r.data.movementId, refreshError ? `The movement was created, but reading Jira failed: ${refreshError}. Use Refresh to retry.` : null);
      return;
    }
    // It may exist even though we did not get the answer (timeout, dropped connection, double submit).
    if (r.timedOut || r.status === 0 || r.status >= 500 || (r.status === 409 && (r.body as { code?: unknown } | null)?.code === "movement_exists")) {
      const live = await findLive(env);
      if (live) {
        setOpening(true);
        toast.info(r.status === 409 ? `There was already a live ${envLabel(env)} movement; opening it…` : "The movement was created; opening it…", { id: "opening-movement" });
        onCreated(live.id, live.status === "draft" ? "The first read of the Jira comments did not finish. Use Refresh to read them again." : null);
        return;
      }
    }
    setBusy(false);
    const failure = r.body as ApiErrorBody | null;
    const slot = r.status === 400 ? slotFromError(failure) : null;
    if (slot) {
      // "The ba (x@y.com) is not a Flux user": shown on that field, the other fields stay as they are.
      setSlotErrors({ [slot]: describeCreateError(r.status, failure, "This person cannot be a signer") });
      return;
    }
    if (r.status === 409 && failure?.code === "delivery_closed") setClosed(true);
    setError(describeCreateError(r.status, failure, r.error ?? "Could not create the movement"));
  }

  return (
    <DialogContent
      className="sm:max-w-lg"
      data-testid="movement-create-dialog"
      onCloseAutoFocus={onCloseAutoFocus}
      onInteractOutside={(e) => !ui.canDismiss && e.preventDefault()}
      onEscapeKeyDown={(e) => !ui.canDismiss && e.preventDefault()}
      showCloseButton={ui.canDismiss}
    >
      <DialogHeader>
        <DialogTitle>Start a movement to {envLabel(env)}</DialogTitle>
        <DialogDescription>
          {deliveryName} · {itemCount} Jira{itemCount === 1 ? "" : "s"}. Flux reads the review comments on the Jiras and builds one checklist. All three people below must sign it before the deployment starts.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <fieldset disabled={busy} className="space-y-1">
          <legend className="text-xs font-medium">Environment</legend>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Environment">
            {ENV_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={env === o.value}
                data-testid={`movement-create-env-${o.value}`}
                onClick={() => setEnv(o.value)}
                className={cn("rounded-md border px-3 py-1 text-xs", env === o.value ? "border-primary bg-primary/10 font-semibold" : "border-border text-muted-foreground hover:text-foreground")}
              >
                {o.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className={cn(busy && "pointer-events-none opacity-60")} aria-disabled={busy}>
          <SignerFields
            deliveryId={deliveryId}
            value={signers}
            onChange={(next) => {
              setSigners(next);
              setSlotErrors({});
            }}
            errors={{ ...conflicts, ...slotErrors }}
          />
        </div>
      </div>

      {busy && (
        <div role="status" aria-live="polite" className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2 text-xs" data-testid="movement-create-progress">
          <RiLoader4Line className="mt-0.5 size-4 shrink-0 animate-spin" />
          <div>
            <p className="font-medium">{opening ? "Opening the movement…" : elapsed < 4 ? "Creating the movement…" : "Reading Jira comments…"}</p>
            <p className="text-muted-foreground">{opening ? "Taking you to the movement." : `${elapsed}s. A delivery of many Jiras can take a minute or two. Keep this window open.`}</p>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive" data-testid="movement-create-error">
          {error}
        </p>
      )}
      <CreateFooter ui={ui} busy={busy} disabled={!ready || busy || closed} retry={!!error && !closed} onClose={() => onOpenChange(false)} onSubmit={submit} />
    </DialogContent>
  );
}

/** Cancel / Close and Create. "Close" is always enabled once the movement exists and the page is opening: the dialog is never a trap. */
export function CreateFooter({ ui, busy, disabled, retry, onClose, onSubmit }: { ui: ReturnType<typeof createDialogUi>; busy: boolean; disabled: boolean; retry: boolean; onClose: () => void; onSubmit: () => void }) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onClose} disabled={ui.cancelDisabled} data-testid="movement-create-cancel">
        {ui.cancelLabel}
      </Button>
      <Button onClick={onSubmit} disabled={disabled} data-testid="movement-create-submit">
        {busy ? "Working…" : retry ? "Retry" : "Create movement"}
      </Button>
    </DialogFooter>
  );
}

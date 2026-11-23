"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { RiRocketLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import type { DeliveryWithItems } from "@/lib/deliveries/entries";
import type { MovementEnvironment } from "@/lib/movement/values";
import { MovementCreateDialog } from "./movement-create-dialog";
import { Chip, GuardedButton, useFocusReturn } from "./ui-bits";
import { useDeliveryMovements, type MovementChipLike } from "./use-delivery-movements";
import { createReleaseReason, envChips, envLabel, movementPagePath, openerTestIds, OPENING_TIMEOUT_MS, startAction, statusLabel, statusTone, type CreateReleaseReason } from "./view-model";

/**
 * The "Movement" strip of a delivery card: one chip per environment (Demo / UAT / Prod) with the state of its movement, and "Start movement
 * to <env>" for managers. A chip with a movement is a LINK to that movement's own page (it no longer opens a dialog); creating one
 * (the small create dialog picks the three signers) navigates to its page too, through `onOpenMovement`. The chips arrive with the
 * deliveries list (`delivery.movements`): no request per card. A completed delivery cannot get a new movement (the server answers 409
 * delivery_closed), so "Start movement" is not offered there; its existing movements can still be opened.
 */
export function MovementSection({
  delivery,
  canManage,
  onOpenMovement,
}: {
  delivery: Pick<DeliveryWithItems, "id" | "projectId" | "name" | "items" | "completedAt"> & { movements?: readonly MovementChipLike[] };
  canManage: boolean;
  /** Go to the movement's page (the tab owns the router). */
  onOpenMovement: (movementId: string) => void;
}) {
  const { movements, error, reload } = useDeliveryMovements(delivery.id, delivery.movements, !!delivery.completedAt);
  // Closing the create dialog returns focus to its Start button (it is state-controlled, not a Radix trigger).
  const focus = useFocusReturn();
  const justCreated = useRef(false);
  const closed = !!delivery.completedAt;
  const [createEnv, setCreateEnv] = useState<MovementEnvironment | null>(null);
  /**
   * Set when a movement was created and the navigation to its page started. The delivery tab stays mounted (hidden) while the page is
   * shown, so nothing replaces it: this state must END BY ITSELF, or the create dialog would still be up (busy, body locked) on the way
   * back. It ends when the route leaves the project page, when this tab is shown again, or after OPENING_TIMEOUT_MS (createReleaseReason).
   */
  const [opening, setOpening] = useState<{ since: number; env: MovementEnvironment } | null>(null);
  const pathname = usePathname();
  const projectPath = `/projects/${delivery.projectId}`;
  const openingRef = useRef(opening);
  useEffect(() => {
    openingRef.current = opening;
  });
  const releaseRef = useRef<(reason: CreateReleaseReason) => void>(() => {});
  useEffect(() => {
    releaseRef.current = (reason) => {
      const o = openingRef.current;
      setCreateEnv(null);
      setOpening(null);
      void reload(); // the new movement is not in the list the card got; show its chip
      if (reason === "timeout" && o) toast.info(`The movement was created: open it from the ${envLabel(o.env)} chip`);
    };
  });
  // (a) the route moved away from the project page: the movement page is arriving (or has arrived)
  useEffect(() => {
    if (!opening) return;
    if (createReleaseReason({ openingSince: opening.since, now: opening.since, pathname, projectPath, becameVisible: false }) !== "route") return;
    const t = setTimeout(() => releaseRef.current("route"), 0);
    return () => clearTimeout(t);
  }, [opening, pathname, projectPath]);
  // (b) the page did not arrive: let go and say where the movement is
  useEffect(() => {
    if (!opening) return;
    const t = setTimeout(() => releaseRef.current("timeout"), OPENING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [opening]);
  // (c) this tab is shown again after being hidden (the user came back): setup runs again then, and an opening state is stale by definition
  useEffect(() => {
    const t = setTimeout(() => {
      if (openingRef.current) releaseRef.current("visible");
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const chips = useMemo(() => envChips(movements), [movements]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2" data-testid="movement-section" role="group" aria-label="Environment movement">
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
        <RiRocketLine className="size-3.5" /> Movement
      </span>
      {movements === null && !error && (
        <span className="text-[11px] text-muted-foreground" data-testid="movement-section-loading">
          Loading…
        </span>
      )}
      {error && (
        <span className="inline-flex items-center gap-1 text-[11px] text-destructive" role="alert" data-testid="movement-section-error">
          {error}
          <Button variant="ghost" size="xs" onClick={() => void reload()} data-testid="movement-section-retry">
            Retry
          </Button>
        </span>
      )}
      {movements !== null &&
        chips.map((c) => {
          const start = startAction(c, canManage, closed);
          return (
            <div key={c.env} className="inline-flex items-center gap-1" data-testid={`movement-env-${c.env}`}>
              {c.movementId ? (
                <Link
                  href={movementPagePath(delivery.projectId, delivery.id, c.movementId)}
                  aria-label={`Open the ${c.label} movement (${statusLabel(c.status ?? "")})`}
                  data-testid={`movement-chip-${c.env}`}
                  data-status={c.status ?? "none"}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] hover:bg-muted"
                >
                  <span className="font-semibold">{c.label}</span>
                  <Chip tone={statusTone(c.status ?? "")} className="px-1.5 py-0">
                    {statusLabel(c.status ?? "")}
                  </Chip>
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground" data-testid={`movement-chip-${c.env}`} data-status="none">
                  <span className="font-semibold">{c.label}</span> none
                </span>
              )}
              {canManage && c.canStart && !closed && (
                <GuardedButton
                  variant="outline"
                  size="xs"
                  disabled={!start.enabled || delivery.items.length === 0}
                  reason={delivery.items.length === 0 ? "The delivery has no Jiras to move" : start.reason}
                  onClick={() => {
                    focus.remember(openerTestIds("create", c.env));
                    setCreateEnv(c.env);
                  }}
                  aria-label={`Start movement to ${c.label}`}
                  data-testid={`movement-start-${c.env}`}
                >
                  Start movement to {c.label}
                </GuardedButton>
              )}
            </div>
          );
        })}

      {createEnv && (
        <MovementCreateDialog
          deliveryId={delivery.id}
          deliveryName={delivery.name}
          itemCount={delivery.items.length}
          environment={createEnv}
          open
          onOpenChange={(o) => {
            if (!o) {
              setCreateEnv(null);
              setOpening(null);
            }
          }}
          onCloseAutoFocus={(e) => {
            // Created: the page is opening; cancelled: back to the Start button.
            if (justCreated.current) {
              justCreated.current = false;
              e.preventDefault();
            } else focus.onCloseAutoFocus(e);
          }}
          onCreated={(id, note) => {
            // The dialog stays up ("Opening the movement…", closable) until the page arrives; the release rules above end it by themselves.
            justCreated.current = true;
            setOpening({ since: Date.now(), env: createEnv });
            if (note) toast.warning(note);
            onOpenMovement(id);
          }}
        />
      )}
    </div>
  );
}

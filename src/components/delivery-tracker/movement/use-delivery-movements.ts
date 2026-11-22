"use client";

/**
 * The movement chips of one delivery card. The deliveries list already carries them (`movements`, one grouped
 * query for the whole tab), so a card makes NO request when it appears. `reload` asks the delivery's own light list
 * (2 cheap queries for this one delivery; cheaper than re-fetching every delivery with its items) and is called only
 * after something changed: a panel closed, a movement was created or cancelled. A fresh deliveries list (new `initial`)
 * replaces what a reload had stored. Only if the list came without the field (its chip query failed) does the card
 * ask once itself, and a completed delivery never asks on its own.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, movementsBase } from "./api";
import type { MovementListItem } from "./api-types";

export type MovementChipLike = Pick<MovementListItem, "id" | "environment" | "status">;

type ListResult = { list: MovementListItem[]; error: null } | { list: null; error: string } | null;

/** The delivery's own light list; null when the caller aborted. */
async function fetchList(deliveryId: string, signal: AbortSignal): Promise<ListResult> {
  const r = await api<{ movements: MovementListItem[] }>(movementsBase(deliveryId), { signal, timeoutMs: 30_000, fallbackError: "Could not load movements" });
  if (r.aborted) return null;
  if (!r.ok || !r.data) return { list: null, error: r.error ?? "Could not load movements" };
  return { list: r.data.movements, error: null };
}

export function useDeliveryMovements(deliveryId: string, initial: readonly MovementChipLike[] | undefined, completed: boolean) {
  // What a reload fetched, valid only for the `initial` it was fetched against.
  const [local, setLocal] = useState<{ base: unknown; list: MovementChipLike[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctlRef = useRef<AbortController | null>(null);

  const apply = useCallback(
    (res: ListResult) => {
      if (!res) return;
      if (res.list === null) setError(res.error);
      else {
        setError(null);
        setLocal({ base: initial, list: res.list });
      }
    },
    [initial]
  );

  const reload = useCallback(async () => {
    ctlRef.current?.abort(); // a newer request replaces the one in flight
    const ctl = new AbortController();
    ctlRef.current = ctl;
    apply(await fetchList(deliveryId, ctl.signal));
  }, [deliveryId, apply]);

  // Fallback only: the list came without chips (its chip query failed). Aborted when the card goes away.
  useEffect(() => {
    if (initial !== undefined || completed) return;
    const ctl = new AbortController();
    void fetchList(deliveryId, ctl.signal).then((res) => {
      if (!ctl.signal.aborted) apply(res);
    });
    return () => ctl.abort();
  }, [initial, completed, deliveryId, apply]);

  // The card goes away: a reload in flight does not survive it.
  useEffect(() => () => ctlRef.current?.abort(), []);

  const movements: readonly MovementChipLike[] | null = local && local.base === initial ? local.list : (initial ?? (completed ? [] : null));
  return { movements, error, reload };
}

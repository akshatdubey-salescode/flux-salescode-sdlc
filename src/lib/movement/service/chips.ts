/**
 * The per-environment movement chips of the deliveries list: one grouped query for ALL the deliveries of
 * a project page, so the Delivery tab needs no request per card. Only id, delivery_id, environment and
 * status are selected (never `inputs`), cancelled movements are left out (a cancelled one does not hold
 * the environment), and at most one chip per environment per delivery is returned (3 per delivery).
 */
import { and, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { deliveryMovements } from "@/lib/db/schema";
import { MOVEMENT_ENVIRONMENT_VALUES } from "../values";

export interface MovementChip {
  id: string;
  environment: (typeof MOVEMENT_ENVIRONMENT_VALUES)[number];
  status: string;
}

export interface MovementChipRow extends MovementChip {
  deliveryId: string;
}

/** Group rows by delivery, drop cancelled, keep the first row per environment (the unique index allows one live), environment order demo, uat, prod. */
export function shapeChips(rows: readonly MovementChipRow[]): Map<string, MovementChip[]> {
  const byDelivery = new Map<string, Map<string, MovementChip>>();
  for (const r of rows) {
    if (r.status === "cancelled") continue;
    const m = byDelivery.get(r.deliveryId) ?? new Map<string, MovementChip>();
    if (!m.has(r.environment)) m.set(r.environment, { id: r.id, environment: r.environment, status: r.status });
    byDelivery.set(r.deliveryId, m);
  }
  const out = new Map<string, MovementChip[]>();
  for (const [d, m] of byDelivery) out.set(d, MOVEMENT_ENVIRONMENT_VALUES.flatMap((e) => (m.has(e) ? [m.get(e)!] : [])));
  return out;
}

/** One query for every delivery id given (the unique (delivery_id, environment) index serves it); empty input = no query. */
export async function movementChipsFor(deliveryIds: readonly string[]): Promise<Map<string, MovementChip[]>> {
  if (deliveryIds.length === 0) return new Map();
  const rows = await db
    .select({ id: deliveryMovements.id, deliveryId: deliveryMovements.deliveryId, environment: deliveryMovements.environment, status: deliveryMovements.status })
    .from(deliveryMovements)
    .where(and(inArray(deliveryMovements.deliveryId, [...deliveryIds]), ne(deliveryMovements.status, "cancelled")));
  return shapeChips(rows);
}

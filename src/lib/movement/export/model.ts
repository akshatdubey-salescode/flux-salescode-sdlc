/**
 * What an export (Excel, text, print page) is made from. Plain data, loaded in ONE pass from the
 * stored movement (no Jira call), so the three formats cannot disagree with each other and the
 * writers can be tested without a database.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deliveryMovementEvents } from "@/lib/db/schema";
import type { Checklist } from "../checklist";
import { currentChecklist, loadItemRows, loadMovement, loadSlots } from "../service/core";
import { summarize } from "../service/service";
import type { ItemSummary } from "../service/types";
import { MOVEMENT_SLOT_VALUES, type MovementEnvironment, type MovementSlot, type MovementStatus } from "../values";

/** The Events sheet / section shows the last this many events. */
export const MAX_EXPORT_EVENTS = 100;
/** An event's detail is a JSON diff of up to 4 KB; the export keeps a short readable start of it. */
export const MAX_EVENT_DETAIL_CHARS = 300;

export interface ExportSigner {
  slot: MovementSlot;
  email: string;
  name: string | null;
  signedAt: string | null;
  signed: boolean;
  /** Signed the checklist that is current now. */
  signedCurrent: boolean;
}

export interface ExportEvent {
  at: string;
  type: string;
  actor: string;
  detail: string;
}

export interface ExportModel {
  generatedAt: string;
  delivery: { id: string; name: string; date: string };
  movement: {
    id: string;
    environment: MovementEnvironment;
    status: MovementStatus;
    /** Hash of the checklist the export shows. */
    hash: string;
    refreshedAt: string | null;
    createdAt: string;
    createdByName: string | null;
    startedAt: string | null;
    doneAt: string | null;
    doneByName: string | null;
  };
  signers: ExportSigner[];
  items: ItemSummary[];
  checklist: Checklist;
  events: ExportEvent[];
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function shortDetail(detail: unknown): string {
  if (detail === null || detail === undefined) return "";
  let s: string;
  try {
    s = JSON.stringify(detail) ?? "";
  } catch {
    return "";
  }
  return s.length > MAX_EVENT_DETAIL_CHARS ? `${s.slice(0, MAX_EVENT_DETAIL_CHARS - 1)}…` : s;
}

/** Throws MovementError 404 like the view when the movement is not of this delivery or the delivery was deleted. */
export async function loadExportModel(deliveryId: string, movementId: string, now: Date = new Date()): Promise<ExportModel> {
  const head = await loadMovement(db, deliveryId, movementId);
  // Sequential on purpose: the pool is small (max 5) and an export should never take 3 of its connections at once.
  const { rows: slotRows } = await loadSlots(db, movementId);
  const rows = await loadItemRows(db, movementId);
  // last 100, newest first, by the (movement_id, at) index; the detail is 4 KB at most
  const events = await db
    .select({ type: deliveryMovementEvents.type, at: deliveryMovementEvents.at, actorName: deliveryMovementEvents.actorName, actor: deliveryMovementEvents.actor, detail: deliveryMovementEvents.detail })
    .from(deliveryMovementEvents)
    .where(eq(deliveryMovementEvents.movementId, movementId))
    .orderBy(desc(deliveryMovementEvents.at))
    .limit(MAX_EXPORT_EVENTS);
  const cl = await currentChecklist(db, head, rows);
  return {
    generatedAt: now.toISOString(),
    delivery: { id: head.deliveryId, name: head.deliveryName, date: head.deliveryDate },
    movement: {
      id: head.id,
      environment: head.environment,
      status: head.status,
      hash: cl.hash,
      refreshedAt: iso(head.refreshedAt),
      createdAt: head.createdAt.toISOString(),
      createdByName: head.createdByName,
      startedAt: iso(head.startedAt),
      doneAt: iso(head.doneAt),
      doneByName: head.doneByName,
    },
    signers: MOVEMENT_SLOT_VALUES.map((slot) => {
      const r = slotRows.find((x) => x.slot === slot);
      return { slot, email: r?.email ?? "", name: r?.name ?? null, signedAt: iso(r?.signedAt), signed: !!r?.signedHash, signedCurrent: !!r?.signedHash && r.signedHash === cl.hash };
    }),
    items: rows.map(summarize),
    checklist: cl,
    events: events.map((e) => ({ at: e.at.toISOString(), type: e.type, actor: e.actorName ?? e.actor ?? "", detail: shortDetail(e.detail) })),
  };
}

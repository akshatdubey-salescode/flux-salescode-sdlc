/**
 * The movement service (DB layer). Every mutation runs in one transaction that first locks the
 * movement row (FOR UPDATE), asks state.ts whether the actor may do it, writes, rebuilds the
 * checklist FROM THE STORED INPUTS (no Jira call), applies the hash rule (sign-offs reset when the
 * checklist changed) and writes the events; notifications go out after the commit and never throw.
 * Reads (view, checklist) never call Jira either.
 */
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  deliveries,
  deliveryItems,
  deliveryMovementEvents,
  deliveryMovementItems,
  deliveryMovementSignoffs,
  deliveryMovementSnapshots,
  deliveryMovements,
  githubRepos,
  users,
} from "@/lib/db/schema";
import { checkItemStatusGates, writeItemStatus } from "@/lib/deliveries/set-item-status";
import { isValidUuid } from "@/lib/validation";
import { formatIst } from "../time-format";
import { applyEdits } from "./edits";
import type { DeliveryStatusValue } from "@/lib/deliveries/status";
import { diffChecklists, safeDecodeSnapshot, type Checklist } from "../checklist";
import { canonical } from "../checklist/canon";
import { coversOf, isUnion, type CoverRef } from "../covers";
import { normalizeRepo } from "../record";
import { prKey } from "../record";
import {
  isMovementEnvironment,
  isMovementResult,
  MAX_BRANCH_REPOS,
  MOVEMENT_SLOT_VALUES,
  MOVEMENT_SLOT_WORDS,
  type MovementEnvironment,
  type MovementResult,
  type MovementSlot,
} from "../values";
import {
  addEvent,
  applyChecklist,
  checklistFromSnapshot,
  currentChecklist,
  isEffectivelyIncluded,
  itemChecklist,
  itemChecklistAndServices,
  repoUsage,
  loadEdits,
  loadEditsMeta,
  loadItemRows,
  loadMovement,
  loadSlots,
  loadStoredRecords,
  sendNotifications,
  tcSignoffsFor,
  writeSnapshot,
  type ApplyResult,
  type Executor,
  type ItemRow,
  type MovementHead,
  type Notification,
} from "./core";
import { isRefreshing, MAX_MOVEMENT_ITEMS, MIN_REFRESH_INTERVAL_MS, refreshMovement, type RefreshOptions, type RefreshResult } from "./refresh";
import {
  authorize,
  checkSignable,
  checkStartable,
  cleanReason,
  isValidEmail,
  normEmail,
  permissionsFor,
  sameEmail,
  slotsOf,
  statusAfterSign,
  type Denied,
  type MovementAction,
  type Slots,
} from "./state";
import { MovementError, type BranchPick, type ItemSummary, type ItemSummaryView, type MovementActor } from "./types";

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

const MAX_BODY_ITEMS = 200;

function throwDenied(d: Denied): never {
  throw new MovementError(d.code === "forbidden" ? 403 : 409, d.message, d.code, d.extra);
}

function guard(action: MovementAction, head: MovementHead, actor: MovementActor, slots?: Slots, slot?: MovementSlot): void {
  const d = authorize(action, { status: head.status, actor, slots, slot });
  if (!d.ok) throwDenied(d);
}

const pgCode = (e: unknown): string | undefined => {
  const o = e as { code?: string; cause?: { code?: string } } | undefined;
  return o?.code ?? o?.cause?.code;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Run a transaction, then the notifications it collected (after the commit, never throwing). */
async function inTx<T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], notes: Notification[]) => Promise<T>): Promise<T> {
  const notes: Notification[] = [];
  const out = await db.transaction((tx) => fn(tx, notes));
  if (notes.length > 0) await sendNotifications(notes);
  return out;
}

function normalizeSigners(input: unknown, partial: boolean): Partial<Record<MovementSlot, { email: string; name: string | null }>> {
  const out: Partial<Record<MovementSlot, { email: string; name: string | null }>> = {};
  if (!input || typeof input !== "object") throw new MovementError(400, "signers must be an object", "bad_request");
  for (const slot of MOVEMENT_SLOT_VALUES) {
    const v = (input as Record<string, unknown>)[slot];
    if (v === undefined && partial) continue;
    const email = typeof v === "string" ? v : (v as { email?: unknown } | undefined)?.email;
    const name = typeof v === "object" && v !== null ? (v as { name?: unknown }).name : undefined;
    if (!isValidEmail(email)) throw new MovementError(400, `The ${MOVEMENT_SLOT_WORDS[slot]} must be a valid email address`, "bad_request", { slot });
    if (name !== undefined && name !== null && (typeof name !== "string" || name.length > 100)) throw new MovementError(400, `The ${MOVEMENT_SLOT_WORDS[slot]} name is not valid`, "bad_request", { slot });
    out[slot] = { email: normEmail(email), name: typeof name === "string" && name.trim() ? name.trim() : null };
  }
  return out;
}

/** The slots must be held by different people (one person cannot approve their own work several times). A slot nobody holds yet (an older movement's QA lead) is not compared. */
function assertDistinct(emails: Record<MovementSlot, string>): void {
  const list = MOVEMENT_SLOT_VALUES.map((s) => normEmail(emails[s])).filter(Boolean);
  if (new Set(list).size !== list.length) throw new MovementError(400, "The deployer, the BA, the lead and the QA lead must be four different people", "bad_request");
}

/** Each named person must be a Flux user (users.id is the email): a sign-off needs a login that can match it. */
async function assertSignersExist(ex: Executor, signers: Partial<Record<MovementSlot, { email: string }>>): Promise<void> {
  const entries = MOVEMENT_SLOT_VALUES.flatMap((slot) => (signers[slot] ? [[slot, signers[slot]!.email] as const] : []));
  if (entries.length === 0) return;
  const rows = await ex.select({ id: users.id }).from(users).where(inArray(users.id, entries.map(([, e]) => e)));
  const known = new Set(rows.map((r) => r.id));
  for (const [slot, email] of entries) {
    if (!known.has(email)) throw new MovementError(400, `The ${MOVEMENT_SLOT_WORDS[slot]} (${email}) is not a Flux user`, "bad_request", { slot });
  }
}

function cleanIssueIds(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new MovementError(400, "issueIds must be a non-empty array", "bad_request");
  if (v.length > MAX_BODY_ITEMS) throw new MovementError(400, `issueIds must not exceed ${MAX_BODY_ITEMS}`, "bad_request");
  return [...new Set(v.map(String))];
}

// ---------------------------------------------------------------------------------------------
// create / list
// ---------------------------------------------------------------------------------------------

export async function createMovement(
  deliveryId: string,
  environment: unknown,
  signersInput: unknown,
  actor: MovementActor,
  deps: RefreshOptions = {}
): Promise<{ movementId: string; refresh: RefreshResult }> {
  if (!actor.isManager) throw new MovementError(403, "Only delivery managers can create a movement", "forbidden");
  if (!isMovementEnvironment(environment)) throw new MovementError(400, "environment must be demo, uat or prod", "bad_request");
  const signers = normalizeSigners(signersInput, false) as Record<MovementSlot, { email: string; name: string | null }>;
  assertDistinct(Object.fromEntries(MOVEMENT_SLOT_VALUES.map((s) => [s, signers[s].email])) as Record<MovementSlot, string>);
  await assertSignersExist(db, signers);

  const [delivery] = await db
    .select({ id: deliveries.id, name: deliveries.name, deletedAt: deliveries.deletedAt, completedAt: deliveries.completedAt })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId))
    .limit(1);
  if (!delivery) throw new MovementError(404, "Delivery not found", "not_found");
  if (delivery.deletedAt || delivery.completedAt) {
    throw new MovementError(409, "A completed or deleted delivery cannot be moved to an environment", "delivery_closed");
  }
  // Checked BEFORE anything is inserted, so an unusable delivery leaves no half-created movement behind.
  const [{ n }] = await db.select({ n: count() }).from(deliveryItems).where(eq(deliveryItems.deliveryId, deliveryId));
  if (Number(n) === 0) throw new MovementError(400, "The delivery has no Jiras to move", "bad_request");
  if (Number(n) > MAX_MOVEMENT_ITEMS) {
    throw new MovementError(400, `The delivery has ${n} Jiras; a movement handles at most ${MAX_MOVEMENT_ITEMS}. Split the delivery.`, "too_many_items");
  }

  let movementId: string;
  try {
    movementId = await inTx(async (tx, notes) => {
      const [m] = await tx
        .insert(deliveryMovements)
        .values({ deliveryId, environment, createdBy: actor.id, createdByName: actor.name })
        .returning({ id: deliveryMovements.id });
      await tx.insert(deliveryMovementSignoffs).values(
        MOVEMENT_SLOT_VALUES.map((slot) => ({ movementId: m.id, slot, userEmail: signers[slot].email, userName: signers[slot].name }))
      );
      await addEvent(tx, m.id, "created", actor, { environment, signers: Object.fromEntries(MOVEMENT_SLOT_VALUES.map((s) => [s, signers[s].email])) });
      for (const slot of MOVEMENT_SLOT_VALUES) {
        notes.push((n) =>
          n.notifySignerAssigned({ movementId: m.id, deliveryId, deliveryName: delivery.name, environment, slot, email: signers[slot].email, assignedBy: actor.email })
        );
      }
      return m.id;
    });
  } catch (e) {
    if (pgCode(e) === "23505") {
      // Say WHICH movement is in the way (additive fields), and for a finished one what to do next.
      const [ex] = await db
        .select({ id: deliveryMovements.id, status: deliveryMovements.status })
        .from(deliveryMovements)
        .where(and(eq(deliveryMovements.deliveryId, deliveryId), eq(deliveryMovements.environment, environment), sql`${deliveryMovements.status} <> 'cancelled'`))
        .limit(1);
      const message =
        ex?.status === "done"
          ? `This delivery already has a finished ${environment} movement. Move the Jiras that were held to another delivery (Migrate) and start a new movement there.`
          : `There is already a live ${environment} movement for this delivery`;
      throw new MovementError(409, message, "movement_exists", ex ? { existingStatus: ex.status, existingMovementId: ex.id } : undefined);
    }
    throw e;
  }
  const refresh = await refreshMovement(movementId, { ...deps, bypass: true, actor });
  return { movementId, refresh };
}

export interface MovementListItem {
  id: string;
  environment: MovementEnvironment;
  status: string;
  createdAt: string;
  updatedAt: string;
  refreshedAt: string | null;
  doneAt: string | null;
  items: number;
  included: number;
}

/** Light list of a delivery's movements (no inputs, no checklist). */
export async function listMovements(deliveryId: string): Promise<MovementListItem[]> {
  const [d] = await db.select({ id: deliveries.id, deletedAt: deliveries.deletedAt }).from(deliveries).where(eq(deliveries.id, deliveryId)).limit(1);
  if (!d || d.deletedAt) throw new MovementError(404, "Delivery not found", "not_found");
  const rows = await db
    .select({
      id: deliveryMovements.id,
      environment: deliveryMovements.environment,
      status: deliveryMovements.status,
      createdAt: deliveryMovements.createdAt,
      updatedAt: deliveryMovements.updatedAt,
      refreshedAt: deliveryMovements.refreshedAt,
      doneAt: deliveryMovements.doneAt,
    })
    .from(deliveryMovements)
    .where(eq(deliveryMovements.deliveryId, deliveryId))
    .orderBy(desc(deliveryMovements.createdAt))
    .limit(50);
  if (rows.length === 0) return [];
  const counts = await db
    .select({
      movementId: deliveryMovementItems.movementId,
      total: count(),
      included: sql<number>`count(*) filter (where ${deliveryMovementItems.included} and ${deliveryMovementItems.readiness} <> 'blocked')`,
    })
    .from(deliveryMovementItems)
    .where(inArray(deliveryMovementItems.movementId, rows.map((r) => r.id)))
    .groupBy(deliveryMovementItems.movementId);
  const byId = new Map(counts.map((c) => [c.movementId, c]));
  return rows.map((r) => ({
    id: r.id,
    environment: r.environment,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    refreshedAt: iso(r.refreshedAt),
    doneAt: iso(r.doneAt),
    items: Number(byId.get(r.id)?.total ?? 0),
    included: Number(byId.get(r.id)?.included ?? 0),
  }));
}

/**
 * The user's Refresh: permission and state checked, a refresh of the last 10 seconds is not repeated
 * (double clicks, two tabs), otherwise the Jira reads bypass the 60 s result cache.
 */
export async function refreshForActor(deliveryId: string, movementId: string, actor: MovementActor, deps: RefreshOptions = {}): Promise<RefreshResult> {
  const head = await loadMovement(db, deliveryId, movementId);
  guard("refresh", head, actor);
  const now = (deps.now?.() ?? new Date()).getTime();
  if (head.refreshedAt && now - head.refreshedAt.getTime() < MIN_REFRESH_INTERVAL_MS) return { skipped: "recent", movementStatus: head.status };
  return refreshMovement(movementId, { ...deps, bypass: true, actor });
}

// ---------------------------------------------------------------------------------------------
// view / checklist (DB only)
// ---------------------------------------------------------------------------------------------

/** The codes that BLOCK an item (readiness.ts BlockerCode); every other stored warning is informational. */
const BLOCKER_CODES = new Set([
  "pr_no_record", // written before reviews were per Jira; still read from stored rows
  "sibling_no_record",
  "no_record",
  "tree_unreadable",
  "tree_incomplete",
]);
/** The view lists at most this many record pointers per Jira; the rest is `recordCount` / the item detail endpoint. */
const VIEW_RECORDS_PER_ITEM = 5;
/** ... and at most this many notes (blockers first, then warnings) and repos; `warningsMore` / `reposMore` say how many were left out. */
const VIEW_NOTES_PER_ITEM = 12;
const VIEW_REPOS_PER_ITEM = 12;

export function splitNotes(warnings: readonly { code: string; message: string }[]) {
  return {
    blockers: warnings.filter((w) => BLOCKER_CODES.has(w.code)).map((w) => ({ ...w, severity: "blocker" as const })),
    softWarnings: warnings.filter((w) => !BLOCKER_CODES.has(w.code)).map((w) => ({ ...w, severity: "warning" as const })),
  };
}

type TcSign = { dev?: { by: string; at: string }; tester?: { by: string; at: string } };

export function summarize(r: ItemRow): ItemSummary {
  return {
    issueId: r.issueId,
    key: r.key,
    summary: r.summary,
    // The tick as the checklist sees it (a blocked Jira is never in).
    included: isEffectivelyIncluded(r),
    readiness: r.readiness,
    override: r.readiness === "override" ? { reason: r.overrideReason ?? "", by: r.overrideByName ?? r.overrideBy, at: iso(r.overrideAt) ?? "" } : null,
    result: r.result,
    resultComment: r.resultComment,
    warnings: r.warnings,
    records: r.recordRefs,
  };
}

export function summarizeView(r: ItemRow, tc: TcSign = {}, edit?: { count: number; by: string | null }): ItemSummaryView {
  // The view carries blockers and softWarnings; the combined `warnings` stays in summarize() (the export reads it).
  const { warnings: _combined, ...base } = summarize(r);
  void _combined;
  const all = splitNotes(r.warnings);
  const blockers = all.blockers.slice(0, VIEW_NOTES_PER_ITEM);
  const softWarnings = all.softWarnings.slice(0, VIEW_NOTES_PER_ITEM - blockers.length);
  const repos = [...new Set(r.recordRefs.map((p) => p.repo))].sort();
  return {
    ...base,
    records: r.recordRefs.slice(0, VIEW_RECORDS_PER_ITEM),
    ticked: r.included,
    tickSet: r.tickSet,
    blockers,
    softWarnings,
    warningsMore: r.warnings.length - blockers.length - softWarnings.length,
    // A review comment that covers 3 PRs is ONE review comment (the pointers list one row per PR).
    recordCount: new Set(r.recordRefs.map((p) => p.commentId)).size,
    reviews: new Set(r.recordRefs.map((p) => p.commentId)).size,
    prs: { covered: new Set(r.recordRefs.map((p) => `${p.repo}#${p.pr}`)).size },
    repos: repos.slice(0, VIEW_REPOS_PER_ITEM),
    reposMore: Math.max(0, repos.length - VIEW_REPOS_PER_ITEM),
    signoffs: { dev: tc.dev ?? null, tester: tc.tester ?? null },
    // At least one review comment of this Jira was corrected in Flux (the checklist uses the edited text).
    edited: !!edit && edit.count > 0,
    editedBy: edit?.by ?? null,
    editedCount: edit?.count ?? 0,
  };
}

const ZERO = { info: 0, warn: 0, blocker: 0 };
const EMPTY_CHECKLIST_VIEW = {
  hash: null as string | null,
  summary: "",
  stats: { jiras: 0, included: 0, held: 0, records: 0, prs: 0, items: 0, conflicts: 0, unknowns: 0, needsAttention: 0, bySeverity: { items: ZERO, conflicts: ZERO } },
  conflicts: [] as Array<{ id: string; kind: string; section: string; title: string; severity: string; itemKey: string }>,
  unknownsByOwner: [] as Array<{ owner: string; count: number }>,
  warnings: 0,
};

export async function getMovementView(deliveryId: string, movementId: string, actor: MovementActor) {
  const head = await loadMovement(db, deliveryId, movementId);
  // At most TWO queries in flight at a time (the pool has 5 connections shared by every request): pairs, one after the other.
  const [{ rows: slotRows, slots }, rows] = await Promise.all([loadSlots(db, movementId), loadItemRows(db, movementId)]);
  const [flag, events] = await Promise.all([
    db
      .select({ id: deliveryMovementEvents.id })
      .from(deliveryMovementEvents)
      .where(and(eq(deliveryMovementEvents.movementId, movementId), eq(deliveryMovementEvents.type, "changed_after_start")))
      .limit(1),
    db
      .select({ type: deliveryMovementEvents.type, at: deliveryMovementEvents.at, actorName: deliveryMovementEvents.actorName })
      .from(deliveryMovementEvents)
      .where(eq(deliveryMovementEvents.movementId, movementId))
      .orderBy(desc(deliveryMovementEvents.at))
      .limit(20),
  ]);
  // Unreadable stored inputs are reported (needsRefresh), never papered over with an empty checklist.
  let cl: Checklist | null = null;
  try {
    cl = await currentChecklist(db, head, rows);
  } catch (e) {
    if (!(e instanceof MovementError && e.code === "inputs_stale")) throw e;
  }
  const tc = await tcSignoffsFor(db, rows.map((r) => r.issueId));
  // Which Jiras have a corrected comment (no query at all when the movement has no edits).
  const editInfo = new Map<string, { count: number; by: string | null }>();
  if (head.commentEditsHash) {
    for (const e of await loadEditsMeta(db, movementId)) {
      const cur = editInfo.get(e.issueId);
      editInfo.set(e.issueId, { count: (cur?.count ?? 0) + 1, by: e.editedByName ?? e.editedBy });
    }
  }
  const frozen = head.status === "done" || head.status === "cancelled";
  const needsRefresh = cl === null && !frozen;
  // Jiras added to / removed from the delivery since the movement last synced (one light query; a frozen movement keeps its list).
  let deliveryChanged = { added: 0, removed: 0 };
  if (!frozen) {
    const onDelivery = await db.select({ issueId: deliveryItems.issueId }).from(deliveryItems).where(eq(deliveryItems.deliveryId, head.deliveryId)).limit(MAX_MOVEMENT_ITEMS + 1);
    const have = new Set(rows.map((r) => r.issueId));
    const want = new Set(onDelivery.map((d) => d.issueId));
    deliveryChanged = { added: [...want].filter((id) => !have.has(id)).length, removed: [...have].filter((id) => !want.has(id)).length };
  }
  const hash = cl?.hash ?? head.checklistHash;
  const perms = permissionsFor(head.status, actor, slots, hash);
  const approvalsBlocked = needsRefresh || head.refreshError !== null;
  // The same extra conditions the service enforces, so a button is shown only when the server would accept it.
  const includedCount = rows.filter(isEffectivelyIncluded).length;
  // Jiras whose last re-check failed (an outage): their LAST KNOWN data stands; signing is not blocked, but it is said.
  const sinceList = rows.flatMap((r) => r.warnings.filter((w) => w.code === "recheck_failed").map((w) => w.at ?? ""));
  const degraded = { count: sinceList.length, since: sinceList.filter(Boolean).sort()[0] ?? null };
  const degradedNote = degraded.count > 0 ? `${degraded.count} Jira${degraded.count === 1 ? "" : "s"} could not be re-checked${degraded.since ? ` since ${formatIst(degraded.since)}` : ""}; the last known records are used` : null;
  return {
    movement: {
      id: head.id,
      deliveryId: head.deliveryId,
      environment: head.environment,
      status: head.status,
      createdBy: head.createdBy,
      createdByName: head.createdByName,
      createdAt: head.createdAt.toISOString(),
      startedAt: iso(head.startedAt),
      doneAt: iso(head.doneAt),
      doneByName: head.doneByName,
      updatedAt: head.updatedAt.toISOString(),
      refreshedAt: iso(head.refreshedAt),
      hash,
      changedAfterStart: flag.length > 0,
    },
    delivery: { id: head.deliveryId, name: head.deliveryName, date: head.deliveryDate },
    signers: MOVEMENT_SLOT_VALUES.map((s) => {
      const r = slotRows.find((x) => x.slot === s);
      return {
        slot: s,
        email: r?.email ?? "",
        name: r?.name ?? null,
        signedAt: iso(r?.signedAt),
        signed: !!r?.signedHash,
        // Signed the checklist that is current now (a stale sign-off is cleared by the rule, so this is normally the same as `signed`).
        signedCurrent: !!r?.signedHash && r.signedHash === hash,
      };
    }),
    items: rows.map((r) => summarizeView(r, tc.get(r.issueId), editInfo.get(r.issueId))),
    branches: head.branches,
    checklist: cl
      ? {
          hash: cl.hash,
          summary: degradedNote ? `${cl.summary}; ${degradedNote}` : cl.summary,
          stats: cl.stats,
          conflicts: cl.conflicts.map((c) => ({ id: c.id, kind: c.kind, section: c.section, title: c.title, severity: c.severity, itemKey: c.itemKey })),
          unknownsByOwner: cl.unknownsByOwner.map((g) => ({ owner: g.owner, count: g.items.length + (g.more ?? 0) })),
          warnings: cl.warnings.length,
        }
      : { ...EMPTY_CHECKLIST_VIEW, hash: head.checklistHash },
    events: events.map((e) => ({ type: e.type, at: e.at.toISOString(), actorName: e.actorName })),
    permissions: {
      ...perms,
      // Everything that rebuilds the checklist needs a readable one (inputs_stale); approving also needs a
      // successful last refresh (refresh_failed) and at least one Jira in; statuses exist for prod only (not_prod).
      edit: perms.edit && !needsRefresh,
      override: perms.override && !needsRefresh,
      revoke: perms.revoke && !needsRefresh,
      done: perms.done && !needsRefresh,
      confirm: perms.confirm && head.environment === "prod",
      start: perms.start && !approvalsBlocked && includedCount > 0,
      sign: approvalsBlocked || includedCount === 0 ? [] : perms.sign,
      // GET changes is for the signers only (the people who approve)
      changes: slotsOf(slots, actor.email).length > 0,
      notes: degradedNote ? [degradedNote] : ([] as string[]),
    },
    degraded,
    degradedCount: degraded.count,
    me: { email: actor.email, name: actor.name, slots: slotsOf(slots, actor.email), isManager: actor.isManager, isAdmin: actor.isAdmin },
    // This process only: another instance's refresh is not visible here.
    refreshing: isRefreshing(movementId),
    serverNow: new Date().toISOString(),
    refreshError: head.refreshError,
    needsRefresh,
    deliveryChanged,
  };
}

/** The full merged checklist (sections), built from the stored inputs; its own endpoint because it is the big payload. */
export async function getChecklist(deliveryId: string, movementId: string): Promise<Checklist> {
  const head = await loadMovement(db, deliveryId, movementId);
  const rows = await loadItemRows(db, movementId);
  return currentChecklist(db, head, rows);
}

// ---------------------------------------------------------------------------------------------
// edits: tick, override, branches (each may reset sign-offs through the hash rule)
// ---------------------------------------------------------------------------------------------

/** After an edit: rebuild, apply the hash rule, report. */
async function afterEdit(
  tx: Executor,
  notes: Notification[],
  head: MovementHead,
  before: ItemRow[],
  after: ItemRow[],
  slots: Slots,
  actor: MovementActor,
  newBranches?: BranchPick[]
): Promise<ApplyResult> {
  const next: MovementHead = newBranches ? { ...head, branches: newBranches } : head;
  const cl = await currentChecklist(tx, next, after);
  const ap = await applyChecklist(tx, {
    head,
    cl,
    actor,
    slots,
    previous: () => currentChecklist(tx, head, before),
    set: newBranches ? { branches: newBranches } : undefined,
    realChange: true,
  });
  notes.push(...ap.notifications);
  return ap;
}

export async function setIncluded(deliveryId: string, movementId: string, issueIds: unknown, included: unknown, actor: MovementActor) {
  const ids = cleanIssueIds(issueIds);
  if (typeof included !== "boolean") throw new MovementError(400, "included must be true or false", "bad_request");
  return inTx(async (tx, notes) => {
    const head = await loadMovement(tx, deliveryId, movementId, true);
    guard("edit", head, actor);
    const before = await loadItemRows(tx, movementId, true);
    const known = new Map(before.map((r) => [r.issueId, r]));
    const unknown = ids.filter((i) => !known.has(i));
    if (unknown.length) throw new MovementError(404, "Some Jiras are not part of this movement", "not_found");
    if (included) {
      const blocked = ids.map((i) => known.get(i)!).filter((r) => r.readiness === "blocked");
      if (blocked.length) {
        throw new MovementError(409, `${blocked.map((r) => r.key).slice(0, 10).join(", ")} ${blocked.length === 1 ? "is" : "are"} blocked and need an admin override before they can be selected`, "blocked", {
          keys: blocked.map((r) => r.key).slice(0, 50),
        });
      }
    }
    const toChange = ids.filter((i) => known.get(i)!.included !== included);
    if (toChange.length === 0) {
      // Nothing changes in the checklist, but an explicit choice on an untouched tick is remembered (see tick_set).
      const untouched = ids.filter((i) => !known.get(i)!.tickSet);
      if (untouched.length > 0) {
        await tx.update(deliveryMovementItems).set({ tickSet: true }).where(and(eq(deliveryMovementItems.movementId, movementId), inArray(deliveryMovementItems.issueId, untouched)));
      }
      return { changed: 0, status: head.status, hash: head.checklistHash };
    }
    // tick_set: from now on a refresh never changes this tick (and never auto-ticks it).
    await tx
      .update(deliveryMovementItems)
      .set({ included, tickSet: true })
      .where(and(eq(deliveryMovementItems.movementId, movementId), inArray(deliveryMovementItems.issueId, toChange)));
    const after = before.map((r) => (toChange.includes(r.issueId) ? { ...r, included, tickSet: true } : r));
    const { slots } = await loadSlots(tx, movementId);
    await addEvent(tx, movementId, included ? "items_ticked" : "items_unticked", actor, { keys: toChange.map((i) => known.get(i)!.key) });
    const ap = await afterEdit(tx, notes, head, before, after, slots, actor);
    return { changed: toChange.length, status: ap.status, hash: ap.hash };
  });
}

export async function overrideItem(deliveryId: string, movementId: string, issueId: string, reason: unknown, actor: MovementActor, include = false) {
  const text = cleanReason(reason);
  return inTx(async (tx, notes) => {
    const head = await loadMovement(tx, deliveryId, movementId, true);
    guard("override", head, actor);
    if (!text) throw new MovementError(400, "A reason of 5 to 500 characters is required", "bad_request");
    const before = await loadItemRows(tx, movementId, true);
    const row = before.find((r) => r.issueId === issueId);
    if (!row) throw new MovementError(404, "Jira is not part of this movement", "not_found");
    if (row.readiness !== "blocked") throw new MovementError(409, row.readiness === "override" ? "Already overridden" : "This Jira is not blocked", "not_blocked");
    const at = new Date();
    await tx
      .update(deliveryMovementItems)
      // `include`: the override and the tick are one atomic step (an explicit choice, so tick_set too)
      .set({ readiness: "override", overrideReason: text, overrideBy: actor.id, overrideByName: actor.name, overrideAt: at, ...(include ? { included: true, tickSet: true } : {}) })
      .where(and(eq(deliveryMovementItems.movementId, movementId), eq(deliveryMovementItems.issueId, issueId)));
    const after = before.map((r) =>
      r.issueId === issueId
        ? { ...r, readiness: "override" as const, overrideReason: text, overrideBy: actor.id, overrideByName: actor.name, overrideAt: at, ...(include ? { included: true, tickSet: true } : {}) }
        : r
    );
    const { slots } = await loadSlots(tx, movementId);
    await addEvent(tx, movementId, "override", actor, { key: row.key, reason: text, ...(include ? { included: true } : {}) });
    const ap = await afterEdit(tx, notes, head, before, after, slots, actor);
    return { status: ap.status, hash: ap.hash };
  });
}

export async function revokeOverride(deliveryId: string, movementId: string, issueId: string, reason: unknown, actor: MovementActor) {
  const text = cleanReason(reason);
  return inTx(async (tx, notes) => {
    const head = await loadMovement(tx, deliveryId, movementId, true);
    guard("revoke", head, actor);
    if (!text) throw new MovementError(400, "A reason of 5 to 500 characters is required", "bad_request");
    const before = await loadItemRows(tx, movementId, true);
    const row = before.find((r) => r.issueId === issueId);
    if (!row) throw new MovementError(404, "Jira is not part of this movement", "not_found");
    if (row.readiness !== "override") throw new MovementError(409, "This Jira has no override", "no_override");
    // Back to what the last refresh computed for it, without a Jira call. The source of truth is the row's own stored
    // warnings: blockers are written FIRST, so the 20-entry cap can never drop one, and any BLOCKER code means blocked.
    // (The readiness kept in the stored inputs is only informational: it is not rewritten when just the readiness
    // changes and the record pointers do not, so it can be stale.)
    const readiness = row.warnings.some((w) => BLOCKER_CODES.has(w.code)) ? ("blocked" as const) : ("ready" as const);
    const included = readiness === "blocked" ? false : row.included;
    await tx
      .update(deliveryMovementItems)
      .set({ readiness, included, overrideReason: null, overrideBy: null, overrideByName: null, overrideAt: null })
      .where(and(eq(deliveryMovementItems.movementId, movementId), eq(deliveryMovementItems.issueId, issueId)));
    const after = before.map((r) =>
      r.issueId === issueId ? { ...r, readiness, included, overrideReason: null, overrideBy: null, overrideByName: null, overrideAt: null } : r
    );
    const { slots } = await loadSlots(tx, movementId);
    await addEvent(tx, movementId, "override_revoked", actor, { key: row.key, reason: text });
    const ap = await afterEdit(tx, notes, head, before, after, slots, actor);
    return { status: ap.status, hash: ap.hash, readiness, included };
  });
}

// ---------------------------------------------------------------------------------------------
// branches
// ---------------------------------------------------------------------------------------------

export const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,199}$/;
const SEARCH_RE = /^[A-Za-z0-9._\-/]{0,100}$/;

/** Repos the INCLUDED Jiras' records name (normalised): the same effective-tick rule as the checklist. Held Jiras do not count. */
function affectedRepos(rows: readonly ItemRow[]): string[] {
  return [...repoUsage(rows).included].sort();
}

async function trackedRepos(ex: Executor): Promise<Array<{ name: string; fullName: string }>> {
  return ex
    .select({ name: githubRepos.name, fullName: githubRepos.fullName })
    .from(githubRepos)
    .where(eq(githubRepos.isTracked, true))
    .orderBy(asc(githubRepos.name))
    .limit(500);
}

/** Validate and normalise the picks: pattern, <= 30 repos, repo affected or tracked, one branch per repo. */
export function validateBranches(input: unknown, allowed: ReadonlySet<string>): BranchPick[] {
  if (!Array.isArray(input)) throw new MovementError(400, "branches must be an array", "bad_request");
  if (input.length > MAX_BRANCH_REPOS) throw new MovementError(400, `At most ${MAX_BRANCH_REPOS} repos can have a branch`, "bad_request");
  const out = new Map<string, string>();
  for (const b of input) {
    const repoRaw = (b as { repo?: unknown } | null)?.repo;
    const branch = (b as { branch?: unknown } | null)?.branch;
    if (typeof repoRaw !== "string" || typeof branch !== "string") throw new MovementError(400, "each branch needs a repo and a branch name", "bad_request");
    const repo = normalizeRepo(repoRaw);
    const name = branch.trim();
    if (!repo || repoRaw.length > 200) throw new MovementError(400, "invalid repo", "bad_request");
    if (!BRANCH_RE.test(name) || name.includes("..") || name.includes("//") || name.endsWith("/")) {
      throw new MovementError(400, `"${name.slice(0, 40)}" is not a valid branch name`, "bad_request");
    }
    if (!allowed.has(repo)) throw new MovementError(400, `${repo} is not a repo of this movement or a tracked repo`, "bad_request");
    if (out.has(repo)) throw new MovementError(400, `${repo} has two branches; choose one`, "bad_request");
    out.set(repo, name);
  }
  return [...out].map(([repo, branch]) => ({ repo, branch })).sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
}

export async function listAffectedRepos(deliveryId: string, movementId: string) {
  const head = await loadMovement(db, deliveryId, movementId);
  const [rows, tracked] = await Promise.all([loadItemRows(db, movementId), trackedRepos(db)]);
  const full = new Map(tracked.map((t) => [normalizeRepo(t.name), t.fullName]));
  const picked = new Map(head.branches.map((b) => [b.repo, b.branch]));
  const { included, all } = repoUsage(rows);
  const entry = (repo: string, heldOnly: boolean) => ({ repo, fullName: full.get(repo) ?? null, branch: picked.get(repo) ?? null, heldOnly });
  // Saved picks whose repo only held Jiras use stay visible (flagged), they are not silently dropped.
  const held = head.branches.map((b) => b.repo).filter((r) => all.has(r) && !included.has(r));
  return {
    affected: [...[...included].sort().map((r) => entry(r, false)), ...[...new Set(held)].sort().map((r) => entry(r, true))],
    tracked: tracked.map((t) => normalizeRepo(t.name)),
    branches: head.branches,
  };
}

export async function saveBranches(deliveryId: string, movementId: string, input: unknown, actor: MovementActor) {
  return inTx(async (tx, notes) => {
    const head = await loadMovement(tx, deliveryId, movementId, true);
    guard("edit", head, actor);
    const rows = await loadItemRows(tx, movementId, true);
    // Effective affected repos + tracked repos, plus the repos of picks already saved (so a held-only pick can stay while other picks change).
    const allowed = new Set([...affectedRepos(rows), ...(await trackedRepos(tx)).map((t) => normalizeRepo(t.name)), ...head.branches.map((b) => b.repo)]);
    const next = validateBranches(input, allowed);
    if (canonical(next) === canonical(head.branches)) return { changed: false, status: head.status, hash: head.checklistHash, branches: head.branches };
    const { slots } = await loadSlots(tx, movementId);
    await addEvent(tx, movementId, "branches_changed", actor, { from: head.branches, to: next });
    const ap = await afterEdit(tx, notes, head, rows, rows, slots, actor, next);
    return { changed: true, status: ap.status, hash: ap.hash, branches: next };
  });
}

export interface GithubDeps {
  /** Read-only branch search of one repo (full name `owner/name`); default: the org client. */
  searchBranches?: (repoFullName: string, q: string, signal?: AbortSignal) => Promise<string[]>;
}

const SEARCH_TIMEOUT_MS = 15_000;
export const MAX_SEARCH_RESULTS = 50;

async function defaultBranchSearch(repoFullName: string, q: string, signal?: AbortSignal): Promise<string[]> {
  const { loadActiveOrgs } = await import("@/lib/github/orgs");
  const { GitHubClient } = await import("@/lib/github/client");
  const owner = repoFullName.split("/")[0]?.toLowerCase();
  const org = (await loadActiveOrgs()).find((o) => o.login.toLowerCase() === owner);
  if (!org) throw new Error("no GitHub org is configured for this repo");
  return new GitHubClient({ token: org.token, org: org.login }).searchBranches(repoFullName, q, signal);
}

/**
 * Live, read-only branch search of one repo of the movement. Delivery managers only: it spends the org's
 * GitHub rate limit. (The list of affected repos, GET branches without `repo`, stays login-only.)
 */
export async function searchBranches(deliveryId: string, movementId: string, repoInput: unknown, qInput: unknown, actor: MovementActor, deps: GithubDeps = {}) {
  if (!actor.isManager) throw new MovementError(403, "Only delivery managers can search branches", "forbidden");
  const q = typeof qInput === "string" ? qInput.trim() : "";
  if (q.length > 100 || !SEARCH_RE.test(q) || q.includes("..") || q.includes("//") || q.startsWith("/")) {
    throw new MovementError(400, "q must be at most 100 characters of letters, digits and . _ - / (no '..', '//' or leading '/')", "bad_request");
  }
  if (typeof repoInput !== "string" || !repoInput.trim() || repoInput.length > 200) throw new MovementError(400, "repo is required", "bad_request");
  const repo = normalizeRepo(repoInput);
  await loadMovement(db, deliveryId, movementId);
  const [rows, tracked] = await Promise.all([loadItemRows(db, movementId), trackedRepos(db)]);
  const t = tracked.find((x) => normalizeRepo(x.name) === repo);
  if (!t && !affectedRepos(rows).includes(repo)) throw new MovementError(400, `${repo} is not a repo of this movement or a tracked repo`, "bad_request");
  // An affected repo Flux does not track: the owner is unknown, so it cannot be searched.
  if (!t) return { repo, branches: [] as string[], searched: false };
  // One timer: it aborts the GitHub request itself (no request left running) and is always cleared.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SEARCH_TIMEOUT_MS);
  try {
    const search = deps.searchBranches ?? defaultBranchSearch;
    const aborted = new Promise<never>((_, reject) => ac.signal.addEventListener("abort", () => reject(new Error("timed out"))));
    const list = await Promise.race([search(t.fullName, q, ac.signal), aborted]);
    return { repo, branches: list.slice(0, MAX_SEARCH_RESULTS), searched: true, truncated: list.length > MAX_SEARCH_RESULTS };
  } catch {
    // No upstream text: it can carry a request URL.
    throw new MovementError(503, "GitHub could not be searched right now", "github_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// signers
// ---------------------------------------------------------------------------------------------

export async function setSigners(deliveryId: string, movementId: string, input: unknown, actor: MovementActor) {
  const next = normalizeSigners(input, true);
  return inTx(async (tx, notes) => {
    const head = await loadMovement(tx, deliveryId, movementId, true);
    guard("setSigners", head, actor);
    const { rows } = await loadSlots(tx, movementId);
    // The slots as they will be: still different people, each a Flux user.
    const finalEmails = Object.fromEntries(MOVEMENT_SLOT_VALUES.map((sl) => [sl, next[sl]?.email ?? rows.find((r) => r.slot === sl)?.email ?? ""])) as Record<MovementSlot, string>;
    assertDistinct(finalEmails);
    await assertSignersExist(tx, Object.fromEntries(MOVEMENT_SLOT_VALUES.filter((sl) => next[sl] && !sameEmail(rows.find((r) => r.slot === sl)?.email ?? "", next[sl]!.email)).map((sl) => [sl, next[sl]!])));
    const changes: Record<string, { from: string; to: string }> = {};
    for (const slot of MOVEMENT_SLOT_VALUES) {
      const n = next[slot];
      const cur = rows.find((r) => r.slot === slot);
      if (n && !cur) {
        // A movement made before the QA lead slot existed has no row for it: naming one adds the slot.
        await tx.insert(deliveryMovementSignoffs).values({ movementId, slot, userEmail: n.email, userName: n.name });
        changes[slot] = { from: "", to: n.email };
        notes.push((x) =>
          x.notifySignerAssigned({ movementId, deliveryId, deliveryName: head.deliveryName, environment: head.environment, slot, email: n.email, assignedBy: actor.email })
        );
        continue;
      }
      if (!n || !cur) continue;
      if (sameEmail(cur.email, n.email)) {
        if ((n.name ?? null) !== cur.name && n.name) await tx.update(deliveryMovementSignoffs).set({ userName: n.name }).where(and(eq(deliveryMovementSignoffs.movementId, movementId), eq(deliveryMovementSignoffs.slot, slot)));
        continue;
      }
      await tx
        .update(deliveryMovementSignoffs)
        .set({ userEmail: n.email, userName: n.name, signedAt: null, signedHash: null })
        .where(and(eq(deliveryMovementSignoffs.movementId, movementId), eq(deliveryMovementSignoffs.slot, slot)));
      changes[slot] = { from: cur.email, to: n.email };
      notes.push((x) =>
        x.notifySignerAssigned({ movementId, deliveryId, deliveryName: head.deliveryName, environment: head.environment, slot, email: n.email, assignedBy: actor.email })
      );
    }
    if (Object.keys(changes).length === 0) return { changed: false };
    await tx.update(deliveryMovements).set({ updatedAt: new Date() }).where(eq(deliveryMovements.id, movementId));
    await addEvent(tx, movementId, "signers_changed", actor, { changes });
    return { changed: true };
  });
}

// ---------------------------------------------------------------------------------------------
// sign / start / done / cancel
// ---------------------------------------------------------------------------------------------

type Outcome<T> = { ok: T } | { deny: Denied };

/** While the last refresh could not persist, nothing may be approved or started on the stale state. */
function assertRefreshOk(head: MovementHead): void {
  if (head.refreshError) {
    throw new MovementError(409, `The last refresh failed (${head.refreshError}); refresh again before approving`, "refresh_failed", { refreshError: head.refreshError });
  }
}

/**
 * Bring the stored hash in line with what the stored inputs give NOW (state rule applied), so a
 * sign-off or start is judged against the real current checklist. Returns it with the slots as
 * they are afterwards.
 */
async function syncedState(tx: Executor, notes: Notification[], head: MovementHead, actor: MovementActor, slots0: Slots) {
  const rows = await loadItemRows(tx, head.id);
  const cl = await currentChecklist(tx, head, rows);
  // The "previous" checklist of the event is the snapshot of the old hash when one exists (a signed hash always has one).
  const ap = await applyChecklist(tx, { head, cl, actor, slots: slots0, previous: () => checklistFromSnapshot(tx, head.id, head.checklistHash) });
  notes.push(...ap.notifications);
  const slots = ap.cleared > 0 ? (await loadSlots(tx, head.id)).slots : slots0;
  return { rows, cl, status: ap.status, slots };
}

export async function signMovement(deliveryId: string, movementId: string, slot: unknown, hash: unknown, actor: MovementActor) {
  if (typeof slot !== "string" || !(MOVEMENT_SLOT_VALUES as readonly string[]).includes(slot)) throw new MovementError(400, "slot must be deployer, ba, lead or qa_lead", "bad_request");
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) throw new MovementError(400, "hash must be the checklist hash you reviewed", "bad_request");
  const s = slot as MovementSlot;
  const outcome = await inTx<Outcome<{ status: string; hash: string; allSigned: boolean }>>(async (tx, notes) => {
    const head = await loadMovement(tx, deliveryId, movementId, true);
    const { slots: slots0 } = await loadSlots(tx, movementId);
    guard("sign", head, actor, slots0, s);
    assertRefreshOk(head);
    const st = await syncedState(tx, notes, head, actor, slots0);
    const included = st.rows.filter(isEffectivelyIncluded).length;
    const ok = checkSignable({ currentHash: st.cl.hash, signingHash: hash, includedCount: included });
    // Committed with the sync above: a stale-hash refusal still persists what the rule changed.
    if (!ok.ok) return { deny: ok };
    if (st.status !== "ready" && st.status !== "signed_off") return { deny: { ok: false, code: "conflict", message: `Cannot sign a movement that is ${st.status}`, extra: { status: st.status } } };
    if (st.slots[s].signedHash === hash) return { ok: { status: st.status, hash, allSigned: st.status === "signed_off" } };
    const now = new Date();
    await tx
      .update(deliveryMovementSignoffs)
      .set({ signedAt: now, signedHash: hash })
      .where(and(eq(deliveryMovementSignoffs.movementId, movementId), eq(deliveryMovementSignoffs.slot, s)));
    st.slots[s] = { ...st.slots[s], signedHash: hash };
    await addEvent(tx, movementId, "signed", actor, { slot: s, hash });
    await writeSnapshot(tx, movementId, st.cl, "signoff", actor.id);
    const next = statusAfterSign(st.slots, hash);
    await tx.update(deliveryMovements).set({ updatedAt: now, ...(next !== st.status ? { status: next } : {}) }).where(eq(deliveryMovements.id, movementId));
    if (next === "signed_off" && st.status !== "signed_off") {
      await addEvent(tx, movementId, "signed_off", actor, { hash });
      notes.push((n) => n.notifyReadyToDeploy({ movementId, deliveryId, deliveryName: head.deliveryName, environment: head.environment, deployerEmail: st.slots.deployer.email, hash }));
    }
    return { ok: { status: next, hash, allSigned: next === "signed_off" } };
  });
  if ("deny" in outcome) throwDenied(outcome.deny);
  return outcome.ok;
}

export async function startMovement(deliveryId: string, movementId: string, actor: MovementActor) {
  const outcome = await inTx<Outcome<{ status: string; hash: string; alreadyStarted?: boolean }>>(async (tx, notes) => {
    const head = await loadMovement(tx, deliveryId, movementId, true);
    const { slots: slots0 } = await loadSlots(tx, movementId);
    if (head.status === "in_progress") {
      // Already started (a double click, a retry): the same answer, after the same permission check.
      const d = authorize("start", { status: "signed_off", actor, slots: slots0 });
      if (!d.ok) throwDenied(d);
      return { ok: { status: "in_progress", hash: head.checklistHash ?? "", alreadyStarted: true } };
    }
    guard("start", head, actor, slots0);
    assertRefreshOk(head);
    const st = await syncedState(tx, notes, head, actor, slots0);
    if (st.status !== "signed_off") return { deny: { ok: false, code: "conflict", message: "The checklist changed after the sign-offs; everyone must sign again", extra: { currentHash: st.cl.hash, status: st.status } } };
    const ok = checkStartable({ slots: st.slots, currentHash: st.cl.hash, includedCount: st.rows.filter(isEffectivelyIncluded).length });
    if (!ok.ok) return { deny: ok };
    await writeSnapshot(tx, movementId, st.cl, "start", actor.id);
    const now = new Date();
    await tx.update(deliveryMovements).set({ status: "in_progress", startedAt: now, updatedAt: now }).where(eq(deliveryMovements.id, movementId));
    await addEvent(tx, movementId, "started", actor, { hash: st.cl.hash });
    return { ok: { status: "in_progress", hash: st.cl.hash } };
  });
  if ("deny" in outcome) throwDenied(outcome.deny);
  return outcome.ok;
}

export interface DoneInput {
  results?: Array<{ issueId: string; result: MovementResult; comment?: string | null }>;
  comment?: string | null;
}

function cleanComment(v: unknown, what: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new MovementError(400, `${what} must be text`, "bad_request");
  const t = v.trim();
  if (t.length > 500) throw new MovementError(400, `${what} is at most 500 characters`, "bad_request");
  return t || null;
}

export async function doneMovement(deliveryId: string, movementId: string, input: DoneInput, actor: MovementActor) {
  const results = input.results ?? [];
  if (!Array.isArray(results) || results.length > MAX_BODY_ITEMS) throw new MovementError(400, `results must be an array of at most ${MAX_BODY_ITEMS}`, "bad_request");
  const comment = cleanComment(input.comment, "comment");
  const given = new Map<string, { result: MovementResult; comment: string | null }>();
  for (const r of results) {
    if (!r || typeof r.issueId !== "string" || !isMovementResult(r.result) || r.result === "pending") {
      throw new MovementError(400, "each result needs an issueId and a result of moved or held", "bad_request");
    }
    given.set(r.issueId, { result: r.result, comment: cleanComment(r.comment, "result comment") });
  }
  return inTx(async (tx, notes) => {
    const head = await loadMovement(tx, deliveryId, movementId, true);
    const { slots } = await loadSlots(tx, movementId);
    if (head.status === "done") {
      // Already done (a double click, a retry): the same answer, after the same permission check.
      const d = authorize("done", { status: "in_progress", actor, slots });
      if (!d.ok) throwDenied(d);
      const done = await loadItemRows(tx, movementId);
      return { status: "done" as const, moved: done.filter((r) => r.result === "moved").length, held: done.filter((r) => r.result === "held").length, alreadyDone: true };
    }
    guard("done", head, actor, slots);
    const rows = await loadItemRows(tx, movementId, true);
    const known = new Set(rows.map((r) => r.issueId));
    for (const id of given.keys()) if (!known.has(id)) throw new MovementError(404, "Some Jiras are not part of this movement", "not_found");

    // The hash can still change while in progress (recorded, never a reset); keep it current.
    const cl = await currentChecklist(tx, head, rows);
    const ap = await applyChecklist(tx, { head, cl, actor, slots, previous: () => checklistFromSnapshot(tx, head.id, head.checklistHash) });
    notes.push(...ap.notifications);

    const updates: Array<{ issue_id: string; result: MovementResult; result_comment: string | null }> = [];
    let moved = 0;
    let held = 0;
    for (const r of rows) {
      const g = given.get(r.issueId);
      // Prefilled from the tick: included = moved, everything else = held.
      const inc = isEffectivelyIncluded(r);
      const result: MovementResult = g ? g.result : inc ? "moved" : "held";
      if (result === "moved" && !inc) throw new MovementError(400, `${r.key} was not selected, so it cannot be marked moved`, "bad_request");
      const rc = g ? g.comment : r.resultComment;
      if (result === "moved") moved++;
      else held++;
      if (r.result !== result || (r.resultComment ?? null) !== rc) updates.push({ issue_id: r.issueId, result, result_comment: rc });
    }
    if (updates.length > 0) {
      await tx.execute(sql`
        update delivery_movement_items as i set result = v.result::movement_result, result_comment = v.result_comment
        from jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) as v(issue_id uuid, result text, result_comment text)
        where i.movement_id = ${movementId} and i.issue_id = v.issue_id`);
    }
    await writeSnapshot(tx, movementId, cl, "done", actor.id);
    const now = new Date();
    await tx
      .update(deliveryMovements)
      .set({ status: "done", doneAt: now, doneBy: actor.id, doneByName: actor.name, updatedAt: now })
      .where(eq(deliveryMovements.id, movementId));
    await addEvent(tx, movementId, "done", actor, { moved, held, ...(comment ? { comment } : {}) });
    const recipients = [...new Set(MOVEMENT_SLOT_VALUES.map((s) => slots[s].email).filter(Boolean))];
    notes.push((n) => n.notifyDone({ movementId, deliveryId, deliveryName: head.deliveryName, environment: head.environment, recipients, moved, held }));
    return { status: "done" as const, moved, held, alreadyDone: false };
  });
}

export async function cancelMovement(deliveryId: string, movementId: string, reason: unknown, actor: MovementActor) {
  const text = cleanComment(reason, "reason");
  return inTx(async (tx) => {
    const head = await loadMovement(tx, deliveryId, movementId, true);
    guard("cancel", head, actor);
    await tx.update(deliveryMovements).set({ status: "cancelled", updatedAt: new Date() }).where(eq(deliveryMovements.id, movementId));
    await addEvent(tx, movementId, "cancelled", actor, { from: head.status, ...(text ? { reason: text } : {}) });
    return { status: "cancelled" as const };
  });
}

// ---------------------------------------------------------------------------------------------
// after "done": propose and confirm the delivery statuses
// ---------------------------------------------------------------------------------------------

export interface StatusProposal {
  issueId: string;
  itemId: string;
  key: string;
  summary: string;
  current: DeliveryStatusValue;
  to: DeliveryStatusValue;
  reason: string;
  /** current != to, and nothing in the way */
  willChange: boolean;
  /** Why this one will be left alone ("already delivered"); absent when it can be written. */
  skipReason?: string;
}

/**
 * delivery_status belongs to the ISSUE and is mirrored to every delivery that holds it, so a status is
 * only a fact after the PROD movement; demo / uat movements propose nothing.
 */
export const NOT_PROD_NOTE = "Delivery statuses are kept per Jira and shared by every delivery, so they are proposed and confirmed only after a prod movement.";

export function proposalFor(
  env: string,
  r: Pick<ItemRow, "included" | "readiness" | "result" | "resultComment">
): { to: DeliveryStatusValue; reason: string } {
  if (isEffectivelyIncluded(r) && r.result === "moved") return { to: "delivered", reason: `Moved to ${env}` };
  const why = r.resultComment ? `: ${r.resultComment}` : isEffectivelyIncluded(r) ? "" : " (not selected)";
  return { to: "not_delivered", reason: `Not moved to ${env}${why}`.slice(0, 500) };
}

async function proposals(ex: Executor, head: MovementHead): Promise<{ list: StatusProposal[]; missing: number }> {
  const rows = await loadItemRows(ex, head.id);
  const di = await ex
    .select({ id: deliveryItems.id, issueId: deliveryItems.issueId, status: deliveryItems.status })
    .from(deliveryItems)
    .where(eq(deliveryItems.deliveryId, head.deliveryId));
  const byIssue = new Map(di.map((d) => [d.issueId, d]));
  const list: StatusProposal[] = [];
  let missing = 0;
  for (const r of rows) {
    const item = byIssue.get(r.issueId);
    if (!item) {
      missing++; // removed from the delivery since: nothing to set
      continue;
    }
    const p = proposalFor(head.environment, r);
    // Never take a Jira back from "delivered" (it may have shipped through another delivery).
    const skipReason = p.to === "not_delivered" && item.status === "delivered" ? "already delivered" : undefined;
    list.push({
      issueId: r.issueId,
      itemId: item.id,
      key: r.key,
      summary: r.summary,
      current: item.status,
      to: p.to,
      reason: p.reason,
      willChange: item.status !== p.to && !skipReason,
      ...(skipReason ? { skipReason } : {}),
    });
  }
  return { list, missing };
}

export async function proposeStatuses(deliveryId: string, movementId: string) {
  const head = await loadMovement(db, deliveryId, movementId);
  if (head.status !== "done") throw new MovementError(409, "Statuses can be proposed once the movement is done", "conflict", { status: head.status });
  if (head.environment !== "prod") {
    return { proposals: [], counts: { total: 0, willChange: 0, delivered: 0, notDelivered: 0 }, missing: 0, note: NOT_PROD_NOTE };
  }
  const { list, missing } = await proposals(db, head);
  return {
    proposals: list.map((p) => ({ issueId: p.issueId, key: p.key, summary: p.summary, current: p.current, to: p.to, reason: p.reason, willChange: p.willChange, ...(p.skipReason ? { skipReason: p.skipReason } : {}) })),
    counts: { total: list.length, willChange: list.filter((p) => p.willChange).length, delivered: list.filter((p) => p.to === "delivered").length, notDelivered: list.filter((p) => p.to === "not_delivered").length },
    missing,
    note: null as string | null,
  };
}

export interface ConfirmResult {
  results: Array<{ issueId: string; key: string; outcome: "updated" | "unchanged" | "skipped"; to: DeliveryStatusValue; reason?: string }>;
  counts: { updated: number; unchanged: number; skipped: number };
  /** For the route's cache revalidation. */
  affectedDeliveryIds: string[];
  projectIds: string[];
}

/**
 * Write the proposed statuses through the shared routine (same gates, same history). Idempotent.
 * Who may confirm: the deployer slot's user or an ADMIN (state.ts), ACCEPTED as the rule: the person who
 * ran the deployment is the one who knows what moved; a delivery manager who is not the deployer cannot.
 * PROD movements only (see NOT_PROD_NOTE).
 */
export async function confirmStatuses(
  deliveryId: string,
  movementId: string,
  issueIds: unknown,
  actor: MovementActor,
  /** The gate check is injectable because its feature-flag read needs the Next runtime. */
  deps: {
    gates?: typeof checkItemStatusGates;
    /** Called once, in the `finally`, whenever at least one status was written (also after a partial failure), so the caller can revalidate its caches. */
    onWritten?: (w: { projectIds: string[]; affectedDeliveryIds: string[] }) => void;
  } = {}
): Promise<ConfirmResult> {
  const gates = deps.gates ?? checkItemStatusGates;
  const only = issueIds === undefined || issueIds === null ? null : new Set(cleanIssueIds(issueIds));
  const head = await loadMovement(db, deliveryId, movementId);
  const { slots } = await loadSlots(db, movementId);
  guard("confirm", head, actor, slots);
  if (head.environment !== "prod") throw new MovementError(409, NOT_PROD_NOTE, "not_prod", { environment: head.environment });
  const { list } = await proposals(db, head);
  if (only) {
    const known = new Set(list.map((p) => p.issueId));
    const unknown = [...only].filter((i) => !known.has(i));
    if (unknown.length > 0) throw new MovementError(400, "Some issueIds are not part of this movement's delivery", "bad_request", { count: unknown.length });
  }
  const res: ConfirmResult = { results: [], counts: { updated: 0, unchanged: 0, skipped: 0 }, affectedDeliveryIds: [], projectIds: [head.projectId] };
  const affected = new Set<string>();
  let failed = false;
  try {
    for (const p of list) {
      if (only && !only.has(p.issueId)) continue;
      if (p.skipReason) {
        res.counts.skipped++;
        res.results.push({ issueId: p.issueId, key: p.key, outcome: "skipped", to: p.to, reason: p.skipReason });
        continue;
      }
      if (!p.willChange) {
        res.counts.unchanged++;
        res.results.push({ issueId: p.issueId, key: p.key, outcome: "unchanged", to: p.to });
        continue;
      }
      // Same preconditions as the item PATCH (DONE status, test-case sign-off): a blocked item is skipped, not an error.
      const gate = await gates({ issueId: p.issueId, fromStatus: p.current, toStatus: p.to });
      if (gate.blocked) {
        res.counts.skipped++;
        res.results.push({ issueId: p.issueId, key: p.key, outcome: "skipped", to: p.to, reason: gate.message });
        continue;
      }
      const w = await writeItemStatus({
        deliveryId,
        deliveryName: head.deliveryName,
        itemId: p.itemId,
        issueId: p.issueId,
        nextStatus: p.to,
        statusComment: p.reason,
        userId: actor.id,
        userName: actor.name,
        // Re-checked under the row locks: a Jira that became delivered meanwhile is not taken back.
        neverDowngradeFrom: "delivered",
      });
      if (w.skipped === "downgrade") {
        res.counts.skipped++;
        res.results.push({ issueId: p.issueId, key: p.key, outcome: "skipped", to: p.to, reason: "already delivered" });
        continue;
      }
      for (const d of w.affectedDeliveryIds) affected.add(d);
      res.counts[w.changed ? "updated" : "unchanged"]++;
      res.results.push({ issueId: p.issueId, key: p.key, outcome: w.changed ? "updated" : "unchanged", to: p.to });
    }
  } catch (e) {
    failed = true;
    throw e;
  } finally {
    // Written even when a later item failed: what WAS changed must be on record (statuses are already committed per item).
    if (res.counts.updated > 0 || failed) {
      try {
        await addEvent(db, movementId, "statuses_confirmed", actor, { ...res.counts, ...(failed ? { partial: true } : {}) });
      } catch {
        // The statuses themselves are in delivery_status_history; losing this summary event is not fatal.
      }
    }
    res.affectedDeliveryIds = [...affected];
    if (affected.size > 0) {
      try {
        const rows = await db.select({ projectId: deliveries.projectId }).from(deliveries).where(inArray(deliveries.id, [...affected]));
        res.projectIds = [...new Set([head.projectId, ...rows.map((r) => r.projectId)])];
      } catch {
        // keep the movement's own project
      }
    }
    if (res.counts.updated > 0) deps.onWritten?.({ projectIds: res.projectIds, affectedDeliveryIds: res.affectedDeliveryIds });
  }
  return res;
}

// ---------------------------------------------------------------------------------------------
// "what changed since I signed"
// ---------------------------------------------------------------------------------------------

/** SIGNERS ONLY (the people who approve); everybody else gets 403. The view reports `permissions.changes`. */
export async function getChangesSinceSigned(deliveryId: string, movementId: string, actor: MovementActor) {
  const head = await loadMovement(db, deliveryId, movementId);
  const [{ slots }, rows] = await Promise.all([loadSlots(db, movementId), loadItemRows(db, movementId)]);
  const mine = slotsOf(slots, actor.email);
  if (mine.length === 0) throw new MovementError(403, "You are not a signer of this movement", "forbidden");
  const cl = await currentChecklist(db, head, rows);

  // The hash this user signed: their live sign-off, else (after a reset cleared it) their last "signed" event.
  let signedHash: string | null = mine.map((s) => slots[s].signedHash).find((h): h is string => !!h) ?? null;
  if (!signedHash) {
    const [ev] = await db
      .select({ detail: deliveryMovementEvents.detail })
      .from(deliveryMovementEvents)
      .where(and(eq(deliveryMovementEvents.movementId, movementId), eq(deliveryMovementEvents.type, "signed"), eq(deliveryMovementEvents.actor, actor.id)))
      .orderBy(desc(deliveryMovementEvents.at))
      .limit(1);
    const h = (ev?.detail as { hash?: unknown } | null)?.hash;
    signedHash = typeof h === "string" ? h : null;
  }

  // The capped diffs the resets stored (small), newest first.
  const events = await db
    .select({ type: deliveryMovementEvents.type, at: deliveryMovementEvents.at, actorName: deliveryMovementEvents.actorName, detail: deliveryMovementEvents.detail })
    .from(deliveryMovementEvents)
    .where(and(eq(deliveryMovementEvents.movementId, movementId), inArray(deliveryMovementEvents.type, ["checklist_changed", "changed_after_start"])))
    .orderBy(desc(deliveryMovementEvents.at))
    .limit(5);
  const base = { currentHash: cl.hash, events: events.map((e) => ({ type: e.type, at: e.at.toISOString(), actorName: e.actorName, detail: e.detail })) };
  if (!signedHash) return { ...base, signedHash: null, unchanged: false, diff: null, snapshotMissing: false };
  if (signedHash === cl.hash) return { ...base, signedHash, unchanged: true, diff: null, snapshotMissing: false };

  const [snap] = await db
    .select({ body: deliveryMovementSnapshots.body })
    .from(deliveryMovementSnapshots)
    .where(and(eq(deliveryMovementSnapshots.movementId, movementId), eq(deliveryMovementSnapshots.hash, signedHash)))
    .limit(1);
  const old = safeDecodeSnapshot(snap?.body);
  if (!old) return { ...base, signedHash, unchanged: false, diff: null, snapshotMissing: true };
  // The FULL diff (no byte cap): this is the one place it is built, on request.
  return { ...base, signedHash, unchanged: false, diff: diffChecklists(old, cl, { maxBytes: Infinity }), snapshotMissing: false };
}

// ---------------------------------------------------------------------------------------------
// lazy detail: one Jira's records, and the event history
// ---------------------------------------------------------------------------------------------

/**
 * Per-PR record detail of ONE Jira, read from the stored inputs on demand (the view only carries counts):
 * the pointer, the record's own status and heads, and how many open unknowns it has. Never the comment text.
 */
export async function getItemDetail(deliveryId: string, movementId: string, issueId: string) {
  const head = await loadMovement(db, deliveryId, movementId);
  const rows = await loadItemRows(db, movementId);
  const row = rows.find((r) => r.issueId === issueId);
  if (!row) throw new MovementError(404, "Jira is not part of this movement", "not_found");
  // Decoded once per (movement, inputs hash) and kept in the bounded LRU; the sign-off chips are NOT part of it.
  const stored = await loadStoredRecords(db, movementId, { cacheKey: head.inputsHash });
  if (stored.state !== "ok") throw new MovementError(409, "The stored Jira records are missing or unreadable; refresh first", "inputs_stale");
  const stale = new Set(row.warnings.filter((w) => w.code === "stale_record").map((w) => w.message.split(":")[0]));
  // The records as the checklist sees them: a comment corrected in Flux is the edited one.
  const edits = head.commentEditsHash ? (await loadEdits(db, movementId)).filter((e) => e.issueId === issueId) : [];
  const editedIds = new Set(edits.map((e) => e.commentId));
  const records = applyEdits(stored.records, edits).get(issueId) ?? [];
  // One row per PR a comment covers: a per-PR record is one row, a union comment one row per PR it lists
  // (`scope: "union"`, same comment id), so the existing list of PRs keeps working.
  const prs = records.flatMap((r) => {
    const union = isUnion(r);
    const covers = union ? coversOf(r) : [{ repo: r.marker.repo ?? "", pr: r.marker.pr ?? 0, sha: undefined, branch: undefined, note: undefined, state: undefined } as CoverRef];
    return covers.map((c) => {
      const key = prKey(c.repo, c.pr);
      return {
        prKey: key,
        repo: c.repo || null,
        pr: c.pr || null,
        commentId: r.comment.id,
        edited: editedIds.has(r.comment.id),
        version: r.marker.version,
        updated: r.comment.updated ?? r.comment.created,
        postedAt: r.marker.at,
        agent: r.marker.agent,
        status: r.status,
        statusText: r.statusText,
        scope: union ? ("union" as const) : ("pr" as const),
        ...(union ? { target: r.marker.target ?? null } : {}),
        // As the comment wrote it (a union comment lists each PR with its branch, commit and a short note).
        branch: c.branch ?? r.facts.branch ?? null,
        sha: c.sha ?? null,
        note: c.note ?? null,
        prState: c.state ?? (union ? null : (r.facts.prState ?? null)),
        headReviewed: union ? (c.sha ?? null) : (r.facts.headReviewed ?? null),
        headMovedTo: r.facts.headMovedTo ?? null,
        stale: stale.has(key) || (!union && !!r.facts.headMovedTo),
        unknowns: r.unknowns.length,
        parseNotes: r.warnings.length,
        sections: r.sections.length,
      };
    });
  });
  // One row per review COMMENT, with the PRs it covers.
  const comments = records.map((r) => ({
    commentId: r.comment.id,
    edited: editedIds.has(r.comment.id),
    scope: isUnion(r) ? ("union" as const) : ("pr" as const),
    version: r.marker.version,
    status: r.status,
    updated: r.comment.updated ?? r.comment.created,
    target: r.marker.target ?? null,
    covers: coversOf(r).map((c) => prKey(c.repo, c.pr)),
  }));
  return {
    issue: summarizeView(row),
    movement: { id: head.id, environment: head.environment, status: head.status },
    // The complete lists (the view cuts them at 12 per Jira).
    ...splitNotes(row.warnings),
    prs,
    comments,
  };
}

/** The detailed checklist of ONE Jira (all its records, comment edits applied; tick / override state ignored). */
export async function getItemChecklist(deliveryId: string, movementId: string, issueId: string): Promise<Checklist> {
  const head = await loadMovement(db, deliveryId, movementId);
  const rows = await loadItemRows(db, movementId);
  return itemChecklist(db, head, rows, issueId);
}

/** The detailed checklist of ONE Jira plus its services (one entry per canonical service, the same helpers as the roll-up). */
export async function getItemChecklistWithServices(deliveryId: string, movementId: string, issueId: string) {
  const head = await loadMovement(db, deliveryId, movementId);
  const rows = await loadItemRows(db, movementId);
  return itemChecklistAndServices(db, head, rows, issueId);
}

export const EVENTS_PAGE_MAX = 50;

/**
 * The full event history, newest first, <= 50 per page. `before` is the opaque `nextBefore` of the
 * previous page (an ISO timestamp is accepted too); the keyset is (at, id) at full microsecond
 * precision so events written in the same millisecond are neither repeated nor skipped.
 */
export async function listEvents(deliveryId: string, movementId: string, opts: { limit?: unknown; before?: unknown } = {}) {
  await loadMovement(db, deliveryId, movementId);
  const n = Number(opts.limit ?? 20);
  const limit = Number.isInteger(n) ? Math.min(Math.max(n, 1), EVENTS_PAGE_MAX) : 20;
  let cursor: { at: string; id: string | null } | null = null;
  if (opts.before !== undefined && opts.before !== null && opts.before !== "") {
    const [at, id] = String(opts.before).split("|");
    if (!/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d{1,6})?([+-]\d\d(:?\d\d)?|Z)?$/.test(at) || (id !== undefined && !isValidUuid(id))) {
      throw new MovementError(400, "before must be the nextBefore of the previous page or an ISO timestamp", "bad_request");
    }
    cursor = { at, id: id ?? null };
  }
  const atText = sql<string>`${deliveryMovementEvents.at}::text`;
  const rows = await db
    .select({ id: deliveryMovementEvents.id, type: deliveryMovementEvents.type, at: deliveryMovementEvents.at, atText, actorName: deliveryMovementEvents.actorName, detail: deliveryMovementEvents.detail })
    .from(deliveryMovementEvents)
    .where(
      cursor
        ? and(
            eq(deliveryMovementEvents.movementId, movementId),
            cursor.id
              ? sql`(${deliveryMovementEvents.at}, ${deliveryMovementEvents.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
              : sql`${deliveryMovementEvents.at} < ${cursor.at}::timestamptz`
          )
        : eq(deliveryMovementEvents.movementId, movementId)
    )
    .orderBy(desc(deliveryMovementEvents.at), desc(deliveryMovementEvents.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    events: page.map((e) => ({ id: e.id, type: e.type, at: e.at.toISOString(), actorName: e.actorName, detail: e.detail })),
    nextBefore: rows.length > limit && last ? `${last.atText}|${last.id}` : null,
  };
}

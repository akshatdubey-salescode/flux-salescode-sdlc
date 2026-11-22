/**
 * DB helpers shared by refresh.ts and service.ts: the locked movement read, item rows, the
 * checklist built FROM THE STORED INPUTS (no Jira call), the hash-change rule applied to a
 * movement, events and snapshots. Every function takes an executor so it runs inside the caller's
 * transaction.
 *
 * Rule for readers: never select `delivery_movements.inputs` / `delivery_movement_snapshots.body`
 * except where the code says so; list and view queries name their columns.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import {
  deliveries,
  deliveryMovementEvents,
  deliveryMovementItems,
  deliveryMovementSignoffs,
  deliveryMovementSnapshots,
  deliveryMovementCommentEdits,
  deliveryMovements,
  jiraIssues,
  tcRounds,
  tcSets,
  tcSignoffs,
} from "@/lib/db/schema";
import { ByteLru } from "../cache";
import {
  buildChecklist,
  diffChecklists,
  encodeSnapshot,
  safeDecodeSnapshot,
  type Checklist,
  type ChecklistInput,
  type ChecklistJiraInput,
  type SignoffEntry,
} from "../checklist";
import { effectiveRecords } from "../checklist/build";
import { canonical } from "../checklist/canon";
import { jiraServices, type JiraServices } from "../checklist/services";
import { normalizeRepo, type ParsedRecord } from "../record";
import {
  MAX_EVENT_DETAIL_BYTES,
  MOVEMENT_SLOT_VALUES,
  type MovementEnvironment,
  type MovementReadiness,
  type MovementResult,
  type MovementSlot,
  type MovementSnapshotReason,
  type MovementStatus,
} from "../values";
import { decodeInputs } from "./inputs";
import { applyEdits, type CommentEdit } from "./edits";
import { notifySafely, type MovementNotifier } from "./notify";
import { onHashChange, type Slots, type HashChange } from "./state";
import { MovementError, type BranchPick, type MovementActor, type RecordRef, type WarningRef } from "./types";

export type Executor = Pick<typeof db, "select" | "selectDistinctOn" | "insert" | "update" | "delete" | "execute">;

// ---------------------------------------------------------------------------------------------
// movement row
// ---------------------------------------------------------------------------------------------

/** Every movement column EXCEPT `inputs` (the blob), plus what the delivery adds. */
export const MOVEMENT_COLUMNS = {
  id: deliveryMovements.id,
  deliveryId: deliveryMovements.deliveryId,
  environment: deliveryMovements.environment,
  status: deliveryMovements.status,
  branches: deliveryMovements.branches,
  checklistHash: deliveryMovements.checklistHash,
  createdBy: deliveryMovements.createdBy,
  createdByName: deliveryMovements.createdByName,
  createdAt: deliveryMovements.createdAt,
  startedAt: deliveryMovements.startedAt,
  doneAt: deliveryMovements.doneAt,
  doneByName: deliveryMovements.doneByName,
  updatedAt: deliveryMovements.updatedAt,
  refreshedAt: deliveryMovements.refreshedAt,
  lastNotifiedHash: deliveryMovements.lastNotifiedHash,
  inputsHash: deliveryMovements.inputsHash,
  refreshError: deliveryMovements.refreshError,
  commentEditsHash: deliveryMovements.commentEditsHash,
  // The blob itself is never selected; only whether there is one.
  hasInputs: sql<boolean>`${deliveryMovements.inputs} is not null`,
  deliveryName: deliveries.name,
  deliveryDate: deliveries.deliveryDate,
  projectId: deliveries.projectId,
  deliveryDeletedAt: deliveries.deletedAt,
  deliveryCompletedAt: deliveries.completedAt,
} as const;

type RawHead = {
  id: string;
  deliveryId: string;
  environment: MovementEnvironment;
  status: MovementStatus;
  branches: unknown;
  checklistHash: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: Date;
  startedAt: Date | null;
  doneAt: Date | null;
  doneByName: string | null;
  updatedAt: Date;
  refreshedAt: Date | null;
  lastNotifiedHash: string | null;
  inputsHash: string | null;
  refreshError: string | null;
  commentEditsHash: string | null;
  hasInputs: boolean;
  deliveryName: string;
  deliveryDate: string;
  projectId: string;
  deliveryDeletedAt: Date | null;
  deliveryCompletedAt: Date | null;
};

export interface MovementHead extends Omit<RawHead, "branches"> {
  branches: BranchPick[];
}

export function cleanBranches(v: unknown): BranchPick[] {
  if (!Array.isArray(v)) return [];
  const out: BranchPick[] = [];
  for (const b of v) {
    if (b && typeof b === "object" && typeof (b as BranchPick).repo === "string" && typeof (b as BranchPick).branch === "string") {
      out.push({ repo: (b as BranchPick).repo, branch: (b as BranchPick).branch });
    }
  }
  return out;
}

const toHead = (r: RawHead): MovementHead => ({ ...r, branches: cleanBranches(r.branches) });

/**
 * The movement (of this delivery when `deliveryId` is given), or 404 (also when the delivery was
 * deleted). `lock` = FOR UPDATE on the movement row.
 */
export async function loadMovement(ex: Executor, deliveryId: string | null, movementId: string, lock = false): Promise<MovementHead> {
  const q = ex
    .select(MOVEMENT_COLUMNS)
    .from(deliveryMovements)
    .innerJoin(deliveries, eq(deliveries.id, deliveryMovements.deliveryId))
    .where(
      deliveryId === null
        ? eq(deliveryMovements.id, movementId)
        : and(eq(deliveryMovements.id, movementId), eq(deliveryMovements.deliveryId, deliveryId))
    );
  const [row] = lock ? await q.for("update", { of: deliveryMovements }) : await q;
  if (!row || row.deliveryDeletedAt) throw new MovementError(404, "Movement not found", "not_found");
  return toHead(row as RawHead);
}

export interface SlotRow {
  slot: MovementSlot;
  email: string;
  name: string | null;
  signedAt: Date | null;
  signedHash: string | null;
}

export async function loadSlots(ex: Executor, movementId: string): Promise<{ rows: SlotRow[]; slots: Slots }> {
  const rows = await ex
    .select({
      slot: deliveryMovementSignoffs.slot,
      email: deliveryMovementSignoffs.userEmail,
      name: deliveryMovementSignoffs.userName,
      signedAt: deliveryMovementSignoffs.signedAt,
      signedHash: deliveryMovementSignoffs.signedHash,
    })
    .from(deliveryMovementSignoffs)
    .where(eq(deliveryMovementSignoffs.movementId, movementId));
  const slots = {} as Slots;
  for (const s of MOVEMENT_SLOT_VALUES) {
    const r = rows.find((x) => x.slot === s);
    slots[s] = { email: r?.email ?? "", signedHash: r?.signedHash ?? null };
  }
  return { rows, slots };
}

// ---------------------------------------------------------------------------------------------
// item rows
// ---------------------------------------------------------------------------------------------

export interface ItemRow {
  issueId: string;
  key: string;
  summary: string;
  included: boolean;
  /** A person ticked / unticked it (a refresh then never changes `included`). */
  tickSet: boolean;
  readiness: MovementReadiness;
  overrideReason: string | null;
  overrideBy: string | null;
  overrideByName: string | null;
  overrideAt: Date | null;
  result: MovementResult;
  resultComment: string | null;
  warnings: WarningRef[];
  recordRefs: RecordRef[];
}

export async function loadItemRows(ex: Executor, movementId: string, lock = false): Promise<ItemRow[]> {
  const q = ex
    .select({
      issueId: deliveryMovementItems.issueId,
      key: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      included: deliveryMovementItems.included,
      tickSet: deliveryMovementItems.tickSet,
      readiness: deliveryMovementItems.readiness,
      overrideReason: deliveryMovementItems.overrideReason,
      overrideBy: deliveryMovementItems.overrideBy,
      overrideByName: deliveryMovementItems.overrideByName,
      overrideAt: deliveryMovementItems.overrideAt,
      result: deliveryMovementItems.result,
      resultComment: deliveryMovementItems.resultComment,
      warnings: deliveryMovementItems.warnings,
      recordRefs: deliveryMovementItems.recordRefs,
    })
    .from(deliveryMovementItems)
    .innerJoin(jiraIssues, eq(jiraIssues.id, deliveryMovementItems.issueId))
    .where(eq(deliveryMovementItems.movementId, movementId))
    .orderBy(asc(jiraIssues.jiraKey));
  const rows = lock ? await q.for("update", { of: deliveryMovementItems }) : await q;
  return rows.map((r) => ({
    ...r,
    summary: r.summary ?? "",
    warnings: Array.isArray(r.warnings) ? (r.warnings as WarningRef[]) : [],
    recordRefs: Array.isArray(r.recordRefs) ? (r.recordRefs as RecordRef[]) : [],
  }));
}

/** Latest dev / tester sign-off per issue (existing test-case data), ONE batched query. Highlighted by the UI, never blocking. */
export async function tcSignoffsFor(ex: Executor, issueIds: readonly string[]): Promise<Map<string, { dev?: SignoffEntry; tester?: SignoffEntry }>> {
  const out = new Map<string, { dev?: SignoffEntry; tester?: SignoffEntry }>();
  if (issueIds.length === 0) return out;
  try {
    const rows = await ex
      .selectDistinctOn([tcSets.issueId, tcSignoffs.role], {
        issueId: tcSets.issueId,
        role: tcSignoffs.role,
        by: tcSignoffs.committedByName,
        byId: tcSignoffs.committedBy,
        at: tcSignoffs.committedAt,
      })
      .from(tcSets)
      .innerJoin(tcRounds, eq(tcRounds.setId, tcSets.id))
      .innerJoin(tcSignoffs, eq(tcSignoffs.roundId, tcRounds.id))
      .where(inArray(tcSets.issueId, [...issueIds]))
      .orderBy(tcSets.issueId, tcSignoffs.role, desc(tcSignoffs.committedAt));
    for (const r of rows) {
      const e = out.get(r.issueId) ?? {};
      e[r.role === "dev" ? "dev" : "tester"] = { by: r.by ?? r.byId, at: r.at.toISOString() };
      out.set(r.issueId, e);
    }
  } catch {
    // Test-case data is informational; the checklist is still built (the sign-off chips just show "missing").
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// checklist from stored data
// ---------------------------------------------------------------------------------------------

/**
 * What the checklist uses as "ticked": the user's tick, unless the Jira is blocked (and not
 * overridden). The stored tick is never touched by a refresh, so a Jira that is blocked for a
 * moment (Jira outage, a record being re-posted) comes back ticked as soon as it is valid again.
 */
export const isEffectivelyIncluded = (r: Pick<ItemRow, "included" | "readiness">): boolean => r.included && r.readiness !== "blocked";

/** Repos named by the records of the Jiras that are IN the checklist, and by any Jira at all (normalised names). */
export function repoUsage(rows: readonly ItemRow[]): { included: Set<string>; all: Set<string> } {
  const included = new Set<string>();
  const all = new Set<string>();
  for (const r of rows) {
    for (const p of r.recordRefs) {
      if (!p.repo) continue;
      const repo = normalizeRepo(p.repo);
      all.add(repo);
      if (isEffectivelyIncluded(r)) included.add(repo);
    }
  }
  return { included, all };
}

/**
 * A branch pick for a repo that only HELD Jiras use (some Jira names it, but none that is in the checklist) is kept
 * on the movement and shown (flagged `heldOnly`), but it is not part of the checklist: it cannot change the hash, reset a
 * sign-off or raise a branch mismatch for a repo nobody is releasing. A pick for a repo NO Jira names (a tracked repo the
 * user added on purpose) stays in. Unticking the Jira that owned a repo therefore drops its pick out of the hash, and
 * re-ticking brings it back.
 */
export function effectiveBranchPicks(branches: readonly BranchPick[], rows: readonly ItemRow[]): BranchPick[] {
  const { included, all } = repoUsage(rows);
  return branches.filter((b) => {
    const repo = normalizeRepo(b.repo);
    return included.has(repo) || !all.has(repo);
  });
}

export function jirasFor(
  rows: readonly ItemRow[],
  recordsByIssue: ReadonlyMap<string, ParsedRecord[]>,
  signoffs: ReadonlyMap<string, { dev?: SignoffEntry; tester?: SignoffEntry }>
): ChecklistJiraInput[] {
  return rows.map((r) => ({
    key: r.key,
    summary: r.summary || undefined,
    included: isEffectivelyIncluded(r),
    readiness: r.readiness,
    override: r.readiness === "override" ? { reason: r.overrideReason ?? "", by: r.overrideByName ?? r.overrideBy ?? "" } : undefined,
    signoffs: signoffs.get(r.issueId),
    records: recordsByIssue.get(r.issueId) ?? [],
  }));
}

/** The checklist input (also what the summary roll-up is built from): effective ticks, picks and the comment edits applied. */
export function checklistInputFrom(
  environment: MovementEnvironment,
  branches: readonly BranchPick[],
  rows: readonly ItemRow[],
  recordsByIssue: ReadonlyMap<string, ParsedRecord[]>,
  signoffs: ReadonlyMap<string, { dev?: SignoffEntry; tester?: SignoffEntry }>,
  edits: readonly CommentEdit[] = []
): ChecklistInput {
  return { environment, jiras: jirasFor(rows, applyEdits(recordsByIssue, edits), signoffs), branches: effectiveBranchPicks(branches, rows) };
}

export function buildFrom(
  environment: MovementEnvironment,
  branches: readonly BranchPick[],
  rows: readonly ItemRow[],
  recordsByIssue: ReadonlyMap<string, ParsedRecord[]>,
  signoffs: ReadonlyMap<string, { dev?: SignoffEntry; tester?: SignoffEntry }>,
  edits: readonly CommentEdit[] = []
): Checklist {
  return buildChecklist(checklistInputFrom(environment, branches, rows, recordsByIssue, signoffs, edits));
}

/** The edits of a movement, with their text (read only when a build needs them: `comment_edits_hash` says whether there are any). */
export async function loadEdits(ex: Executor, movementId: string): Promise<CommentEdit[]> {
  const rows = await ex
    .select({
      issueId: deliveryMovementCommentEdits.issueId,
      commentId: deliveryMovementCommentEdits.commentId,
      text: deliveryMovementCommentEdits.editedText,
      baseUpdated: deliveryMovementCommentEdits.baseUpdated,
      editedBy: deliveryMovementCommentEdits.editedBy,
      editedByName: deliveryMovementCommentEdits.editedByName,
      editedAt: deliveryMovementCommentEdits.editedAt,
    })
    .from(deliveryMovementCommentEdits)
    .where(eq(deliveryMovementCommentEdits.movementId, movementId))
    .orderBy(asc(deliveryMovementCommentEdits.commentId));
  return rows;
}

export type CommentEditMeta = Omit<CommentEdit, "text">;

/** Who edited what, without the text (the view's `edited` flags). */
export async function loadEditsMeta(ex: Executor, movementId: string): Promise<CommentEditMeta[]> {
  return ex
    .select({
      issueId: deliveryMovementCommentEdits.issueId,
      commentId: deliveryMovementCommentEdits.commentId,
      baseUpdated: deliveryMovementCommentEdits.baseUpdated,
      editedBy: deliveryMovementCommentEdits.editedBy,
      editedByName: deliveryMovementCommentEdits.editedByName,
      editedAt: deliveryMovementCommentEdits.editedAt,
    })
    .from(deliveryMovementCommentEdits)
    .where(eq(deliveryMovementCommentEdits.movementId, movementId))
    .orderBy(asc(deliveryMovementCommentEdits.commentId));
}

/** Built checklists, bounded by bytes and 60 s (the tc dev/tester chips are not part of the key). */
const checklistCache = new ByteLru<string, { cl: Checklist; bytes: number; services?: JiraServices }>({
  maxBytes: 8 * 1024 * 1024,
  ttlMs: 60_000,
  weigh: (v) => v.bytes,
});
export const checklistCacheForTests = checklistCache;
/** Test seam: the decoded-blob cache is cleared together with the checklist cache. */
export const clearMovementCachesForTests = () => {
  checklistCache.clear();
  storedCache.clear();
};

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

/** Cache key: (movementId, inputsHash, tickHash, branchHash, overrideHash) as the plan names them. */
export function checklistKey(head: Pick<MovementHead, "id" | "inputsHash" | "environment" | "branches" | "commentEditsHash">, rows: readonly ItemRow[]): string {
  const tick = sha1(rows.map((r) => `${r.issueId}:${r.included ? 1 : 0}`).join(","));
  const override = sha1(rows.map((r) => `${r.issueId}:${r.readiness}:${r.overrideReason ?? ""}:${r.overrideBy ?? ""}`).join(","));
  const branch = sha1(canonical([head.environment, head.branches]));
  return `${head.id}|${head.inputsHash ?? "-"}|${tick}|${branch}|${override}|${head.commentEditsHash ?? "-"}`;
}

export type StoredRecords =
  | { state: "ok"; records: Map<string, ParsedRecord[]>; readiness: Map<string, "ready" | "blocked"> }
  /** No blob stored (never refreshed). */
  | { state: "missing" }
  /** A blob is there but cannot be read (corrupt, over the decode cap, or an older INPUTS_VERSION). */
  | { state: "corrupt" };

/**
 * Decoded stored records for the lazy item detail, keyed by (movementId, inputsHash) so a rewritten blob is never
 * served stale. Same byte-bounded LRU class as the checklist cache; the weight is an estimate (decoded JSON is
 * about 12x its gzip size). Holds records and readiness only, never the tc sign-off chips (those change on their own).
 */
type OkRecords = Extract<StoredRecords, { state: "ok" }>;
const storedCache = new ByteLru<string, { s: OkRecords; bytes: number }>({ maxBytes: 24 * 1024 * 1024, ttlMs: 60_000, weigh: (v) => v.bytes });

/**
 * The records stored in the movement (the ONE place the blob is read for rebuilds), as a tri-state.
 * `cacheKey` (the movement's inputs_hash) opts into the decoded-blob cache; refresh never uses it because it
 * is checking that the stored copy is READABLE.
 */
export async function loadStoredRecords(ex: Executor, movementId: string, opts: { cacheKey?: string | null } = {}): Promise<StoredRecords> {
  const key = opts.cacheKey ? `${movementId}|${opts.cacheKey}` : null;
  if (key) {
    const hit = storedCache.get(key);
    if (hit) return hit.s;
  }
  const [row] = await ex.select({ inputs: deliveryMovements.inputs }).from(deliveryMovements).where(eq(deliveryMovements.id, movementId));
  if (!row?.inputs) return { state: "missing" };
  const dec = decodeInputs(row.inputs);
  if (!dec) return { state: "corrupt" };
  const out: OkRecords = {
    state: "ok",
    records: new Map(dec.items.map((i) => [i.issue, i.records])),
    readiness: new Map(dec.items.map((i) => [i.issue, i.readiness])),
  };
  if (key) storedCache.set(key, { s: out, bytes: row.inputs.length * 12 });
  return out;
}

/** The checklist stored in the latest snapshot with this hash (done / cancelled movements read it instead of the inputs). */
export async function checklistFromSnapshot(ex: Executor, movementId: string, hash: string | null): Promise<Checklist | null> {
  if (!hash) return null;
  const [snap] = await ex
    .select({ body: deliveryMovementSnapshots.body })
    .from(deliveryMovementSnapshots)
    .where(and(eq(deliveryMovementSnapshots.movementId, movementId), eq(deliveryMovementSnapshots.hash, hash)))
    .limit(1);
  return safeDecodeSnapshot(snap?.body);
}

/**
 * The current checklist, built from the stored inputs and the item rows; no Jira call.
 * FAILS CLOSED: when there are items but the stored inputs are missing or unreadable, an empty-records
 * checklist (a different hash) must never be built, so it throws 409 `inputs_stale` ("refresh first").
 * A finished (done / cancelled) movement reads the snapshot of its last hash instead.
 */
export async function currentChecklist(ex: Executor, head: MovementHead, rows: readonly ItemRow[]): Promise<Checklist> {
  if (head.status === "done" || head.status === "cancelled") {
    const snap = await checklistFromSnapshot(ex, head.id, head.checklistHash);
    if (snap) return snap;
  }
  const key = checklistKey(head, rows);
  const hit = checklistCache.get(key);
  if (hit) return hit.cl;
  const [stored, signoffs] = await Promise.all([loadStoredRecords(ex, head.id), tcSignoffsFor(ex, rows.map((r) => r.issueId))]);
  if (stored.state !== "ok" && rows.length > 0) {
    throw new MovementError(409, "The stored Jira records are missing or unreadable; refresh first", "inputs_stale");
  }
  const edits = head.commentEditsHash ? await loadEdits(ex, head.id) : [];
  const cl = buildFrom(head.environment, head.branches, rows, stored.state === "ok" ? stored.records : new Map(), signoffs, edits);
  checklistCache.set(key, { cl, bytes: Buffer.byteLength(JSON.stringify(cl)) });
  return cl;
}

/** The checklist INPUT of the movement as it is now (for the summary roll-up); the same inputs, edits and ticks as `currentChecklist`. */
export async function currentChecklistInput(ex: Executor, head: MovementHead, rows: readonly ItemRow[]): Promise<ChecklistInput> {
  const [stored, signoffs] = await Promise.all([loadStoredRecords(ex, head.id, { cacheKey: head.inputsHash }), tcSignoffsFor(ex, rows.map((r) => r.issueId))]);
  if (stored.state !== "ok" && rows.length > 0) {
    throw new MovementError(409, "The stored Jira records are missing or unreadable; refresh first", "inputs_stale");
  }
  const edits = head.commentEditsHash ? await loadEdits(ex, head.id) : [];
  return checklistInputFrom(head.environment, head.branches, rows, stored.state === "ok" ? stored.records : new Map(), signoffs, edits);
}

/**
 * The detailed checklist of ONE Jira: all its records (comment edits applied), the movement's environment, and
 * NOTHING of the tick / override / branch state, so it is shown for held Jiras too. Cached with the same LRU, keyed by
 * (movementId, inputsHash, issueId, editsHash).
 */
export async function itemChecklist(ex: Executor, head: MovementHead, rows: readonly ItemRow[], issueId: string): Promise<Checklist> {
  return (await itemChecklistAndServices(ex, head, rows, issueId)).checklist;
}

/**
 * The same checklist plus the Jira's services (`jiraServices`, computed from THAT Jira's records' facts with the helpers the roll-up uses), so the Jira card
 * names exactly the services the movement board counts. Cached together.
 */
export async function itemChecklistAndServices(ex: Executor, head: MovementHead, rows: readonly ItemRow[], issueId: string): Promise<{ checklist: Checklist; services: JiraServices }> {
  const row = rows.find((r) => r.issueId === issueId);
  if (!row) throw new MovementError(404, "Jira is not part of this movement", "not_found");
  const key = `${head.id}|${head.inputsHash ?? "-"}|item:${issueId}|${head.commentEditsHash ?? "-"}`;
  const hit = checklistCache.get(key);
  if (hit?.services) return { checklist: hit.cl, services: hit.services };
  const stored = await loadStoredRecords(ex, head.id, { cacheKey: head.inputsHash });
  if (stored.state !== "ok") throw new MovementError(409, "The stored Jira records are missing or unreadable; refresh first", "inputs_stale");
  const edits = head.commentEditsHash ? await loadEdits(ex, head.id) : [];
  const records = applyEdits(stored.records, edits).get(issueId) ?? [];
  const cl = buildChecklist({
    environment: head.environment,
    jiras: [{ key: row.key, summary: row.summary || undefined, included: true, readiness: "ready", records }],
    branches: [],
  });
  const services = jiraServices(effectiveRecords({ key: row.key, included: true, readiness: "ready", records }).recs.map((r) => r.rec));
  checklistCache.set(key, { cl, services, bytes: Buffer.byteLength(JSON.stringify(cl)) + Buffer.byteLength(JSON.stringify(services)) });
  return { checklist: cl, services };
}

// ---------------------------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------------------------

/** Shrink a detail object under MAX_EVENT_DETAIL_BYTES: long arrays are halved (and counted), then dropped. */
export function capDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!detail) return null;
  const size = (o: unknown) => Buffer.byteLength(JSON.stringify(o));
  let d: Record<string, unknown> = { ...detail };
  for (let round = 0; round < 12 && size(d) > MAX_EVENT_DETAIL_BYTES; round++) {
    let shrunk = false;
    for (const [k, v] of Object.entries(d)) {
      if (Array.isArray(v) && v.length > 1) {
        const keep = Math.floor(v.length / 2);
        d = { ...d, [k]: v.slice(0, keep), [`${k}More`]: ((d[`${k}More`] as number) ?? 0) + v.length - keep };
        shrunk = true;
      }
    }
    if (!shrunk) break;
  }
  if (size(d) > MAX_EVENT_DETAIL_BYTES) return { truncated: true, originalBytes: size(detail) };
  return d;
}

export async function addEvent(
  ex: Executor,
  movementId: string,
  type: string,
  actor: Pick<MovementActor, "id" | "name"> | null,
  detail?: Record<string, unknown>
): Promise<void> {
  await ex.insert(deliveryMovementEvents).values({
    movementId,
    type,
    actor: actor?.id ?? null,
    actorName: actor?.name ?? null,
    // The statement's own clock (not the transaction's now()): events of one transaction keep their order.
    at: sql`clock_timestamp()`,
    detail: capDetail(detail),
  });
}

// ---------------------------------------------------------------------------------------------
// snapshots
// ---------------------------------------------------------------------------------------------

/** One gzip'd checklist per (movement, hash); the first reason/taker wins. A failure to encode is reported, never thrown. */
export async function writeSnapshot(
  ex: Executor,
  movementId: string,
  cl: Checklist,
  reason: MovementSnapshotReason,
  takenBy: string | null
): Promise<boolean> {
  try {
    const body = encodeSnapshot(cl);
    await ex
      .insert(deliveryMovementSnapshots)
      .values({ movementId, hash: cl.hash, reason, takenBy, body })
      .onConflictDoNothing({ target: [deliveryMovementSnapshots.movementId, deliveryMovementSnapshots.hash] });
    return true;
  } catch (e) {
    console.warn("[movement] snapshot not written:", e instanceof Error ? e.message.slice(0, 120) : "error");
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// the hash-change rule, applied
// ---------------------------------------------------------------------------------------------

export type Notification = (n: MovementNotifier) => Promise<void> | void;

export interface ApplyResult {
  status: MovementStatus;
  hash: string;
  hashChanged: boolean;
  statusChanged: boolean;
  /** True when anything was written other than refreshed_at. */
  changed: boolean;
  cleared: number;
  event: HashChange["event"];
  notifications: Notification[];
}

export interface ApplyArgs {
  head: MovementHead;
  cl: Checklist;
  actor: Pick<MovementActor, "id" | "name"> | null;
  slots: Slots;
  /** Builds the checklist as it was BEFORE this change, for the diff of the event (only called when an event is written). */
  previous?: () => Promise<Checklist | null>;
  /** Extra columns to write in the same UPDATE (inputs, inputs_hash, refreshed_at, ...). */
  set?: Partial<typeof deliveryMovements.$inferInsert>;
  /** Something other than the hash changed (items written, inputs rewritten): bump updated_at. */
  realChange?: boolean;
  /** Only a successful refresh moves a movement out of draft; edits made in draft leave it there. */
  fromRefresh?: boolean;
}

/**
 * Compare the new checklist hash with the stored one and apply the state rule (state.ts): clear
 * sign-offs and go back to ready, or record changed_after_start, or become ready. Writes ONE
 * movement UPDATE (together with `set`), the sign-off clear and the event; returns the
 * notifications to send after the transaction commits.
 */
export async function applyChecklist(ex: Executor, a: ApplyArgs): Promise<ApplyResult> {
  const { head, cl } = a;
  const prev = head.checklistHash;
  const next = cl.hash;
  const hashChanged = prev !== next;

  let signedCount = 0;
  if (hashChanged && (head.status === "ready" || head.status === "signed_off")) {
    signedCount = Object.values(a.slots).filter((s) => s.signedHash !== null).length;
  }
  let change = onHashChange({ status: head.status, prevHash: prev, nextHash: next, signedCount });
  if (head.status === "draft" && !a.fromRefresh) change = { status: "draft", clearSignoffs: false, event: null, notify: null };
  const statusChanged = change.status !== head.status;

  const set: Partial<typeof deliveryMovements.$inferInsert> = { ...(a.set ?? {}) };
  if (hashChanged) set.checklistHash = next;
  if (statusChanged) set.status = change.status;
  const changed = hashChanged || statusChanged || a.realChange === true;
  if (changed) set.updatedAt = new Date();

  const notifications: Notification[] = [];
  const base = { movementId: head.id, deliveryId: head.deliveryId, deliveryName: head.deliveryName, environment: head.environment };

  let cleared = 0;
  if (change.clearSignoffs) {
    const res = await ex
      .update(deliveryMovementSignoffs)
      .set({ signedAt: null, signedHash: null })
      .where(and(eq(deliveryMovementSignoffs.movementId, head.id), isNotNull(deliveryMovementSignoffs.signedHash)))
      .returning({ slot: deliveryMovementSignoffs.slot });
    cleared = res.length;
  }

  let counts = { added: 0, removed: 0, changed: 0 };
  if (change.event) {
    let diff: unknown = null;
    if (change.event !== "became_ready" && prev !== null && a.previous) {
      const old = await a.previous();
      if (old) {
        const d = diffChecklists(old, cl, { maxBytes: 2800 });
        counts = d.counts;
        diff = d;
      }
    }
    await addEvent(ex, head.id, change.event, a.actor, {
      from: prev ? prev.slice(0, 12) : null,
      to: next.slice(0, 12),
      ...(change.event === "became_ready" ? {} : { cleared, counts }),
      ...(diff ? { diff } : {}),
    });
  }

  if (change.notify && head.lastNotifiedHash !== next) {
    set.lastNotifiedHash = next;
    const signers = MOVEMENT_SLOT_VALUES.map((s) => a.slots[s].email).filter(Boolean);
    const kind = change.notify;
    notifications.push((n) =>
      n.notifyReset({ ...base, hash: next, signers: [...new Set(signers)], changedAfterStart: kind === "after_start", counts })
    );
  }

  if (Object.keys(set).length > 0) await ex.update(deliveryMovements).set(set).where(eq(deliveryMovements.id, head.id));

  return { status: change.status, hash: next, hashChanged, statusChanged, changed, cleared, event: change.event, notifications };
}

/** Run notifications collected inside a transaction, after it committed. */
export async function sendNotifications(list: readonly Notification[]): Promise<void> {
  for (const n of list) await notifySafely(n);
}

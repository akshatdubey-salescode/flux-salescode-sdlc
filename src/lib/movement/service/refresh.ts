/**
 * refreshMovement: re-read the Jira records of a movement and bring the stored state up to date.
 *
 *   items of the delivery (cap 200) -> trees -> records -> (optional) current heads of the PRs the
 *   comments cover -> readiness per root            (ALL I/O, outside any transaction: no
 *                                                    connection is held while Jira / GitHub answer)
 *
 * Each Jira carries ONE review comment listing every PR; Flux no longer looks PRs up (no PR table).
 *   then ONE short transaction: advisory lock -> row locks -> decide per item -> conditional writes
 *   -> rebuild the checklist -> hash rule (state.ts) -> events.
 *
 * Two discovery strategies, on purpose: an explicit Refresh (`bypass`) reads the comments of every node
 * directly when the run has <= 150 nodes, a cron / background refresh uses the 60 s result cache and the
 * `comment ~ "DEPLOYMENT-RECORD"` discovery JQL for the sub-Jiras. Jira's comment index is only
 * eventually consistent, so discovery can MISS a record posted a few seconds ago; it does not lose an old one.
 * That is acceptable: the miss can only delay a newly posted record to the next run (it never makes a record
 * seen before disappear, so the checklist cannot flap between the two modes), and an explicit Refresh is one click.
 *
 * One refresh per movement at a time: an in-process in-flight set (a second caller gets
 * {refreshing:true}), the 10 s skip, and pg_try_advisory_xact_lock around the write phase.
 *
 * Rules the code keeps:
 *  - fail CLOSED without destroying approved state: a Jira failure on a NEW item
 *    blocks it; on an item that ALREADY exists it changes nothing but a "could not re-check since"
 *    warning (readiness, tick, records and therefore the checklist hash stay), so an outage can never
 *    reset a sign-off. Nothing throws away the stored inputs.
 *  - nothing internal is stored or returned: warnings and errors are generic; the detail is logged.
 *  - conditional writes: only item rows whose values changed (ONE statement for all of them), the
 *    inputs blob only when the record POINTER set changed, `updated_at` and events only on a real
 *    change. A refresh that finds nothing writes one tiny UPDATE (refreshed_at).
 *  - the user's tick survives; a new item is ticked when ready; an override survives while the item
 *    is still blocked and is dropped (item becomes ready) when the record becomes valid.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { deliveryItems, deliveryMovementItems, deliveryMovements, githubRepos, jiraIssues } from "@/lib/db/schema";
import { fetchPrHeads, type HeadsOptions } from "../heads";
import { coversOf, headTargets, isUnion } from "../covers";
import type { ParsedRecord } from "../record";
import { computeReadiness, type Readiness } from "../readiness";
import { loadRecords, type IssueRecords, type LoadOptions } from "../records";
import { resolveTrees, type RootTree, type TreeNode } from "../tree";
import { formatIst } from "../time-format";
import { canonical } from "../checklist/canon";
import { isFrozen } from "./state";
import {
  MAX_RECORD_REFS_PER_ITEM,
  MAX_WARNING_MESSAGE_CHARS,
  MAX_WARNINGS_PER_ITEM,
  type MovementReadiness,
  type MovementStatus,
} from "../values";
import {
  addEvent,
  applyChecklist,
  buildFrom,
  loadItemRows,
  loadMovement,
  loadEdits,
  loadSlots,
  loadStoredRecords,
  sendNotifications,
  tcSignoffsFor,
  type Executor,
  type ItemRow,
  type MovementHead,
  type StoredRecords,
} from "./core";
import { encodeInputs, InputsError, pointerHash, type StoredItem } from "./inputs";
import { sourcesByProject, type SourceInput } from "./source";
import { MovementError, type MovementActor, type RecordRef, type WarningRef } from "./types";

export const MAX_MOVEMENT_ITEMS = 200;

/** A refresh newer than this is skipped unless `bypass` (double clicks, tabs polling). */
export const MIN_REFRESH_INTERVAL_MS = 10_000;
export interface RefreshOptions {
  /** Explicit Refresh: ignore the 10 s skip and the 60 s per-Jira result cache. */
  bypass?: boolean;
  /** One JiraSource for all projects, or a factory per project id. Default: the project's own credentials. */
  source?: SourceInput;
  /** Injectable GitHub side (tests): the head-SHA transport / tokens, and the owner of a repo name (default: github_repos). */
  github?: { heads?: HeadsOptions; ownersOf?: (repoNames: string[]) => Promise<Map<string, string>> };
  /** Isolated caches for tests; defaults are the shared bounded instances. */
  loadOptions?: Pick<LoadOptions, "recordCache" | "resultCache" | "pageSize" | "maxComments">;
  now?: () => Date;
  /** Test seam: a lower cap than MAX_INPUTS_BYTES, to exercise the over-cap path without 4 MiB of records. */
  inputsCapBytes?: number;
  /** Who asked (events); null for the cron. */
  actor?: Pick<MovementActor, "id" | "name"> | null;
}

export interface RefreshResult {
  /** Another refresh of this movement is running. */
  refreshing?: true;
  skipped?: "recent" | "frozen";
  /** Nothing was written; the message is safe to show. */
  error?: string;
  ok?: true;
  movementStatus?: MovementStatus;
  hash?: string | null;
  /** Anything other than refreshed_at was written. */
  changed?: boolean;
  inputsWritten?: boolean;
  items?: { total: number; ready: number; blocked: number; override: number; added: number; removed: number; updated: number; degraded: number };
  jiraCalls?: number;
  recordsParsed?: number;
}

type DeliveryIssue = { issueId: string; key: string; summary: string; projectId: string };

async function loadDeliveryIssues(ex: Executor, deliveryId: string): Promise<DeliveryIssue[]> {
  return ex
    .select({ issueId: deliveryItems.issueId, key: jiraIssues.jiraKey, summary: jiraIssues.summary, projectId: jiraIssues.projectId })
    .from(deliveryItems)
    .innerJoin(jiraIssues, eq(jiraIssues.id, deliveryItems.issueId))
    .where(eq(deliveryItems.deliveryId, deliveryId))
    .orderBy(asc(jiraIssues.jiraKey))
    .limit(MAX_MOVEMENT_ITEMS + 1);
}

// ---------------------------------------------------------------------------------------------
// pure pieces (exported for unit tests)
// ---------------------------------------------------------------------------------------------

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * What a user may read about a failure: the readiness step's own text can echo a Jira error body or a
 * database message, so those codes are replaced by a generic sentence (the detail is logged, never stored).
 */
const GENERIC_BY_CODE: Readonly<Record<string, string>> = {
  tree_unreadable: "Jira could not be read",
  tree_incomplete: "The Jira tree is incomplete (a limit was reached or part of it could not be read)",
  comments_unreadable: "Jira comments could not be read fully",
};
const safeMessage = (code: string, message: string, ref?: string | null) =>
  clip(GENERIC_BY_CODE[code] ? `${GENERIC_BY_CODE[code]}${code === "comments_unreadable" && ref ? ` (${ref})` : ""}` : message, MAX_WARNING_MESSAGE_CHARS);

/** Blockers first, then warnings; capped at 20 entries of < 200 characters; generic wording for failures. */
export function warningsOf(r: Pick<Readiness, "blockers" | "warnings">): WarningRef[] {
  const all: WarningRef[] = [
    ...r.blockers.map((b) => ({ code: b.code as string, message: safeMessage(b.code, b.message, b.ref) })),
    ...r.warnings.map((w) => ({ code: w.code as string, message: safeMessage(w.code, w.message, w.ref) })),
  ];
  if (all.length <= MAX_WARNINGS_PER_ITEM) return all;
  const more = all.length - (MAX_WARNINGS_PER_ITEM - 1);
  return [...all.slice(0, MAX_WARNINGS_PER_ITEM - 1), { code: "more", message: `${more} more not shown` }];
}

/**
 * The record pointers of an item (at most 50). A per-PR record is one pointer; a UNION record (one review
 * comment covering several PRs) is one pointer per covered PR, all sharing the comment id, marked `scope: "union"`.
 */
export function refsOf(records: readonly ParsedRecord[]): RecordRef[] {
  const out: RecordRef[] = [];
  for (const r of records) {
    const base = { commentId: r.comment.id, version: r.marker.version, updated: r.comment.updated ?? r.comment.created ?? null, status: r.status };
    if (isUnion(r)) {
      for (const c of coversOf(r)) out.push({ repo: c.repo, pr: c.pr, ...base, scope: "union" });
    } else if (r.marker.repo && r.marker.pr !== null) {
      out.push({ repo: r.marker.repo, pr: r.marker.pr, ...base });
    }
    if (out.length >= MAX_RECORD_REFS_PER_ITEM) break;
  }
  return out.slice(0, MAX_RECORD_REFS_PER_ITEM);
}

export interface FreshItem {
  issueId: string;
  key: string;
  summary: string;
  readiness: "ready" | "blocked";
  warnings: WarningRef[];
  records: ParsedRecord[];
  /** The Jira / PR data behind this item was partly unreadable: its stored records are kept. */
  degraded: boolean;
}

export interface ItemWrite {
  issueId: string;
  included: boolean;
  readiness: MovementReadiness;
  clearOverride: boolean;
  warnings: WarningRef[];
  recordRefs: RecordRef[];
}

export interface Decision {
  inserts: ItemWrite[];
  updates: ItemWrite[];
  removed: string[];
  /** Rows after the write (for the checklist build). */
  rows: ItemRow[];
  events: { added: string[]; removed: string[]; readiness: Array<{ key: string; from: string; to: string }>; overrideCleared: string[] };
}

export const RECHECK_CODE = "recheck_failed";
export const COMMENT_EDIT_STALE_CODE = "comment_edit_stale";
export const COMMENT_EDIT_STALE_MESSAGE = "The Jira comment changed after the Flux edit: review it";

/** Keep the stored warnings and add "could not re-check since <time>" once (the original time is kept, so a long outage writes nothing). */
export function withRecheckWarning(prev: readonly WarningRef[], sinceIso: string): WarningRef[] {
  if (prev.some((w) => w.code === RECHECK_CODE)) return [...prev];
  // Plain words in a FIXED format (IST, minute precision): the same moment always gives the same text; `at` keeps the exact time.
  const w: WarningRef = { code: RECHECK_CODE, message: `Could not re-check since ${formatIst(sinceIso)}`, at: sinceIso };
  return prev.length >= MAX_WARNINGS_PER_ITEM ? [...prev.slice(0, MAX_WARNINGS_PER_ITEM - 1), w] : [...prev, w];
}

/**
 * Decide every item row from the fresh data and what is stored (pure).
 *  - a NEW item takes the fresh readiness (a degraded one is blocked: fail closed) and is ticked when ready;
 *  - an item that ALREADY exists and could not be re-read (`degraded`) keeps readiness, tick, records and
 *    warnings; only the "could not re-check" warning is added (so the checklist hash cannot change);
 *  - otherwise the user's tick stands; a Jira that was blocked and becomes ready is ticked once, only
 *    while nobody has ticked or unticked it (`tickSet`).
 */
export function decideItems(fresh: readonly FreshItem[], existing: readonly ItemRow[], nowIso = new Date().toISOString()): Decision {
  const byId = new Map(existing.map((r) => [r.issueId, r]));
  const freshIds = new Set(fresh.map((f) => f.issueId));
  const d: Decision = { inserts: [], updates: [], removed: [], rows: [], events: { added: [], removed: [], readiness: [], overrideCleared: [] } };

  for (const f of fresh) {
    const ex = byId.get(f.issueId);

    if (ex && f.degraded) {
      const warnings = withRecheckWarning(ex.warnings, nowIso);
      d.rows.push({ ...ex, summary: f.summary || ex.summary, warnings });
      if (canonical(warnings) !== canonical(ex.warnings)) {
        d.updates.push({ issueId: ex.issueId, included: ex.included, readiness: ex.readiness, clearOverride: false, warnings, recordRefs: ex.recordRefs });
      }
      continue;
    }

    let readiness: MovementReadiness = f.readiness;
    // An override outlives a refresh while the item is still blocked.
    if (f.readiness === "blocked" && ex?.readiness === "override") readiness = "override";
    const clearOverride = !!ex && ex.readiness === "override" && f.readiness === "ready";
    let included: boolean;
    if (!ex) included = readiness !== "blocked";
    else if (!ex.tickSet && ex.readiness !== "ready" && f.readiness === "ready") included = true;
    else included = ex.included;

    const recordRefs = refsOf(f.records);
    const w: ItemWrite = { issueId: f.issueId, included, readiness, clearOverride, warnings: f.warnings, recordRefs };
    const keepOverride = readiness === "override";
    d.rows.push({
      issueId: f.issueId,
      key: f.key,
      summary: f.summary,
      included,
      tickSet: ex?.tickSet ?? false,
      readiness,
      overrideReason: keepOverride ? (ex?.overrideReason ?? null) : null,
      overrideBy: keepOverride ? (ex?.overrideBy ?? null) : null,
      overrideByName: keepOverride ? (ex?.overrideByName ?? null) : null,
      overrideAt: keepOverride ? (ex?.overrideAt ?? null) : null,
      result: ex?.result ?? "pending",
      resultComment: ex?.resultComment ?? null,
      warnings: f.warnings,
      recordRefs,
    });
    if (!ex) {
      d.inserts.push(w);
      d.events.added.push(f.key);
      continue;
    }
    const same =
      ex.included === included &&
      ex.readiness === readiness &&
      !clearOverride &&
      canonical(ex.warnings) === canonical(f.warnings) &&
      canonical(ex.recordRefs) === canonical(recordRefs);
    if (same) continue;
    d.updates.push(w);
    if (ex.readiness !== readiness) d.events.readiness.push({ key: f.key, from: ex.readiness, to: readiness });
    if (clearOverride) d.events.overrideCleared.push(f.key);
  }
  for (const r of existing) {
    if (!freshIds.has(r.issueId)) {
      d.removed.push(r.issueId);
      d.events.removed.push(r.key);
    }
  }
  return d;
}

// ---------------------------------------------------------------------------------------------
// gathering (no DB writes; Jira + GitHub heads)
// ---------------------------------------------------------------------------------------------

interface Gathered {
  fresh: Map<string, FreshItem>; // by issueId
  jiraCalls: number;
  recordsParsed: number;
}

function unreadableTree(root: string, why: string): RootTree {
  return {
    root,
    nodes: [{ key: root, kind: "root", parentKey: null, issueType: "", statusName: "", summary: "" }],
    truncated: false,
    warnings: [],
    linkedTruncated: false,
    errors: [why],
  };
}

/**
 * Current head SHA of the covered PRs whose record wrote the reviewed SHA (one batched GraphQL call per org per
 * <= 30 PRs, read-only; any failure degrades to "unknown" and never fails the refresh). The owner of a repo name
 * comes from `github_repos` (297 rows), `salescode-ai` when the repo is not tracked.
 */
async function currentHeads(records: readonly ParsedRecord[], opts: RefreshOptions): Promise<Map<string, string>> {
  const targets = headTargets(records);
  if (targets.length === 0) return new Map();
  try {
    const names = [...new Set(targets.map((t) => t.repo))];
    const owners = await (opts.github?.ownersOf ?? repoOwners)(names).catch(() => new Map<string, string>());
    return await fetchPrHeads(
      targets.map((t) => ({ repoFullName: owners.get(t.repo) ?? `salescode-ai/${t.repo}`, number: t.pr })),
      opts.github?.heads
    );
  } catch {
    return new Map();
  }
}

async function repoOwners(names: string[]): Promise<Map<string, string>> {
  const rows = await db.select({ name: githubRepos.name, fullName: githubRepos.fullName }).from(githubRepos).where(inArray(githubRepos.name, names)).limit(500);
  return new Map(rows.map((r) => [r.name.toLowerCase(), r.fullName]));
}

async function gather(movementId: string, issues: readonly DeliveryIssue[], opts: RefreshOptions): Promise<Gathered> {
  const sources = await sourcesByProject(
    issues.map((i) => i.projectId),
    opts.source
  );
  const byProject = new Map<string, DeliveryIssue[]>();
  for (const i of issues) byProject.set(i.projectId, [...(byProject.get(i.projectId) ?? []), i]);

  // ---- trees
  let jiraCalls = 0;
  const trees = new Map<string, RootTree>();
  for (const [pid, list] of byProject) {
    try {
      const res = await resolveTrees(sources.get(pid)!, list.map((i) => i.key));
      jiraCalls += res.jiraCalls;
      for (const [k, t] of res.trees) trees.set(k, t);
    } catch {
      for (const i of list) trees.set(i.key.toUpperCase(), unreadableTree(i.key.toUpperCase(), "Jira could not be read"));
    }
  }
  const treeOf = (key: string) => trees.get(key.toUpperCase()) ?? unreadableTree(key.toUpperCase(), `${key} could not be resolved in Jira`);

  // ---- records
  const recordsByIssue = new Map<string, IssueRecords>();
  let recordsParsed = 0;
  for (const [pid, list] of byProject) {
    const nodes: TreeNode[] = list.flatMap((i) => treeOf(i.key).nodes);
    try {
      const res = await loadRecords(sources.get(pid)!, nodes, { ...(opts.loadOptions ?? {}), bypassResultCache: opts.bypass === true });
      jiraCalls += res.stats.jiraCalls;
      recordsParsed += res.stats.recordsParsed;
      for (const [k, v] of res.byIssue) recordsByIssue.set(k, v);
    } catch {
      const error = "records could not be read";
      for (const n of nodes) recordsByIssue.set(n.key, { issueKey: n.key, records: [], commentsSeen: 0, exhausted: false, capped: false, error });
    }
  }

  // ---- current heads of the PRs the comments cover (only those whose record wrote down the reviewed SHA)
  const heads = await currentHeads([...recordsByIssue.values()].flatMap((r) => r.records), opts);

  // ---- readiness per root, and the records it rests on
  const fresh = new Map<string, FreshItem>();
  for (const i of issues) {
    const tree = treeOf(i.key);
    const degraded = tree.errors.length > 0 || tree.nodes.some((n) => !!recordsByIssue.get(n.key)?.error);
    try {
      const r = computeReadiness({ root: tree.root, tree, recordsByIssue, heads });
      // One stored record per review comment, repo spellings reconciled by the readiness step.
      fresh.set(i.issueId, { issueId: i.issueId, key: i.key, summary: i.summary ?? "", readiness: r.readiness, warnings: warningsOf(r), records: r.recordsUsed, degraded });
    } catch {
      // A bug in the readiness step must not lose the item: it is blocked and keeps its stored records.
      fresh.set(i.issueId, {
        issueId: i.issueId,
        key: i.key,
        summary: i.summary ?? "",
        readiness: "blocked",
        warnings: [{ code: "readiness_failed", message: "Readiness could not be computed" }],
        records: [],
        degraded: true,
      });
    }
  }
  // The detail stays on the server, and only counts and short Jira-side texts (never SQL, params or tokens).
  const failedTrees = [...trees.values()].filter((t) => t.errors.length > 0);
  const failedReads = [...recordsByIssue.values()].filter((r) => r.error).length;
  if (failedTrees.length || failedReads) {
    console.warn(
      `[movement] refresh ${movementId} degraded: trees ${failedTrees.length}, comment reads ${failedReads}` +
        (failedTrees[0] ? `, first tree error: ${failedTrees[0].errors[0].slice(0, 100)}` : "")
    );
  }
  return { fresh, jiraCalls, recordsParsed };
}

// ---------------------------------------------------------------------------------------------
// refreshMovement
// ---------------------------------------------------------------------------------------------

function jsonRows(rows: readonly ItemWrite[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      issue_id: r.issueId,
      included: r.included,
      readiness: r.readiness,
      clear_override: r.clearOverride,
      warnings: r.warnings,
      record_refs: r.recordRefs,
    }))
  );
}

const MSG_TOO_MANY = `This delivery has more than ${MAX_MOVEMENT_ITEMS} Jiras; a movement handles at most ${MAX_MOVEMENT_ITEMS}. Split the delivery.`;
const MSG_TOO_LARGE = "The parsed records are too large to store; reduce the Jiras in this movement.";
const MSG_FAILED = "The refresh failed and nothing was changed; try again.";
const MSG_UNREADABLE = "The stored records could not be read while Jira was unreachable; try again when Jira is reachable.";

/**
 * A refresh that cannot persist its result must not leave the movement looking approved-and-current:
 * `refresh_error` (generic text) is set, `refreshed_at` moves, ONE event is written when the message
 * changed. Sign / start are refused while it is set; the next successful refresh clears it.
 */
async function markFailure(ex: Executor, head: Pick<MovementHead, "id" | "refreshError">, message: string, actor: RefreshOptions["actor"], now: Date): Promise<void> {
  const changed = head.refreshError !== message;
  await ex
    .update(deliveryMovements)
    .set({ refreshError: message, refreshedAt: now, ...(changed ? { updatedAt: now } : {}) })
    .where(eq(deliveryMovements.id, head.id));
  if (changed) await addEvent(ex, head.id, "refresh_failed", actor ?? null, { message });
}

/** What the movement looked like when this refresh started: a failure is recorded only if nothing newer happened since. */
export interface Baseline {
  refreshedAt: Date | null;
  inputsHash: string | null;
}

/**
 * Standalone failure record (its own short transaction); never throws. It takes the same advisory lock as the
 * write phase and records nothing when the lock is busy (a writer is at work) or when a newer refresh (success
 * or failure) already moved `refreshed_at` / the inputs, so a stale failure can never overwrite a newer success.
 */
export async function recordRefreshFailure(movementId: string, message: string, actor: RefreshOptions["actor"], baseline?: Baseline): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${movementId}, 0)) as ok`);
      if ((lock.rows[0] as { ok?: boolean } | undefined)?.ok !== true) return;
      const head = await loadMovement(tx, null, movementId, true);
      if (isFrozen(head.status)) return;
      if (baseline && (head.refreshedAt?.getTime() !== baseline.refreshedAt?.getTime() || head.inputsHash !== baseline.inputsHash)) return;
      await markFailure(tx, head, message, actor, new Date());
    });
  } catch {
    // The database itself is failing; nothing more can be recorded.
  }
}

/** Movements being refreshed by THIS process (a second caller gets {refreshing:true}). */
const inflight = new Set<string>();
export const isRefreshing = (movementId: string): boolean => inflight.has(movementId);

export async function refreshMovement(movementId: string, opts: RefreshOptions = {}): Promise<RefreshResult> {
  if (inflight.has(movementId)) return { refreshing: true };
  inflight.add(movementId);
  const ctx: { baseline?: Baseline } = {};
  try {
    return await refreshOnce(movementId, opts, ctx);
  } catch (e) {
    if (e instanceof MovementError) throw e;
    // The write transaction rolled back: nothing was written, the stored inputs are untouched.
    console.warn("[movement] refresh failed:", e instanceof Error ? e.name : "error", (e as { code?: string })?.code ?? "");
    await recordRefreshFailure(movementId, MSG_FAILED, opts.actor, ctx.baseline);
    return { error: MSG_FAILED };
  } finally {
    inflight.delete(movementId);
  }
}

async function refreshOnce(movementId: string, opts: RefreshOptions, ctx: { baseline?: Baseline }): Promise<RefreshResult> {
  // ---- short reads (own connections, released at once)
  const head0 = await loadMovement(db, null, movementId);
  ctx.baseline = { refreshedAt: head0.refreshedAt, inputsHash: head0.inputsHash };
  if (isFrozen(head0.status)) return { skipped: "frozen", movementStatus: head0.status };
  const now0 = opts.now?.() ?? new Date();
  if (!opts.bypass && head0.refreshedAt && now0.getTime() - head0.refreshedAt.getTime() < MIN_REFRESH_INTERVAL_MS) {
    return { skipped: "recent", movementStatus: head0.status };
  }
  const issues = await loadDeliveryIssues(db, head0.deliveryId);
  if (issues.length > MAX_MOVEMENT_ITEMS) {
    await recordRefreshFailure(movementId, MSG_TOO_MANY, opts.actor, ctx.baseline);
    return { error: MSG_TOO_MANY };
  }

  // ---- the slow part: Jira / GitHub. No transaction, no connection held while they answer.
  const g = await gather(movementId, issues, opts);

  // ---- the write phase: ONE short transaction
  let notifications: Awaited<ReturnType<typeof applyChecklist>>["notifications"] = [];
  const result = await db.transaction(async (tx): Promise<RefreshResult> => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${movementId}, 0)) as ok`);
    if ((lock.rows[0] as { ok?: boolean } | undefined)?.ok !== true) return { refreshing: true };

    const head = await loadMovement(tx, null, movementId, true);
    if (isFrozen(head.status)) return { skipped: "frozen", movementStatus: head.status };
    const existing = await loadItemRows(tx, movementId, true);
    const existingById = new Map(existing.map((r) => [r.issueId, r]));
    const current = await loadDeliveryIssues(tx, head.deliveryId);
    // An item added to the delivery while we were reading has no data yet: next refresh. A removed one is dropped.
    const stillThere = current.filter((i) => g.fresh.has(i.issueId));
    const now = opts.now?.() ?? new Date();

    // The stored copy is read at most once: to carry records of items that could not be re-read, to
    // build the "previous" checklist of an event, and to verify it is readable. The verification runs on
    // EVERY refresh (cron included), so a corrupt copy is healed without anyone pressing Refresh.
    let storedMemo: StoredRecords | null = null;
    const stored = async (): Promise<StoredRecords> => (storedMemo ??= await loadStoredRecords(tx, movementId));
    if (head.hasInputs) await stored();

    const fresh: FreshItem[] = [];
    for (const i of stillThere) {
      const f = g.fresh.get(i.issueId)!;
      const ex = existingById.get(i.issueId);
      if (f.degraded && ex) {
        // Could not re-read: keep what was stored (records, readiness, warnings), add only the re-check warning.
        const st = await stored();
        if (st.state !== "ok") {
          await markFailure(tx, head, MSG_UNREADABLE, opts.actor, now);
          return { error: MSG_UNREADABLE };
        }
        fresh.push({
          ...f,
          summary: i.summary ?? f.summary,
          records: st.records.get(i.issueId) ?? [],
          readiness: st.readiness.get(i.issueId) ?? (ex.readiness === "ready" ? "ready" : "blocked"),
          warnings: ex.warnings,
        });
      } else fresh.push({ ...f, summary: i.summary ?? f.summary });
    }

    // Flux-side comment edits are NEVER discarded by a refresh. A Jira comment that changed after it was edited keeps its
    // overlay and gets a (soft) warning on its Jira, so somebody reviews the edit against the new text.
    const edits = head.commentEditsHash ? await loadEdits(tx, movementId) : [];
    if (edits.length > 0) {
      for (const f of fresh) {
        if (f.degraded) continue;
        const stale = edits.some((e) => e.issueId === f.issueId && e.baseUpdated !== null && f.records.some((r) => r.comment.id === e.commentId && (r.comment.updated ?? r.comment.created) !== e.baseUpdated));
        if (stale && f.warnings.length < MAX_WARNINGS_PER_ITEM && !f.warnings.some((w) => w.code === COMMENT_EDIT_STALE_CODE)) {
          f.warnings = [...f.warnings, { code: COMMENT_EDIT_STALE_CODE, message: COMMENT_EDIT_STALE_MESSAGE }];
        }
      }
    }

    const decision = decideItems(fresh, existing, now.toISOString());

    // ---- inputs: written only when the record POINTER set changed (or the stored copy is unreadable)
    const storedItems: StoredItem[] = fresh.map((f) => ({ issue: f.issueId, key: f.key, records: f.records, readiness: f.readiness, warnings: f.warnings }));
    const newPointerHash = pointerHash(storedItems);
    const unreadable = !head.hasInputs || (storedMemo !== null && (storedMemo as StoredRecords).state !== "ok");
    const inputsChanged = newPointerHash !== head.inputsHash || unreadable;
    let blob: Buffer | null = null;
    if (inputsChanged) {
      try {
        blob = encodeInputs(storedItems, opts.inputsCapBytes);
      } catch (e) {
        if (!(e instanceof InputsError)) throw e;
        await markFailure(tx, head, MSG_TOO_LARGE, opts.actor, now);
        return { error: MSG_TOO_LARGE };
      }
    }

    // ---- writes (conditional)
    if (decision.inserts.length > 0) {
      await tx.insert(deliveryMovementItems).values(
        decision.inserts.map((w) => ({ movementId, issueId: w.issueId, included: w.included, readiness: w.readiness, warnings: w.warnings, recordRefs: w.recordRefs }))
      );
    }
    if (decision.updates.length > 0) {
      await tx.execute(sql`
        update delivery_movement_items as i set
          included = v.included,
          readiness = v.readiness::movement_readiness,
          override_reason = case when v.clear_override then null else i.override_reason end,
          override_by = case when v.clear_override then null else i.override_by end,
          override_by_name = case when v.clear_override then null else i.override_by_name end,
          override_at = case when v.clear_override then null else i.override_at end,
          warnings = v.warnings,
          record_refs = v.record_refs
        from jsonb_to_recordset(${jsonRows(decision.updates)}::jsonb)
          as v(issue_id uuid, included boolean, readiness text, clear_override boolean, warnings jsonb, record_refs jsonb)
        where i.movement_id = ${movementId} and i.issue_id = v.issue_id`);
    }
    if (decision.removed.length > 0) {
      await tx.delete(deliveryMovementItems).where(and(eq(deliveryMovementItems.movementId, movementId), inArray(deliveryMovementItems.issueId, decision.removed)));
    }

    // ---- the checklist, from the data just computed (equal to what the stored inputs would give)
    const recordsByIssue = new Map(fresh.map((f) => [f.issueId, f.records]));
    const [signoffs, { slots }] = await Promise.all([tcSignoffsFor(tx, decision.rows.map((r) => r.issueId)), loadSlots(tx, movementId)]);
    const cl = buildFrom(head.environment, head.branches, decision.rows, recordsByIssue, signoffs, edits);

    const itemsChanged = decision.inserts.length + decision.updates.length + decision.removed.length > 0;
    const recovered = head.refreshError !== null;
    const applied = await applyChecklist(tx, {
      head,
      cl,
      actor: opts.actor ?? null,
      slots,
      fromRefresh: true,
      previous: async () => {
        // The checklist as it was: the OLD rows and the OLD stored records (only read when an event is written).
        const old = await stored();
        return old.state === "ok" ? buildFrom(head.environment, head.branches, existing, old.records, new Map(), edits) : null;
      },
      set: { refreshedAt: now, ...(recovered ? { refreshError: null } : {}), ...(blob ? { inputs: blob, inputsHash: newPointerHash } : {}) },
      realChange: itemsChanged || inputsChanged || recovered,
    });
    notifications = applied.notifications;

    const e = decision.events;
    if (e.added.length || e.removed.length || e.readiness.length || e.overrideCleared.length) {
      await addEvent(tx, movementId, "items_changed", opts.actor ?? null, { ...e });
    }
    if (recovered) await addEvent(tx, movementId, "refresh_recovered", opts.actor ?? null);

    const counts = { ready: 0, blocked: 0, override: 0 };
    for (const r of decision.rows) counts[r.readiness]++;
    return {
      ok: true,
      movementStatus: applied.status,
      hash: applied.hash,
      changed: applied.changed || itemsChanged || inputsChanged,
      inputsWritten: inputsChanged,
      items: {
        total: decision.rows.length,
        ...counts,
        added: decision.inserts.length,
        removed: decision.removed.length,
        updated: decision.updates.length,
        degraded: fresh.filter((f) => f.degraded).length,
      },
      jiraCalls: g.jiraCalls,
      recordsParsed: g.recordsParsed,
    };
  });
  if (notifications.length > 0) await sendNotifications(notifications);
  return result;
}

/**
 * The periodic check behind /api/cron/movements: re-read the deployment records of the movements
 * that can still be signed or deployed, so a record edited or re-posted in Jira resets the sign-offs
 * (and mails the signers) without anybody opening the page. Which movements are due is ONE small
 * query plus a pure function (`pickDue`, unit-tested); the refresh itself is the service's
 * `refreshMovement` run as the system (no actor, no user permission check, same advisory lock as a
 * user's Refresh).
 */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { deliveries, deliveryMovements } from "@/lib/db/schema";
import { refreshMovement, type RefreshResult } from "./service/refresh";
import type { MovementStatus } from "./values";

/** Only these can still change (draft is not shared yet; done / cancelled are frozen). */
export const DUE_STATUSES = ["ready", "signed_off", "in_progress"] as const satisfies readonly MovementStatus[];
/** A movement refreshed more recently than this (by anybody) is left alone. */
export const MIN_AGE_MS = 25 * 60 * 1000;
export const MAX_PER_RUN = 8;
/** Due rows read from the database per run; `pickDue` takes MAX_PER_RUN of them in a rotating order. */
export const CANDIDATE_POOL = 40;
/** The check runs every 30 minutes; the rotation changes with each 30-minute bucket. */
export const BUCKET_MS = 30 * 60 * 1000;
export const CONCURRENCY = 2;
/**
 * No new refresh is STARTED after this much wall-clock time. It MUST stay below the deployment's
 * `maxDuration` (the route sets 800 s) by at least REFRESH_TIMEOUT_MS: the longest run is
 * BUDGET_MS + REFRESH_TIMEOUT_MS = 360 s. If the platform caps maxDuration lower, lower this too;
 * a killed run is safe (each refresh is one transaction) but the summary is lost.
 */
export const BUDGET_MS = 240_000;
/** One refresh that takes longer is counted as an error and its worker stops taking new work. */
export const REFRESH_TIMEOUT_MS = 120_000;

export interface Candidate {
  id: string;
  status: MovementStatus;
  refreshedAt: Date | null;
  deliveryDeleted: boolean;
  deliveryCompleted: boolean;
}

export function isDue(c: Candidate, now: Date): boolean {
  if (!(DUE_STATUSES as readonly string[]).includes(c.status)) return false;
  if (c.deliveryDeleted || c.deliveryCompleted) return false;
  return c.refreshedAt === null || now.getTime() - c.refreshedAt.getTime() >= MIN_AGE_MS;
}

/** Deterministic, evenly spread rank of a movement in the given bucket (changes every bucket). */
export function rotationKey(id: string, bucket: number): string {
  return createHash("sha1").update(`${id}:${bucket}`).digest("hex");
}

/**
 * The ids to refresh now: the due ones, at most `limit`, in an order that ROTATES every 30-minute
 * bucket (hash of id + bucket) instead of strict "stalest first". A refresh that fails, is busy or is
 * skipped never advances `refreshed_at`, so with strict order a few permanently broken movements would
 * be the stalest forever and starve every other one; with the rotation each due movement gets a turn
 * within a few runs. Never-refreshed rows win only a tie of the hash (then id), i.e. practically never:
 * a new movement is refreshed on creation anyway.
 */
export function pickDue(cands: readonly Candidate[], now: Date, limit: number = MAX_PER_RUN): string[] {
  const bucket = Math.floor(now.getTime() / BUCKET_MS);
  return cands
    .filter((c) => isDue(c, now))
    .map((c) => ({ c, k: rotationKey(c.id, bucket) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.c.refreshedAt === null && b.c.refreshedAt !== null ? -1 : a.c.refreshedAt !== null && b.c.refreshedAt === null ? 1 : a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0))
    .slice(0, Math.max(0, limit))
    .map((x) => x.c.id);
}

/**
 * The same predicate in SQL, so only the few due rows leave the database (`limit` applies there
 * too; the stalest first, only to decide which rows fall inside the pool). `delivery_movements` is tiny (one live row per delivery and environment), so the filter is a
 * scan of those rows joined to `deliveries` by primary key; no index is added for it.
 */
export async function selectCandidates(now: Date, limit: number = CANDIDATE_POOL): Promise<Candidate[]> {
  const cutoff = new Date(now.getTime() - MIN_AGE_MS);
  const rows = await db
    .select({ id: deliveryMovements.id, status: deliveryMovements.status, refreshedAt: deliveryMovements.refreshedAt, deletedAt: deliveries.deletedAt, completedAt: deliveries.completedAt })
    .from(deliveryMovements)
    .innerJoin(deliveries, eq(deliveries.id, deliveryMovements.deliveryId))
    .where(
      and(
        inArray(deliveryMovements.status, [...DUE_STATUSES]),
        isNull(deliveries.deletedAt),
        isNull(deliveries.completedAt),
        or(isNull(deliveryMovements.refreshedAt), lt(deliveryMovements.refreshedAt, cutoff))
      )
    )
    .orderBy(sql`${deliveryMovements.refreshedAt} asc nulls first`, asc(deliveryMovements.id))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, status: r.status, refreshedAt: r.refreshedAt, deliveryDeleted: r.deletedAt !== null, deliveryCompleted: r.completedAt !== null }));
}

export interface CheckSummary {
  /** Movements picked this run. */
  due: number;
  refreshed: number;
  /** Refreshed and something besides refreshed_at was written (records changed, sign-offs reset...). */
  changed: number;
  /** Another refresh was running, or the movement was refreshed/frozen in the meantime. */
  skipped: number;
  errors: number;
  /** Picked but not started because the time budget ran out. */
  notStarted: number;
  /** The selection query failed (nothing was refreshed). */
  selectionFailed?: true;
}

export interface CheckDeps {
  now?: () => Date;
  select?: (now: Date, limit: number) => Promise<Candidate[]>;
  refresh?: (movementId: string) => Promise<RefreshResult>;
  maxPerRun?: number;
  concurrency?: number;
  budgetMs?: number;
  refreshTimeoutMs?: number;
  /** Monotonic clock in ms (tests). */
  clock?: () => number;
}

/** Never throws: every failure is counted. */
export async function runMovementCheck(deps: CheckDeps = {}): Promise<CheckSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const max = deps.maxPerRun ?? MAX_PER_RUN;
  const summary: CheckSummary = { due: 0, refreshed: 0, changed: 0, skipped: 0, errors: 0, notStarted: 0 };

  let ids: string[];
  try {
    // the SQL already applies the predicate; pickDue is the one definition of "due", applied again to what came back
    ids = pickDue(await (deps.select ?? selectCandidates)(now, CANDIDATE_POOL), now, max);
  } catch {
    console.warn("[movement] cron: the selection query failed");
    return { ...summary, selectionFailed: true };
  }
  summary.due = ids.length;
  if (ids.length === 0) return summary;

  const refresh = deps.refresh ?? ((id: string) => refreshMovement(id, { actor: null }));
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const budget = deps.budgetMs ?? BUDGET_MS;
  const timeoutMs = deps.refreshTimeoutMs ?? REFRESH_TIMEOUT_MS;
  let next = 0;

  const worker = async () => {
    for (;;) {
      if (next >= ids.length) return;
      if (clock() - started >= budget) return;
      const id = ids[next++];
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const r = await Promise.race([
          refresh(id),
          new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), timeoutMs);
          }),
        ]);
        if (r === "timeout") {
          // The abandoned refresh may still be running (it holds the movement's advisory lock until it ends):
          // count it, and do not start more work from this worker.
          summary.errors++;
          return;
        }
        if (r.error) summary.errors++;
        else if (r.ok) {
          summary.refreshed++;
          if (r.changed) summary.changed++;
        } else summary.skipped++;
      } catch {
        summary.errors++;
      } finally {
        clearTimeout(timer);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(deps.concurrency ?? CONCURRENCY, ids.length)) }, worker));
  summary.notStarted = Math.max(0, ids.length - next);
  return summary;
}

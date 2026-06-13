import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
};

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL!,
    // Many warm serverless instances share one DB connection limit, so keep
    // the per-instance ceiling low to avoid exhausting it.
    max: 5,
    // Release idle clients before the server's idle reaper does, so the pool
    // discards them cleanly instead of discovering them dead on the next use.
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    // Keep idle TCP sockets alive so intermediaries (poolers/NAT) don't drop
    // them silently and leave us with a half-open connection.
    keepAlive: true,
  });

// Fires only for idle clients the server reaped from the pool. pg removes the
// dead client automatically; this handler just prevents the error from going
// unhandled and crashing the function. Expected noise, so warn (not error).
pool.on("error", (err) => {
  console.warn("[db pool] idle client terminated by server:", err.message);
});

// Reuse a single pool per instance in every environment (including production)
// so route bundles don't each spin up their own pool and multiply idle
// connections against the shared DB limit.
globalForDb.pool = pool;

export const db = drizzle(pool, { schema });

// ---------------------------------------------------------------------------
// Transient-connection retry
// ---------------------------------------------------------------------------

// Postgres SQLSTATEs for connection-level failures (class 08), admin/crash
// shutdown, and overload — all worth a quick retry against a remote DB.
const TRANSIENT_PG_CODES = new Set([
  "08000", "08003", "08006", "08001", "08004", "08007", // connection exception
  "57P01", "57P02", "57P03", // admin shutdown / crash shutdown / cannot connect now
  "53300", // too_many_connections
]);

// Node socket/DNS errors that mean "the connection died", not "the query is wrong".
const TRANSIENT_NET_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE",
  "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN",
]);

const TRANSIENT_MESSAGE_RE =
  /connection terminated|connection timeout|timeout exceeded when trying to connect|server closed the connection|terminating connection|cannot connect now|connection reset|broken pipe/i;

/**
 * True only for connection-layer failures (remote DB reaped an idle socket, a
 * network blip, a connect timeout). Walks the error's `cause` chain because
 * drizzle wraps the underlying pg error. Real SQL/logic errors return false so
 * they surface immediately instead of being retried and masked.
 */
function isTransientConnectionError(err: unknown): boolean {
  let e = err as { code?: unknown; message?: unknown; cause?: unknown } | null | undefined;
  for (let depth = 0; e && depth < 5; depth++, e = e.cause as typeof e) {
    const code = typeof e.code === "string" ? e.code : undefined;
    if (code && (TRANSIENT_PG_CODES.has(code) || TRANSIENT_NET_CODES.has(code))) {
      return true;
    }
    const msg = typeof e.message === "string" ? e.message : "";
    if (msg && TRANSIENT_MESSAGE_RE.test(msg)) return true;
  }
  return false;
}

/**
 * Runs a DB operation, retrying only on transient connection errors with a
 * small exponential backoff. A single reaped/blipped connection to the remote
 * DB no longer surfaces as a hard failure. Non-transient errors throw at once.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseDelayMs?: number }
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 100;
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts - 1 || !isTransientConnectionError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastErr;
}

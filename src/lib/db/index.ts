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

// Lightweight hit/miss instrumentation for "use cache" functions.
//
// A "use cache" body only executes on a miss (or background revalidation); on a
// hit the stored result is returned without running it. We exploit that: stamp
// the compute time *inside* the cached body, and compare it to a timestamp taken
// *outside* immediately before the call. If the stamp is newer than that
// timestamp, the body ran during this request → MISS. Otherwise the stamp comes
// from an earlier compute → HIT. This is exact regardless of how slow the
// underlying queries are.

export type Stamped<T> = readonly [data: T, computedAtMs: number];

/** Call inside a cached function, on the value it returns. */
export function stampCache<T>(data: T): Stamped<T> {
  return [data, Date.now()] as const;
}

export type CacheStatus = "HIT" | "MISS";

/**
 * Wrap the call to a cached fetcher. Returns the unwrapped data plus the
 * detected cache status and response headers (X-Cache + Server-Timing) to
 * attach to the route response. Hit/miss is surfaced via those headers only —
 * intentionally not logged, to avoid a billed Observability Event per request.
 */
export async function withCacheMetrics<T>(
  useCase: string,
  fetcher: () => Promise<Stamped<T>>
): Promise<{ data: T; status: CacheStatus; durationMs: number; headers: Record<string, string> }> {
  const t0 = Date.now();
  const [data, computedAtMs] = await fetcher();
  const durationMs = Date.now() - t0;
  const status: CacheStatus = computedAtMs >= t0 ? "MISS" : "HIT";

  // Hit/miss + timing is exposed per-request via the X-Cache and Server-Timing
  // headers below — we deliberately do NOT console.log it, since one line per
  // request is a billed Observability Event for no extra signal.
  return {
    data,
    status,
    durationMs,
    headers: {
      "X-Cache": status,
      "Server-Timing": `cache;desc="${useCase} ${status}";dur=${durationMs}`,
    },
  };
}

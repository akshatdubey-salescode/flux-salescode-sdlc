/**
 * fetch wrapper of the movement UI: JSON in / out, a timeout, a caller AbortSignal, and a result
 * object instead of exceptions (so a component can show the message and offer a retry). A
 * response is only trusted after `ok`; nothing from the body is ever put into HTML. An expired login is
 * a FAILURE (401, SESSION_EXPIRED): requireAuth redirects to the sign-in page, fetch follows it and gets
 * 200 HTML, which must never be read as "ok, no data".
 */
import { describeApiError, type ApiErrorBody } from "./view-model";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Readable message when !ok. */
  error: string | null;
  body: ApiErrorBody | null;
  /** The caller aborted (a newer request replaced this one): ignore the result. */
  aborted: boolean;
  timedOut: boolean;
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  fallbackError?: string;
}

export const movementsBase = (deliveryId: string): string => `/api/deliveries/${encodeURIComponent(deliveryId)}/movements`;
export const movementBase = (deliveryId: string, movementId: string): string => `${movementsBase(deliveryId)}/${encodeURIComponent(movementId)}`;

export async function api<T>(url: string, opts: ApiOptions = {}): Promise<ApiResult<T>> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        ctl.abort();
      }, opts.timeoutMs)
    : null;
  const onAbort = () => ctl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ctl.abort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  const fail = (status: number, body: ApiErrorBody | null, aborted: boolean): ApiResult<T> => ({
    ok: false,
    status,
    data: null,
    error: aborted
      ? timedOut
        ? "The server took too long to answer"
        : null
      : status === 0
        ? "Network problem; check your connection and try again"
        : describeApiError(status, body, opts.fallbackError ?? "Request failed"),
    body,
    aborted: aborted && !timedOut,
    timedOut,
  });
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      cache: "no-store",
      signal: ctl.signal,
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    // Followed a redirect (the sign-in page): the login is gone, whatever the final status says.
    if (res.redirected) return fail(401, null, false);
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    // Aborted while the body was being read (a newer request replaced this one, or the timeout fired).
    if (ctl.signal.aborted) return fail(0, null, true);
    const object = json && typeof json === "object" ? (json as ApiErrorBody) : null;
    if (!res.ok) return fail(res.status, object, false);
    // 200 without a JSON object (HTML sign-in page, an empty body): not a success.
    if (!object) return fail(401, null, false);
    return { ok: true, status: res.status, data: json as T, error: null, body: null, aborted: false, timedOut: false };
  } catch {
    return fail(0, null, ctl.signal.aborted);
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

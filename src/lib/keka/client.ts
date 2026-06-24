// Keka HR API client.
//
// Auth: OAuth2 "kekaapi" grant against Keka's GLOBAL identity server
// (login.keka.com), exchanged for a Bearer token that is valid for 24h. The
// token endpoint is rate-limited and returns `invalid_grant` if you regenerate
// too frequently, so we cache the token per server instance and only refresh it
// shortly before expiry (or once on an unexpected 401).
//
// Data calls go to the tenant host: https://{subdomain}.keka.com/api/v1/...
// Like JiraClient/GitHubClient this client is read-only (GET-only) and
// host-locked: every request is validated against the configured tenant host so
// a stray path can never cause an SSRF or a cross-tenant call.

const TOKEN_URL = "https://login.keka.com/connect/token";

// Refresh slightly before the stated expiry so a token never expires mid-flight.
const TOKEN_REFRESH_SKEW_MS = 5 * 60_000;
// Fallback lifetime if the token response omits expires_in (Keka returns 86400).
const DEFAULT_TOKEN_TTL_S = 3600;

// Loose shape — Keka's EmployeeProfile returns many more fields. We keep the
// full payload as raw JSON at sync time, so only the fields we extract into
// columns are typed here. Field names verified against developers.keka.com:
//   - jobTitle is a LookupInfo { identifier, title }
//   - employmentStatus is a numeric enum (0=Working, 1=Relieved)
//   - the reporting manager is `reportsTo` (an EmployeeLookup), not a flat field
//   - there is no first-class department field; it lives under `groups`
export type KekaEmployeeRaw = {
  id: string;
  employeeNumber?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
  jobTitle?: { identifier?: string; title?: string } | string | null;
  employmentStatus?: number | null;
  joiningDate?: string | null;
  exitDate?: string | null;
  reportsTo?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  } | null;
  l2Manager?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  } | null;
  // Org groupings. The department lives here as the entry with groupType 2
  // (others: 1/9 = legal entity, 3 = city, 4 = work location, 5 = pay group).
  groups?: { id?: string; title?: string; groupType?: number }[] | null;
  [key: string]: unknown;
};

// groupType of the "department" group within KekaEmployeeRaw.groups.
export const KEKA_DEPARTMENT_GROUP_TYPE = 2;

type KekaListEnvelope<T> = {
  succeeded?: boolean;
  data?: T[];
  pageNumber?: number;
  pageSize?: number;
  totalPages?: number;
  totalRecords?: number;
};

type CachedToken = { token: string; expiresAt: number };

export class KekaClient {
  private baseUrl: string;
  private allowedHost: string;
  private clientId: string;
  private clientSecret: string;
  private apiKey: string;

  private cached: CachedToken | null = null;
  // Dedupe concurrent token refreshes so a burst of parallel requests triggers
  // at most one call to the rate-limited token endpoint.
  private inflight: Promise<string> | null = null;

  constructor(config: {
    subdomain: string;
    clientId: string;
    clientSecret: string;
    apiKey: string;
  }) {
    this.baseUrl = `https://${config.subdomain}.keka.com/api/v1`;
    this.allowedHost = new URL(this.baseUrl).host;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.apiKey = config.apiKey;
  }

  /**
   * Returns a valid Bearer token, fetching a fresh one only when the cache is
   * empty or within the refresh skew of expiry. Concurrent callers share one
   * in-flight request.
   */
  private async getToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()) {
      return this.cached.token;
    }
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      const body = new URLSearchParams({
        grant_type: "kekaapi",
        scope: "kekaapi",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        api_key: this.apiKey,
      });
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        // invalid_grant here almost always means the token endpoint is
        // throttling regeneration — the cached 24h token should be reused.
        throw new Error(`[KekaClient] token request failed (${res.status}): ${text}`);
      }
      const json = (await res.json()) as {
        access_token: string;
        expires_in?: number;
      };
      const ttlMs = (json.expires_in ?? DEFAULT_TOKEN_TTL_S) * 1000;
      this.cached = { token: json.access_token, expiresAt: Date.now() + ttlMs };
      return json.access_token;
    })();

    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  /**
   * The ONLY way this client makes data requests. Enforces two invariants:
   *   1. method is always GET — writes are structurally impossible
   *   2. the resolved host matches the configured tenant host — no SSRF / no
   *      cross-tenant call
   * `path` must be tenant-relative, e.g. "/hris/employees?pageNumber=1".
   */
  private async get(path: string): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const parsed = new URL(url);
    if (parsed.host !== this.allowedHost) {
      throw new Error(
        `[KekaClient] BLOCKED: request to "${parsed.host}" is outside the ` +
          `configured Keka host "${this.allowedHost}". No request was sent.`
      );
    }

    const send = async (token: string) =>
      fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });

    let res = await send(await this.getToken());
    // A 401 means the token died earlier than advertised — drop the cache and
    // retry exactly once with a fresh token.
    if (res.status === 401) {
      this.cached = null;
      res = await send(await this.getToken());
    }
    return res;
  }

  /** Verify credentials + tenant host by fetching a single employee. */
  async testConnection(): Promise<boolean> {
    const res = await this.get(`/hris/employees?pageNumber=1&pageSize=1`);
    return res.ok;
  }

  /**
   * Fetch employees from the directory, following Keka's page-number pagination
   * (capped at 100/page). Pass employmentStatus to filter server-side — Keka
   * accepts "Working" or "Relieved".
   */
  async fetchEmployees(opts?: {
    employmentStatus?: "Working" | "Relieved";
  }): Promise<KekaEmployeeRaw[]> {
    const all: KekaEmployeeRaw[] = [];
    const pageSize = 100;
    let pageNumber = 1;
    const statusFilter = opts?.employmentStatus
      ? `&employmentStatus=${encodeURIComponent(opts.employmentStatus)}`
      : "";

    while (true) {
      const res = await this.get(
        `/hris/employees?pageNumber=${pageNumber}&pageSize=${pageSize}${statusFilter}`
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `[KekaClient] employees fetch failed (${res.status}) on page ${pageNumber}: ${text}`
        );
      }
      const json = (await res.json()) as KekaListEnvelope<KekaEmployeeRaw>;
      const rows = json.data ?? [];
      all.push(...rows);

      const totalPages =
        json.totalPages ?? (rows.length < pageSize ? pageNumber : pageNumber + 1);
      if (rows.length < pageSize || pageNumber >= totalPages) break;
      pageNumber++;
    }

    return all;
  }
}

// Per-instance singleton, reused across warm serverless invocations so the
// cached token survives between requests.
let singleton: KekaClient | null = null;

/**
 * Returns the configured Keka client. Lazily validates env (like the other
 * integrations) so a missing var surfaces a clear error at call time rather
 * than at import time.
 */
export function getKekaClient(): KekaClient {
  if (singleton) return singleton;

  const subdomain = process.env.KEKA_SUBDOMAIN;
  const clientId = process.env.KEKA_CLIENT_ID;
  const clientSecret = process.env.KEKA_CLIENT_SECRET;
  const apiKey = process.env.KEKA_API_KEY;

  const missing = [
    ["KEKA_SUBDOMAIN", subdomain],
    ["KEKA_CLIENT_ID", clientId],
    ["KEKA_CLIENT_SECRET", clientSecret],
    ["KEKA_API_KEY", apiKey],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    throw new Error(`Keka is not configured: missing ${missing.join(", ")}`);
  }

  singleton = new KekaClient({
    subdomain: subdomain!,
    clientId: clientId!,
    clientSecret: clientSecret!,
    apiKey: apiKey!,
  });
  return singleton;
}

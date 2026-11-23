// Jira Cloud REST API v3 client
// Auth: HTTP Basic with base64(email:apiToken)

export type JiraIssueRaw = {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: unknown; // Atlassian Document Format
    status: {
      name: string;
      statusCategory: { name: string };
    };
    issuetype: { name: string };
    priority: { name: string } | null;
    assignee: {
      accountId: string;
      emailAddress: string;
      displayName: string;
    } | null;
    reporter: {
      accountId: string;
      emailAddress: string;
      displayName: string;
    } | null;
    labels: string[];
    created: string;
    updated: string;
    // Jira's free-text system "environment" field (e.g. "prod" / "demo" /
    // "uat"). Captured into custom_fields at sync time and normalized for the
    // bug summary. Absent on issues where it was never set.
    environment?: string | null;
    comment: {
      comments: JiraCommentRaw[];
    };
  };
  changelog?: {
    histories: JiraChangelogHistory[];
  };
};

export type JiraCommentRaw = {
  id: string;
  author: {
    accountId: string;
    emailAddress: string;
    displayName: string;
  };
  body: unknown; // ADF
  created: string;
  updated: string;
};

export type JiraProjectStatus = {
  name: string;
  statusCategory: string;
};

export type JiraChangelogHistory = {
  id: string;
  author: {
    accountId?: string;
    displayName: string;
    emailAddress?: string;
    // "atlassian" | "app" | "customer" — "app" identifies automation/bots,
    // which we exclude from self-deassignment detection.
    accountType?: string;
  };
  created: string; // ISO timestamp
  items: {
    field: string;
    // accountId of the old/new value for user fields (assignee, reporter).
    // null when the field was cleared (e.g. unassigned) or has no account.
    from: string | null;
    to: string | null;
    fromString: string | null;
    toString: string | null;
  }[];
};

export type JiraFieldDef = {
  id: string;
  name: string;
  custom: boolean;
  schema?: {
    type?: string;
    items?: string;
    custom?: string;
  };
};

export type JiraCreateField = {
  fieldId: string;
  key: string;
  name: string;
  required: boolean;
  operations?: string[];
  schema?: {
    type?: string;
    custom?: string;
  };
};

type JiraSearchResult = {
  issues: JiraIssueRaw[];
  nextPageToken?: string; // present when more pages exist; absent on last page
};

/** One issue from a lean search: only the fields the caller asked for, no changelog. */
export type JiraLeanIssue = {
  id: string;
  key: string;
  fields: Record<string, unknown>;
};

export type JiraLeanSearchResult = {
  issues: JiraLeanIssue[];
  nextPageToken?: string;
};

/** One page of GET /issue/{key}/comment. Comment bodies are ADF. */
export type JiraCommentsPage = {
  startAt: number;
  maxResults: number;
  total: number;
  comments: JiraCommentRaw[];
};

/** A Jira response that stayed non-2xx after the bounded retries. `status` lets callers branch. */
export class JiraRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "JiraRequestError";
  }
}

export type JiraRetryOptions = {
  /** Total attempts including the first (default 3). */
  maxAttempts?: number;
  /** Longest single wait (default 8s) and total wait across attempts (default 15s). */
  maxWaitMs?: number;
  maxTotalWaitMs?: number;
  /** Per-attempt timeout of the lean reads (default 20 s). A timeout is a network error to the retry. */
  timeoutMs?: number;
  /** Injected by tests so no real time passes. */
  sleep?: (ms: number) => Promise<void>;
};

type JiraProjectInfo = {
  id: string;
  key: string;
  name: string;
};

const ISSUE_FIELDS = [
  "summary",
  "description",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "reporter",
  "labels",
  "created",
  "updated",
  "comment",
  // Jira system "environment" field — free text, drives the bug-summary env
  // column. Not in KNOWN_ISSUE_FIELDS (sync.ts), so it lands in custom_fields.
  "environment",
  // Date fields — duedate is standard; the customfields cover sprint start,
  // epic start, and the Applicate-specific end-date field.
  "duedate",
  "customfield_10015", // start date (sprint)
  "customfield_10014", // start date (epic / alternate)
  "customfield_10021", // due date (alternate)
  "customfield_11449", // end date (Applicate)
  "customfield_11699", // Freshdesk Ticket ID
  "timeoriginalestimate", // original estimate (seconds) — performance-review AI-tasks metric
].join(",");

export class JiraClient {
  private headers: HeadersInit;
  private baseUrl: string;
  private allowedHost: string;
  private retry: Required<JiraRetryOptions>;

  constructor(config: {
    baseUrl: string;
    email: string;
    apiToken: string;
    /** Only used by the lean read methods (searchByJql, fetchIssueComments). */
    retry?: JiraRetryOptions;
  }) {
    this.retry = {
      maxAttempts: Math.max(1, config.retry?.maxAttempts ?? 3),
      maxWaitMs: config.retry?.maxWaitMs ?? 8_000,
      maxTotalWaitMs: config.retry?.maxTotalWaitMs ?? 15_000,
      timeoutMs: config.retry?.timeoutMs ?? 20_000,
      sleep: config.retry?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    // Lock down the host so every request is validated against it
    this.allowedHost = new URL(this.baseUrl).host;
    const token = Buffer.from(
      `${config.email}:${config.apiToken}`
    ).toString("base64");
    this.headers = {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /**
   * The ONLY way this client makes HTTP requests.
   *
   * Enforces two invariants on every call:
   *   1. method is always GET — writes are structurally impossible through JiraClient
   *   2. URL host matches the configured Jira base URL — prevents SSRF and
   *      accidental calls to a different Atlassian org
   *
   * Any violation throws immediately before the request is sent.
   */
  private async get(url: string, signal?: AbortSignal): Promise<Response> {
    const parsed = new URL(url);
    if (parsed.host !== this.allowedHost) {
      throw new Error(
        `[JiraClient] BLOCKED: request to "${parsed.host}" is outside the ` +
        `configured Jira host "${this.allowedHost}". No request was sent.`
      );
    }
    return fetch(url, { method: "GET", headers: this.headers, ...(signal ? { signal } : {}) });
  }

  /** Verify credentials by calling /myself. Returns true if authenticated. */
  async testConnection(): Promise<boolean> {
    const res = await this.get(`${this.baseUrl}/rest/api/3/myself`);
    return res.ok;
  }

  /** Fetch project metadata. Throws if the project key does not exist. */
  async fetchProjectInfo(projectKey: string): Promise<JiraProjectInfo> {
    const res = await this.get(
      `${this.baseUrl}/rest/api/3/project/${encodeURIComponent(projectKey)}`
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Jira project "${projectKey}" not found (${res.status}): ${body}`
      );
    }
    return res.json() as Promise<JiraProjectInfo>;
  }

  /**
   * Returns all fields defined in this Jira instance.
   * Used to auto-discover the multi-assignee custom field ID.
   * Throws on non-2xx so callers can distinguish "no fields" from a transient
   * API failure (don't poison the per-project discovery cache).
   */
  async fetchFields(): Promise<JiraFieldDef[]> {
    const res = await this.get(`${this.baseUrl}/rest/api/3/field`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Jira fields fetch failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? (data as JiraFieldDef[]) : [];
  }

  /**
   * Paginated JQL search. Includes changelog so we get full status history.
   * expand=changelog adds a `changelog` block to each issue.
   */
  async fetchIssues(
    projectKey: string,
    nextPageToken?: string,
    maxResults = 100,
    extraFields: string[] = []
  ): Promise<JiraSearchResult> {
    const fields = extraFields.length ? `${ISSUE_FIELDS},${extraFields.join(",")}` : ISSUE_FIELDS;
    const jql = encodeURIComponent(`project = "${projectKey}" ORDER BY created ASC`);
    // /rest/api/3/search/jql uses cursor-based pagination via nextPageToken.
    // startAt is ignored by this endpoint and total is never returned.
    let url =
      `${this.baseUrl}/rest/api/3/search/jql` +
      `?jql=${jql}` +
      `&fields=${fields}` +
      `&expand=changelog` +
      `&maxResults=${maxResults}`;

    if (nextPageToken) {
      url += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;
    }

    const res = await this.get(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Jira search failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<JiraSearchResult>;
  }

  /** Fetch a single issue by key, including comments. */
  async fetchIssue(issueKey: string, extraFields: string[] = []): Promise<JiraIssueRaw> {
    const fields = extraFields.length ? `${ISSUE_FIELDS},${extraFields.join(",")}` : ISSUE_FIELDS;
    const url =
      `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}` +
      `?fields=${fields}&expand=changelog`;

    const res = await this.get(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Jira issue "${issueKey}" not found (${res.status}): ${body}`);
    }
    return res.json() as Promise<JiraIssueRaw>;
  }

  /**
   * Returns priorities available in this Jira instance.
   * Endpoint: GET /rest/api/3/priority
   */
  async fetchPriorities(): Promise<Array<{ id: string; name: string; iconUrl: string }>> {
    const res = await this.get(`${this.baseUrl}/rest/api/3/priority`);
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      id: string;
      name: string;
      iconUrl: string;
    }>;
    return (Array.isArray(data) ? data : []).map(({ id, name, iconUrl }) => ({
      id,
      name,
      iconUrl,
    }));
  }

  /**
   * Returns non-subtask issue types available in a project.
   * Reuses the project endpoint since it already includes issueTypes.
   */
  async fetchIssueTypes(
    projectKey: string
  ): Promise<Array<{ id: string; name: string; description: string; iconUrl: string }>> {
    const res = await this.get(
      `${this.baseUrl}/rest/api/3/project/${encodeURIComponent(projectKey)}`
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Failed to fetch issue types for "${projectKey}" (${res.status}): ${body}`
      );
    }
    const data = (await res.json()) as {
      issueTypes?: Array<{
        id: string;
        name: string;
        description: string;
        iconUrl: string;
        subtask: boolean;
      }>;
    };
    return (data.issueTypes ?? [])
      .filter((t) => !t.subtask)
      .map(({ id, name, description, iconUrl }) => ({ id, name, description, iconUrl }));
  }

  /**
   * Returns the fields present on a project's create screen for one issue type.
   * Jira exposes this through the replacement for the deprecated broad
   * createmeta endpoint.
   */
  async fetchCreateFields(
    projectKey: string,
    issueTypeId: string
  ): Promise<JiraCreateField[]> {
    const pageSize = 100;
    const fields: JiraCreateField[] = [];
    let startAt = 0;

    while (true) {
      const res = await this.get(
        `${this.baseUrl}/rest/api/3/issue/createmeta/` +
          `${encodeURIComponent(projectKey)}/issuetypes/` +
          `${encodeURIComponent(issueTypeId)}` +
          `?startAt=${startAt}&maxResults=${pageSize}`
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Failed to fetch create fields for "${projectKey}" (${res.status}): ${body}`
        );
      }

      const data = (await res.json()) as {
        fields?: JiraCreateField[];
        total?: number;
      };
      const page = Array.isArray(data.fields) ? data.fields : [];
      fields.push(...page);

      if (
        page.length < pageSize ||
        (typeof data.total === "number" && fields.length >= data.total)
      ) {
        break;
      }
      startAt += page.length;
    }

    return fields;
  }

  /**
   * Returns users that can be assigned to issues in a project.
   * Endpoint: GET /rest/api/3/user/assignable/search?project={key}
   */
  async fetchAssignableUsers(
    projectKey: string
  ): Promise<Array<{ accountId: string; displayName: string; avatarUrl: string }>> {
    const pageSize = 200;
    const all: Array<{ accountId: string; displayName: string; avatarUrl: string }> = [];
    let startAt = 0;

    while (true) {
      const res = await this.get(
        `${this.baseUrl}/rest/api/3/user/assignable/search` +
        `?project=${encodeURIComponent(projectKey)}&maxResults=${pageSize}&startAt=${startAt}`
      );
      if (!res.ok) break;

      const data = (await res.json()) as Array<{
        accountId: string;
        displayName: string;
        avatarUrls: Record<string, string>;
        active?: boolean;
      }>;

      if (!Array.isArray(data) || data.length === 0) break;

      for (const u of data) {
        if (u.active !== false) {
          all.push({
            accountId: u.accountId,
            displayName: u.displayName,
            avatarUrl: u.avatarUrls?.["24x24"] ?? "",
          });
        }
      }

      if (data.length < pageSize) break;
      startAt += pageSize;
    }

    return all;
  }

  /**
   * Bulk-fetch users by accountId, preserving each account's active status.
   * Endpoint: GET /rest/api/3/user/bulk?accountId={id}&...
   *
   * Unlike fetchAssignableUsers / searchUserAccountIdByEmail — which both drop
   * users where active === false — this method KEEPS the active flag so callers
   * can surface inactive accounts (e.g. people who have left the company).
   * Accounts that Jira no longer knows about (hard-deleted) are simply absent
   * from the response rather than returned as inactive.
   *
   * Chunked at 50 ids/request: the API allows 200, but ~64 encoded chars per
   * accountId would overflow the URL length limit (Jira returns 414) well
   * before then.
   */
  async fetchUsersByAccountId(
    accountIds: string[]
  ): Promise<Array<{ accountId: string; displayName: string; active: boolean }>> {
    const chunkSize = 50;
    const out: Array<{ accountId: string; displayName: string; active: boolean }> = [];

    for (let i = 0; i < accountIds.length; i += chunkSize) {
      const chunk = accountIds.slice(i, i + chunkSize);
      const params = chunk
        .map((id) => `accountId=${encodeURIComponent(id)}`)
        .join("&");
      const res = await this.get(
        `${this.baseUrl}/rest/api/3/user/bulk?maxResults=${chunkSize}&${params}`
      );
      if (!res.ok) continue;

      const data = (await res.json()) as {
        values?: Array<{ accountId: string; displayName: string; active?: boolean }>;
      };

      for (const u of data.values ?? []) {
        out.push({
          accountId: u.accountId,
          displayName: u.displayName,
          active: u.active !== false,
        });
      }
    }

    return out;
  }

  /**
   * Look up a Jira user by email. Returns the first matching active
   * accountId, or null when Jira returns no match. Works even when the
   * user's email visibility is restricted on their profile — the caller
   * already knows the email, so Atlassian's privacy gate doesn't apply.
   * Endpoint: GET /rest/api/3/user/search?query={email}
   */
  async searchUserAccountIdByEmail(email: string): Promise<string | null> {
    const res = await this.get(
      `${this.baseUrl}/rest/api/3/user/search?query=${encodeURIComponent(email)}&maxResults=2`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      accountId: string;
      emailAddress?: string;
      active?: boolean;
      accountType?: string;
    }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    // Prefer an exact email match when Jira exposes it; otherwise fall back
    // to the first active atlassian-account result. Ignore app/customer
    // accountTypes so we don't bind a human to a bot identity.
    const lowered = email.toLowerCase();
    const exact = data.find(
      (u) => (u.emailAddress ?? "").toLowerCase() === lowered && u.active !== false
    );
    if (exact) return exact.accountId;
    const human = data.find(
      (u) => u.active !== false && (u.accountType ?? "atlassian") === "atlassian"
    );
    return human?.accountId ?? null;
  }

  /**
   * Reverse of searchUserAccountIdByEmail — looks up a user's email given
   * their accountId. With Basic Auth (service account) credentials Atlassian
   * returns emailAddress even when the user has hidden it on their profile.
   * Returns null when the account is not found or the email is still hidden.
   * Endpoint: GET /rest/api/3/user?accountId={accountId}
   */
  async getEmailByAccountId(accountId: string): Promise<string | null> {
    const res = await this.get(
      `${this.baseUrl}/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { emailAddress?: string; active?: boolean };
    return data.emailAddress?.toLowerCase() ?? null;
  }

  /**
   * Returns deduplicated statuses across all issue types in a project.
   * Endpoint: GET /rest/api/3/project/{projectKey}/statuses
   */
  async fetchProjectStatuses(projectKey: string): Promise<JiraProjectStatus[]> {
    const res = await this.get(
      `${this.baseUrl}/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Failed to fetch statuses for "${projectKey}" (${res.status}): ${body}`
      );
    }
    const issueTypes = (await res.json()) as Array<{
      statuses: Array<{ name: string; statusCategory: { name: string } }>;
    }>;
    // Same status name can appear under multiple issue types — deduplicate by name
    const seen = new Set<string>();
    const result: JiraProjectStatus[] = [];
    for (const issueType of issueTypes) {
      for (const s of issueType.statuses) {
        if (!seen.has(s.name)) {
          seen.add(s.name);
          result.push({ name: s.name, statusCategory: s.statusCategory.name });
        }
      }
    }
    return result;
  }

  /**
   * GET with bounded retry for the lean read methods: 429 and 5xx (and network errors) are
   * retried up to `maxAttempts` times, honouring Retry-After (seconds or HTTP date) and otherwise
   * backing off 500ms, 1s, ... with jitter. A single wait is capped and so is the total, so a
   * request never hangs a route: when the next wait would exceed the budget the last response
   * is returned as it is. Other statuses are returned at once.
   */
  private async getWithRetry(url: string): Promise<Response> {
    const { maxAttempts, maxWaitMs, maxTotalWaitMs, timeoutMs, sleep } = this.retry;
    let waited = 0;
    for (let attempt = 1; ; attempt++) {
      let res: Response | null = null;
      let failure: unknown = null;
      try {
        res = await this.get(url, AbortSignal.timeout(timeoutMs));
      } catch (e) {
        // The host-lock violation is a programming error, not a transient failure.
        if (e instanceof Error && e.message.startsWith("[JiraClient] BLOCKED")) throw e;
        failure = e;
      }
      const transient = res ? res.status === 429 || res.status >= 500 : true;
      if (res && !transient) return res;
      if (attempt >= maxAttempts) {
        if (res) return res;
        throw failure instanceof Error ? failure : new Error("Jira request failed");
      }
      let wait = Math.min(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250), maxWaitMs);
      const ra = res?.headers.get("retry-after");
      if (ra) {
        const secs = Number(ra);
        const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(ra) - Date.now();
        if (Number.isFinite(ms) && ms > 0) wait = ms;
      }
      if (wait > maxWaitMs || waited + wait > maxTotalWaitMs) {
        if (res) return res;
        throw failure instanceof Error ? failure : new Error("Jira request failed");
      }
      waited += wait;
      // Release the unread body so the connection can be reused.
      await res?.body?.cancel().catch(() => undefined);
      await sleep(wait);
    }
  }

  /**
   * Lean JQL search for the movement tree: only the fields the caller names and NO changelog
   * expand (fetchIssues expands the changelog of every issue, far too heavy for a lookup).
   * Cursor-paged through nextPageToken; retries 429/5xx.
   */
  async searchByJql(
    jql: string,
    opts: { fields: string[]; nextPageToken?: string; maxResults?: number }
  ): Promise<JiraLeanSearchResult> {
    let url =
      `${this.baseUrl}/rest/api/3/search/jql` +
      `?jql=${encodeURIComponent(jql)}` +
      `&fields=${encodeURIComponent(opts.fields.join(","))}` +
      `&maxResults=${opts.maxResults ?? 50}`;
    if (opts.nextPageToken) url += `&nextPageToken=${encodeURIComponent(opts.nextPageToken)}`;
    const res = await this.getWithRetry(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new JiraRequestError(`Jira search failed (${res.status}): ${body.slice(0, 300)}`, res.status);
    }
    const data = (await res.json()) as Partial<JiraLeanSearchResult>;
    return { issues: Array.isArray(data.issues) ? data.issues : [], nextPageToken: data.nextPageToken };
  }

  /**
   * One page of an issue's comments, NEWEST first (orderBy=-created), so a caller looking for
   * the latest record can stop early. Bodies are ADF. Retries 429/5xx.
   */
  async fetchIssueComments(
    issueKey: string,
    opts: { startAt?: number; maxResults?: number } = {}
  ): Promise<JiraCommentsPage> {
    const startAt = opts.startAt ?? 0;
    const maxResults = opts.maxResults ?? 50;
    const url =
      `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment` +
      `?orderBy=-created&startAt=${startAt}&maxResults=${maxResults}`;
    const res = await this.getWithRetry(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new JiraRequestError(
        `Jira comments of "${issueKey}" failed (${res.status}): ${body.slice(0, 300)}`,
        res.status
      );
    }
    const data = (await res.json()) as Partial<JiraCommentsPage>;
    return {
      startAt: data.startAt ?? startAt,
      maxResults: data.maxResults ?? maxResults,
      total: data.total ?? 0,
      comments: Array.isArray(data.comments) ? data.comments : [],
    };
  }
}

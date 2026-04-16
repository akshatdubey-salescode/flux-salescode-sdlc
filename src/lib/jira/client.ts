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
    displayName: string;
    emailAddress?: string;
  };
  created: string; // ISO timestamp
  items: {
    field: string;
    fromString: string | null;
    toString: string | null;
  }[];
};

type JiraSearchResult = {
  issues: JiraIssueRaw[];
  nextPageToken?: string; // present when more pages exist; absent on last page
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
].join(",");

export class JiraClient {
  private headers: HeadersInit;
  private baseUrl: string;
  private allowedHost: string;

  constructor(config: {
    baseUrl: string;
    email: string;
    apiToken: string;
  }) {
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
  private async get(url: string): Promise<Response> {
    const parsed = new URL(url);
    if (parsed.host !== this.allowedHost) {
      throw new Error(
        `[JiraClient] BLOCKED: request to "${parsed.host}" is outside the ` +
        `configured Jira host "${this.allowedHost}". No request was sent.`
      );
    }
    return fetch(url, { method: "GET", headers: this.headers });
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
   * Paginated JQL search. Includes changelog so we get full status history.
   * expand=changelog adds a `changelog` block to each issue.
   */
  async fetchIssues(
    projectKey: string,
    nextPageToken?: string,
    maxResults = 100
  ): Promise<JiraSearchResult> {
    const jql = encodeURIComponent(`project = "${projectKey}" ORDER BY created ASC`);
    // /rest/api/3/search/jql uses cursor-based pagination via nextPageToken.
    // startAt is ignored by this endpoint and total is never returned.
    let url =
      `${this.baseUrl}/rest/api/3/search/jql` +
      `?jql=${jql}` +
      `&fields=${ISSUE_FIELDS}` +
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
  async fetchIssue(issueKey: string): Promise<JiraIssueRaw> {
    const url =
      `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}` +
      `?fields=${ISSUE_FIELDS}&expand=changelog`;

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
   * Returns users that can be assigned to issues in a project.
   * Endpoint: GET /rest/api/3/user/assignable/search?project={key}
   */
  async fetchAssignableUsers(
    projectKey: string
  ): Promise<Array<{ accountId: string; displayName: string; avatarUrl: string }>> {
    const res = await this.get(
      `${this.baseUrl}/rest/api/3/user/assignable/search` +
      `?project=${encodeURIComponent(projectKey)}&maxResults=50`
    );
    if (!res.ok) {
      // Non-fatal — return empty list if the endpoint fails
      return [];
    }
    const data = (await res.json()) as Array<{
      accountId: string;
      displayName: string;
      avatarUrls: Record<string, string>;
    }>;
    return (Array.isArray(data) ? data : []).map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      avatarUrl: u.avatarUrls?.["24x24"] ?? "",
    }));
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
}

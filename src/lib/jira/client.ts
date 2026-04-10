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
  total: number;
  startAt: number;
  maxResults: number;
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

  constructor(config: {
    baseUrl: string;
    email: string;
    apiToken: string;
  }) {
    // Strip trailing slash
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    const token = Buffer.from(
      `${config.email}:${config.apiToken}`
    ).toString("base64");
    this.headers = {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /** Verify credentials by calling /myself. Returns true if authenticated. */
  async testConnection(): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/rest/api/3/myself`, {
      headers: this.headers,
    });
    return res.ok;
  }

  /** Fetch project metadata. Throws if the project key does not exist. */
  async fetchProjectInfo(projectKey: string): Promise<JiraProjectInfo> {
    const res = await fetch(
      `${this.baseUrl}/rest/api/3/project/${projectKey}`,
      { headers: this.headers }
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
    startAt = 0,
    maxResults = 100
  ): Promise<JiraSearchResult> {
    const jql = encodeURIComponent(`project = "${projectKey}" ORDER BY created ASC`);
    const url =
      `${this.baseUrl}/rest/api/3/search/jql` +
      `?jql=${jql}` +
      `&fields=${ISSUE_FIELDS}` +
      `&expand=changelog` +
      `&maxResults=${maxResults}` +
      `&startAt=${startAt}`;

    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Jira search failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<JiraSearchResult>;
  }

  /** Fetch a single issue by key, including comments. */
  async fetchIssue(issueKey: string): Promise<JiraIssueRaw> {
    const url =
      `${this.baseUrl}/rest/api/3/issue/${issueKey}` +
      `?fields=${ISSUE_FIELDS}&expand=changelog`;

    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Jira issue "${issueKey}" not found (${res.status}): ${body}`);
    }
    return res.json() as Promise<JiraIssueRaw>;
  }
}

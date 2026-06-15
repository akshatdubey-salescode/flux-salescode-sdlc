// GitHub REST API client (api.github.com, v2022-11-28).
// Auth: bearer GITHUB_TOKEN (a fine-grained PAT). Mirrors JiraClient's
// host-locked, GET-only choke point so writes are structurally impossible and
// SSRF / accidental cross-host calls are blocked before any request is sent.

const GITHUB_API_HOST = "api.github.com";
const GITHUB_API_BASE = `https://${GITHUB_API_HOST}`;

// ---------------------------------------------------------------------------
// Raw response shapes (only the fields we consume)
// ---------------------------------------------------------------------------

export type GitHubRepoRaw = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  language: string | null;
  pushed_at: string | null;
  archived: boolean;
  fork: boolean;
};

/** One contributor's weekly add/del/commit buckets for a repo. */
export type ContributorStatsRaw = {
  // null when GitHub can no longer resolve the account (hard-deleted user).
  author: { login: string; id: number; avatar_url: string; type: string } | null;
  total: number;
  weeks: { w: number; a: number; d: number; c: number }[];
};

export type CommitRaw = {
  sha: string;
  commit: { author: { name: string; email: string; date: string } | null };
  // The resolved GitHub account for the commit author; null for commits whose
  // email GitHub couldn't tie to an account.
  author: { login: string; id: number } | null;
};

export type GitHubUserRaw = {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  avatar_url: string;
};

export class GitHubClient {
  private headers: HeadersInit;
  private org: string;

  constructor(config?: { token?: string; org?: string }) {
    const token = config?.token ?? process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN is not configured");
    }
    this.org = config?.org ?? process.env.GITHUB_ORG ?? "salescode-ai";
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  get organization(): string {
    return this.org;
  }

  /**
   * The ONLY way this client makes HTTP requests. Enforces two invariants on
   * every call:
   *   1. method is always GET — writes are structurally impossible
   *   2. host is always api.github.com — prevents SSRF / cross-host calls
   * Any violation throws before the request is sent.
   */
  private async get(url: string): Promise<Response> {
    const parsed = new URL(url);
    if (parsed.host !== GITHUB_API_HOST) {
      throw new Error(
        `[GitHubClient] BLOCKED: request to "${parsed.host}" is outside the ` +
          `allowed host "${GITHUB_API_HOST}". No request was sent.`
      );
    }
    return fetch(url, { method: "GET", headers: this.headers });
  }

  /** Verify credentials by calling /rate_limit. Returns true if authenticated. */
  async testConnection(): Promise<boolean> {
    const res = await this.get(`${GITHUB_API_BASE}/rate_limit`);
    return res.ok;
  }

  /**
   * Verify this token can actually read the configured org's repos — catches
   * both an invalid token and a fine-grained PAT scoped to a different org.
   * Returns an error string on failure, or null on success.
   */
  async testOrgAccess(): Promise<string | null> {
    const res = await this.get(
      `${GITHUB_API_BASE}/orgs/${encodeURIComponent(this.org)}/repos?per_page=1`
    );
    if (res.ok) return null;
    if (res.status === 401) return "Invalid or expired token.";
    if (res.status === 403)
      return "Token lacks permission for this org (needs Contents + Metadata read).";
    if (res.status === 404)
      return `Org "${this.org}" not found, or the token can't access it.`;
    return `GitHub returned ${res.status} ${res.statusText}.`;
  }

  /**
   * Extract the `rel="next"` URL from a Link header, or null on the last page.
   * GitHub paginates with RFC 5988 Link headers, not cursor tokens.
   */
  private static parseNextLink(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    for (const part of linkHeader.split(",")) {
      const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
      if (match) return match[1];
    }
    return null;
  }

  /**
   * List every repo in the org, following Link-header pagination.
   * type=all includes private repos; archived/forked repos are returned too
   * and filtered downstream (callers decide what to track).
   */
  async listOrgRepos(): Promise<GitHubRepoRaw[]> {
    const all: GitHubRepoRaw[] = [];
    let url: string | null =
      `${GITHUB_API_BASE}/orgs/${encodeURIComponent(this.org)}/repos` +
      `?per_page=100&type=all&sort=full_name`;

    while (url) {
      const res = await this.get(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`GitHub repos list failed (${res.status}): ${body}`);
      }
      const page = (await res.json()) as GitHubRepoRaw[];
      all.push(...page);
      url = GitHubClient.parseNextLink(res.headers.get("link"));
    }
    return all;
  }

  /**
   * Per-author weekly additions/deletions/commits on a repo's default branch.
   *
   * GitHub computes this statistic asynchronously: the first request for a cold
   * repo returns 202 with an empty body while it builds the cache. We retry with
   * backoff until it returns 200; if it never warms within the budget we return
   * [] so one slow repo doesn't abort the whole sync. An empty 200 body (repo
   * with no commits) also yields [].
   */
  async getContributorStats(repoFullName: string): Promise<ContributorStatsRaw[]> {
    const url = `${GITHUB_API_BASE}/repos/${repoFullName}/stats/contributors`;
    // ~2+3+5+8+13 = up to 31s of waiting across 5 retries.
    const backoffMs = [2000, 3000, 5000, 8000, 13000];

    for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
      const res = await this.get(url);

      if (res.status === 202) {
        if (attempt === backoffMs.length) {
          console.warn(
            `[github] contributor stats still computing for ${repoFullName} after ${attempt} retries — skipping this run`
          );
          return [];
        }
        await new Promise((r) => setTimeout(r, backoffMs[attempt]));
        continue;
      }

      if (res.status === 204) return []; // no content — empty repo

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `GitHub contributor stats failed for ${repoFullName} (${res.status}): ${body}`
        );
      }

      const data = await res.json().catch(() => null);
      return Array.isArray(data) ? (data as ContributorStatsRaw[]) : [];
    }
    return [];
  }

  /**
   * Recent commits on a repo, used to bridge GitHub login → commit-author email
   * for identity resolution. Each commit carries both the raw git author email
   * (commit.author.email) and the resolved account (author.login). Bounded to
   * `maxPages` of 100 — enough to map active committers without walking history.
   */
  async listRecentCommits(
    repoFullName: string,
    opts: { since?: string; maxPages?: number } = {}
  ): Promise<CommitRaw[]> {
    const maxPages = opts.maxPages ?? 3;
    const out: CommitRaw[] = [];
    let url: string | null =
      `${GITHUB_API_BASE}/repos/${repoFullName}/commits?per_page=100` +
      (opts.since ? `&since=${encodeURIComponent(opts.since)}` : "");

    for (let page = 0; page < maxPages && url; page++) {
      const res = await this.get(url);
      // 409 = empty repository; 404 = no access. Neither is fatal for identity.
      if (res.status === 409 || res.status === 404) return out;
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `GitHub commits fetch failed for ${repoFullName} (${res.status}): ${body}`
        );
      }
      const batch = (await res.json()) as CommitRaw[];
      out.push(...batch);
      url = GitHubClient.parseNextLink(res.headers.get("link"));
    }
    return out;
  }

  /** Public profile for a login. email is null when the user keeps it private. */
  async getUser(login: string): Promise<GitHubUserRaw | null> {
    const res = await this.get(
      `${GITHUB_API_BASE}/users/${encodeURIComponent(login)}`
    );
    if (!res.ok) return null;
    return (await res.json()) as GitHubUserRaw;
  }
}

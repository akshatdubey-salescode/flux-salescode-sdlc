import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JiraClient, JiraRequestError } from "./client";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

/** Replace fetch with a scripted sequence; records every requested URL. */
function script(replies: Reply[]): { urls: string[]; sleeps: number[] } {
  const urls: string[] = [];
  const sleeps: number[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    urls.push(String(url));
    const r = replies[Math.min(i++, replies.length - 1)];
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return { urls, sleeps };
}

function client(sleeps: number[], retry = {}) {
  return new JiraClient({
    baseUrl: "https://example.atlassian.net",
    email: "a@b.c",
    apiToken: "t",
    retry: { sleep: async (ms) => void sleeps.push(ms), ...retry },
  });
}

describe("JiraClient.searchByJql", () => {
  it("asks for only the named fields, no changelog, and returns the cursor", async () => {
    const s = script([{ status: 200, body: { issues: [{ id: "1", key: "CAV-1", fields: {} }], nextPageToken: "tok" } }]);
    const out = await client(s.sleeps).searchByJql('parent in ("CAV-1")', { fields: ["summary", "status"], nextPageToken: "abc" });
    const u = new URL(s.urls[0]);
    assert.equal(u.pathname, "/rest/api/3/search/jql");
    assert.equal(u.searchParams.get("jql"), 'parent in ("CAV-1")');
    assert.equal(u.searchParams.get("fields"), "summary,status");
    assert.equal(u.searchParams.get("expand"), null);
    assert.equal(u.searchParams.get("nextPageToken"), "abc");
    assert.equal(out.issues[0].key, "CAV-1");
    assert.equal(out.nextPageToken, "tok");
  });

  it("throws a JiraRequestError with the status on a non-retryable failure, without retrying", async () => {
    const s = script([{ status: 400, body: { errorMessages: ["bad jql"] } }]);
    await assert.rejects(
      client(s.sleeps).searchByJql("x", { fields: ["summary"] }),
      (e: unknown) => e instanceof JiraRequestError && e.status === 400
    );
    assert.equal(s.urls.length, 1);
  });
});

describe("JiraClient.fetchIssueComments", () => {
  it("requests newest first with startAt/maxResults and returns the page", async () => {
    const s = script([{ status: 200, body: { startAt: 50, maxResults: 50, total: 120, comments: [{ id: "9" }] } }]);
    const page = await client(s.sleeps).fetchIssueComments("CAV-7346", { startAt: 50 });
    const u = new URL(s.urls[0]);
    assert.equal(u.pathname, "/rest/api/3/issue/CAV-7346/comment");
    assert.equal(u.searchParams.get("orderBy"), "-created");
    assert.equal(u.searchParams.get("startAt"), "50");
    assert.equal(u.searchParams.get("maxResults"), "50");
    assert.equal(page.total, 120);
    assert.equal(page.comments.length, 1);
  });
});

describe("bounded retry", () => {
  it("retries 429 honouring Retry-After, then succeeds", async () => {
    const s = script([
      { status: 429, headers: { "retry-after": "2" } },
      { status: 200, body: { issues: [] } },
    ]);
    const out = await client(s.sleeps).searchByJql("x", { fields: ["summary"] });
    assert.deepEqual(out.issues, []);
    assert.equal(s.urls.length, 2);
    assert.deepEqual(s.sleeps, [2000]);
  });

  it("retries 5xx with backoff and gives up after 3 attempts", async () => {
    const s = script([{ status: 503 }]);
    await assert.rejects(
      client(s.sleeps).fetchIssueComments("CAV-1"),
      (e: unknown) => e instanceof JiraRequestError && e.status === 503
    );
    assert.equal(s.urls.length, 3);
    assert.equal(s.sleeps.length, 2);
    assert.ok(s.sleeps[1] > s.sleeps[0], "exponential backoff");
  });

  it("does not wait when Retry-After exceeds the cap: returns the failure at once", async () => {
    const s = script([{ status: 429, headers: { "retry-after": "120" } }]);
    await assert.rejects(client(s.sleeps).searchByJql("x", { fields: ["a"] }), JiraRequestError);
    assert.equal(s.urls.length, 1);
    assert.deepEqual(s.sleeps, []);
  });

  it("caps the total wait", async () => {
    const s = script([{ status: 429, headers: { "retry-after": "6" } }]);
    await assert.rejects(client(s.sleeps, { maxTotalWaitMs: 8_000 }).searchByJql("x", { fields: ["a"] }));
    assert.equal(s.urls.length, 2, "second wait (6s) would pass the 8s budget");
    assert.deepEqual(s.sleeps, [6000]);
  });

  it("reads Retry-After in HTTP-date form and ignores a garbage value (falls back to backoff)", async () => {
    const date = new Date(Date.now() + 3_000).toUTCString();
    const a = script([{ status: 429, headers: { "retry-after": date } }, { status: 200, body: { issues: [] } }]);
    await client(a.sleeps).searchByJql("x", { fields: ["a"] });
    assert.equal(a.sleeps.length, 1);
    assert.ok(a.sleeps[0] > 500 && a.sleeps[0] <= 3_000, `waited ${a.sleeps[0]}`);

    const b = script([{ status: 503, headers: { "retry-after": "soon" } }, { status: 200, body: { issues: [] } }]);
    await client(b.sleeps).searchByJql("x", { fields: ["a"] });
    assert.ok(b.sleeps[0] >= 500 && b.sleeps[0] < 750, "first backoff step");
  });

  it("times out a request that never answers and counts it as a network error (retried, then thrown)", async () => {
    let n = 0;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      n++;
      return new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)));
    }) as typeof fetch;
    const sleeps: number[] = [];
    const keepAlive = setInterval(() => {}, 50); // AbortSignal.timeout timers are unref'd
    try {
      await assert.rejects(client(sleeps, { timeoutMs: 20 }).fetchIssueComments("CAV-1"), (e: unknown) => e instanceof Error && /timeout|abort/i.test(e.name + e.message));
    } finally {
      clearInterval(keepAlive);
    }
    assert.equal(n, 3);
  });

  it("retries a network error and rethrows after the last attempt", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    const sleeps: number[] = [];
    await assert.rejects(client(sleeps).searchByJql("x", { fields: ["a"] }), /ECONNRESET/);
    assert.equal(n, 3);
  });
});

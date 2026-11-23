import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { api } from "./api";
import { SESSION_EXPIRED } from "./view-model";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Fake = { ok: boolean; status: number; redirected?: boolean; json: () => Promise<unknown> };
const stub = (f: (init: RequestInit) => Promise<Fake>) => {
  globalThis.fetch = ((_url: string, init: RequestInit) => f(init)) as unknown as typeof fetch;
};
const jsonRes = (status: number, body: unknown): Fake => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const htmlRes = (status: number, redirected = false): Fake => ({ ok: status >= 200 && status < 300, status, redirected, json: async () => { throw new SyntaxError("Unexpected token <"); } });
/** A fetch that only ends when its signal aborts. */
const hang = (init: RequestInit) => new Promise<Fake>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

describe("api(): every way a call can go wrong is a failure with a message", () => {
  it("a followed redirect (expired session: sign-in page) is a 401 failure, not ok with no data", async () => {
    stub(async () => ({ ...htmlRes(200, true) }));
    const r = await api("/x");
    assert.deepEqual([r.ok, r.status, r.data, r.error, r.aborted], [false, 401, null, SESSION_EXPIRED, false]);
  });
  it("200 with an HTML body (or an empty one) is a failure too", async () => {
    stub(async () => htmlRes(200));
    const html = await api("/x");
    assert.deepEqual([html.ok, html.status, html.error], [false, 401, SESSION_EXPIRED]);
    stub(async () => jsonRes(200, null));
    assert.equal((await api("/x")).ok, false);
  });
  it("a JSON 200 is a success; a JSON 409 keeps its body and message", async () => {
    stub(async () => jsonRes(200, { a: 1 }));
    const ok = await api<{ a: number }>("/x");
    assert.deepEqual([ok.ok, ok.data?.a], [true, 1]);
    stub(async () => jsonRes(409, { error: "X is blocked", code: "blocked" }));
    const conflict = await api("/x");
    assert.deepEqual([conflict.ok, conflict.status, conflict.error, (conflict.body as { code?: string }).code], [false, 409, "X is blocked", "blocked"]);
  });
  it("a 5xx HTML page and an explicit 401 give readable messages", async () => {
    stub(async () => htmlRes(502));
    const gateway = await api("/x");
    assert.deepEqual([gateway.ok, gateway.status, gateway.error], [false, 502, "The server had a problem; try again"]);
    stub(async () => jsonRes(401, {}));
    assert.equal((await api("/x")).error, SESSION_EXPIRED);
  });
  it("a network error is status 0 with the connection message, not aborted", async () => {
    stub(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await api("/x");
    assert.deepEqual([r.ok, r.status, r.aborted, r.timedOut], [false, 0, false, false]);
    assert.match(r.error ?? "", /Network problem/);
  });
  it("the timeout is reported as timedOut (not aborted)", async () => {
    stub(hang);
    const r = await api("/x", { timeoutMs: 15 });
    assert.deepEqual([r.ok, r.timedOut, r.aborted], [false, true, false]);
    assert.match(r.error ?? "", /too long/);
  });
  it("the caller's abort is aborted, with no message; an abort while the body is read is not a success", async () => {
    stub(hang);
    const ctl = new AbortController();
    const p = api("/x", { signal: ctl.signal });
    ctl.abort();
    const r = await p;
    assert.deepEqual([r.ok, r.aborted, r.error], [false, true, null]);
    const late = new AbortController();
    stub(async () => ({ ok: true, status: 200, json: async () => { late.abort(); return { a: 1 }; } }));
    const r2 = await api("/x", { signal: late.signal });
    assert.equal(r2.ok, false);
    assert.equal(r2.aborted, true);
  });
});

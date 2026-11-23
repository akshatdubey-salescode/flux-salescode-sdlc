import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { badIds, MAX_BODY_BYTES, readJson, run } from "./http";
import { MovementError } from "./types";

// The route handlers cannot be called without a session (requireAuth redirects), so this covers the
// wiring they share: body limits, UUID checks and the error mapping. The 401 redirect and the 403/409
// answers come from requireAuth and state.ts, which have their own tests.
const req = (body: string, headers: Record<string, string> = {}) => new Request("http://x.test/", { method: "POST", body, headers });

describe("route wiring helpers", () => {
  it("readJson: 413 by Content-Length before the body is read, 413 by real bytes, 400 for junk, {} when optional", async () => {
    await assert.rejects(() => readJson(req("{}", { "content-length": String(MAX_BODY_BYTES + 1) })), (e: unknown) => (e as MovementError).status === 413);
    await assert.rejects(() => readJson(req(JSON.stringify({ a: "é".repeat(MAX_BODY_BYTES / 2 + 10) }))), (e: unknown) => (e as MovementError).status === 413, "multi-byte text counts in bytes");
    for (const bad of ["{nope", "[]", "5", ""]) await assert.rejects(() => readJson(req(bad)), (e: unknown) => (e as MovementError).status === 400);
    assert.deepEqual(await readJson(req(""), false), {});
    assert.deepEqual(await readJson(req('{"a":1}')), { a: 1 });
  });

  it("badIds answers 400 for a malformed uuid; run maps MovementError to its status and body, and lets anything else through", async () => {
    assert.equal(badIds({ id: "not-a-uuid" })?.status, 400);
    assert.equal(badIds({ id: "7d444840-9dc0-41d4-8d0e-3b2c9d3f5c11" }), null);
    const r = await run(async () => {
      throw new MovementError(409, "stale", "stale_hash", { currentHash: "abc" });
    });
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: "stale", code: "stale_hash", currentHash: "abc" });
    await assert.rejects(() => run(async () => { throw new Error("boom"); }), /boom/);
  });
});

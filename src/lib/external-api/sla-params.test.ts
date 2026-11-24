// Run: ./node_modules/.bin/tsx --test "src/lib/external-api/sla-params.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSlaQuery, SLA_DEFAULT_LIMIT, SLA_MAX_LIMIT } from "./sla-params";

const parse = (qs: string) => parseSlaQuery(new URLSearchParams(qs));

test("defaults to open violations, first page", () => {
  assert.deepEqual(parse(""), { ok: true, query: { status: "open", limit: SLA_DEFAULT_LIMIT, offset: 0 } });
});

test("accepts status case-insensitively", () => {
  const r = parse("status=Resolved&limit=50&offset=100");
  assert.deepEqual(r, { ok: true, query: { status: "resolved", limit: 50, offset: 100 } });
  assert.ok(parse("status=all").ok);
});

test("rejects bad values with a reason", () => {
  for (const qs of ["status=closed", "limit=0", `limit=${SLA_MAX_LIMIT + 1}`, "limit=abc", "offset=-1"]) {
    const r = parse(qs);
    assert.equal(r.ok, false, qs);
    if (!r.ok) assert.match(r.message, /'(status|limit|offset)'/);
  }
});

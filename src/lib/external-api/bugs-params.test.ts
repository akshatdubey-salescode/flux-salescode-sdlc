// Run: ./node_modules/.bin/tsx --test "src/lib/external-api/bugs-params.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBugsQuery, BUGS_DEFAULT_LIMIT } from "./bugs-params";

const DEFAULTS = { start: "2000-01-01", end: "2026-11-20" };
const parse = (qs: string) => parseBugsQuery(new URLSearchParams(qs), DEFAULTS);

test("defaults when no params are given", () => {
  const r = parse("");
  assert.ok(r.ok);
  assert.deepEqual(r.query, {
    start: "2000-01-01",
    end: "2026-11-20",
    env: null,
    owner: null,
    q: null,
    includeInvalid: false,
    status: "all",
    priority: null,
    sort: "priority",
    dir: "asc",
    limit: BUGS_DEFAULT_LIMIT,
    offset: 0,
  });
});

test("parses every filter", () => {
  const r = parse(
    "start=2026-01-01&end=2026-06-30&env=Production&owner=a%40x.ai&q=crash&includeInvalid=true&status=open&priority=p1,P2&sort=updated&dir=desc&limit=50&offset=100"
  );
  assert.ok(r.ok);
  assert.equal(r.query.env, "Production");
  assert.equal(r.query.owner, "a@x.ai");
  assert.equal(r.query.includeInvalid, true);
  assert.equal(r.query.status, "open");
  assert.deepEqual(r.query.priority, ["P1", "P2"]);
  assert.equal(r.query.sort, "updated");
  assert.equal(r.query.dir, "desc");
  assert.equal(r.query.limit, 50);
  assert.equal(r.query.offset, 100);
});

test("rejects bad input with a reason", () => {
  for (const qs of [
    "start=2026-13-01",
    "end=yesterday",
    "start=2026-02-01&end=2026-01-01",
    "includeInvalid=maybe",
    "status=pending",
    "priority=P9",
    "sort=random",
    "dir=up",
    "limit=0",
    "limit=999999",
    "offset=-1",
  ]) {
    const r = parse(qs);
    assert.equal(r.ok, false, qs);
  }
});

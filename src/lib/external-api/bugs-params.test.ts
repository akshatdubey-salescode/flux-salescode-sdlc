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

test("resolves project keys and ids, rejecting unknown and ambiguous ones", async () => {
  const { resolveProjectRefs } = await import("./bugs-params");
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";
  const C = "33333333-3333-3333-3333-333333333333";
  const projects = [
    { id: A, key: "SC", jiraBaseUrl: "https://one.atlassian.net" },
    { id: B, key: "DEV", jiraBaseUrl: "https://one.atlassian.net" },
    { id: C, key: "DEV", jiraBaseUrl: "https://two.atlassian.net" },
  ];
  assert.deepEqual(resolveProjectRefs("sc", projects), { ok: true, ids: [A] });
  assert.deepEqual(resolveProjectRefs(`SC, ${B.toUpperCase()}, sc`, projects), { ok: true, ids: [A, B] });
  assert.equal(resolveProjectRefs("DEV", projects).ok, false); // ambiguous
  assert.equal(resolveProjectRefs("NOPE", projects).ok, false);
  assert.equal(resolveProjectRefs(" , ", projects).ok, false);
});

test("applyBugsQuery filters, sorts and pages", async () => {
  const { applyBugsQuery } = await import("./bugs-params");
  const r = parse("status=open&sort=key&limit=1&offset=1");
  assert.ok(r.ok);
  const base = {
    id: "x", summary: "", projectKey: "SC", projectName: "S", jiraBaseUrl: null, status: "Open",
    statusCategory: null, priority: "P2", priorityBucket: "P2" as const, environment: "Prod",
    rcaGiven: false, rcaText: null, ownerName: "o", ownerEmail: null, assigneeName: null,
    assigneeEmail: null, isOpen: true, isInvalid: false, jiraCreatedAt: null, jiraUpdatedAt: null,
    jiraClosedAt: null,
  };
  const rows = [
    { ...base, jiraKey: "SC-3" },
    { ...base, jiraKey: "SC-1" },
    { ...base, jiraKey: "SC-2", isOpen: false },
    { ...base, jiraKey: "SC-4", isInvalid: true },
  ];
  const out = applyBugsQuery(rows, r.query);
  assert.equal(out.total, 2);
  assert.deepEqual(out.page.map((b) => b.jiraKey), ["SC-3"]);
});

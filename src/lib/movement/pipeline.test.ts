import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JiraClient } from "@/lib/jira/client";
import { ByteLru } from "./cache";
import { FakeJira, fixtureComment, noiseComment, type FakeIssue } from "./fake-jira";
import type { JiraSource } from "./jira-source";
import { approxBytes, type ParsedRecord } from "./record";
import { computeReadiness } from "./readiness";
import { loadRecords, type IssueRecords } from "./records";
import { resolveTrees } from "./tree";

const caches = () => ({
  recordCache: new ByteLru<string, ParsedRecord>({ maxBytes: 8_000_000, weigh: approxBytes }),
  resultCache: new ByteLru<string, IssueRecords>({ maxBytes: 4_000_000, ttlMs: 60_000, weigh: () => 1000 }),
});

/** The real union comment 81643, re-keyed for another ticket. */
const unionFor = (key: string, id: string): FakeIssue["comments"] => {
  const c = fixtureComment("CAV-7280-81643");
  return [{ ...c, id, body: JSON.parse(JSON.stringify(c.body).replace(/CAV-7280/g, key)) }];
};

describe("tree -> records -> readiness", () => {
  it("a delivery of 60 Jiras (one review comment each) with 3 sub-tasks each stays within a small, bounded number of Jira calls", async () => {
    const T0 = Date.parse("2026-11-19T00:00:00Z");
    const issues: FakeIssue[] = [];
    for (let i = 1; i <= 60; i++) {
      const root = `CAV-${1000 + i}`;
      issues.push({ key: root, comments: [noiseComment("1", T0), ...(unionFor(root, `${50000 + i}`) ?? [])] });
      for (let s = 1; s <= 3; s++) issues.push({ key: `SUB-${i * 10 + s}`, subtask: true, parent: root, comments: s === 3 ? [noiseComment("9", T0)] : [] });
    }
    const jira = new FakeJira(issues);
    const roots = [...jira.issues.values()].filter((i) => !i.parent).map((i) => i.key);
    assert.equal(roots.length, 60);

    const trees = await resolveTrees(jira, roots);
    const treeCalls = jira.searchCalls;
    const nodes = [...trees.trees.values()].flatMap((t) => t.nodes);
    assert.equal(nodes.length, 240);
    const rec = await loadRecords(jira, nodes, caches());

    // 2 (roots, 50 per call) + 3 (children of 60 roots = 180 issues in pages of 100; sub-tasks are leaves)
    assert.equal(treeCalls, 5);
    // 60 roots read once (1 page each); the 180 sub-tasks go through 4 discovery JQLs (50 keys each), none has a record
    assert.equal(jira.commentCalls, 60);
    assert.equal(rec.stats.jiraCalls, 64);
    assert.equal(jira.calls, 69);

    // Explicit Refresh: 240 nodes is above the 150 limit, so it falls back to discovery (same cost);
    // a smaller delivery (20 roots = 80 nodes) reads every sub-task directly: 80 comment reads, no discovery.
    const big = await loadRecords(jira, nodes, { ...caches(), bypassResultCache: true });
    assert.equal(big.stats.jiraCalls, 64);
    const smallNodes = [...trees.trees.values()].slice(0, 20).flatMap((t) => t.nodes);
    const jira2 = new FakeJira([...jira.issues.values()]);
    const small = await loadRecords(jira2, smallNodes, { ...caches(), bypassResultCache: true });
    assert.equal(small.stats.jiraCalls, 80);
    assert.equal(jira2.searchCalls, 0);

    const r = computeReadiness({ root: roots[0], tree: trees.trees.get(roots[0])!, recordsByIssue: rec.byIssue });
    assert.equal(r.readiness, "ready", JSON.stringify(r.blockers));
    assert.deepEqual([r.reviews, r.prsCovered], [1, 2]);
  });

  it("end to end on the real CAV-7346 per-PR comments: ready; the same Jira with no review comment is blocked", async () => {
    const jira = new FakeJira([
      { key: "CAV-7346", comments: [fixtureComment("CAV-7346-81399"), fixtureComment("CAV-7346-81400"), fixtureComment("CAV-7346-81421")] },
      { key: "CAV-7347", subtask: true, parent: "CAV-7346" },
    ]);
    const t = (await resolveTrees(jira, ["CAV-7346"])).trees.get("CAV-7346")!;
    const out = await loadRecords(jira, t.nodes, caches());
    const r = computeReadiness({ root: "CAV-7346", tree: t, recordsByIssue: out.byIssue });
    assert.equal(r.readiness, "ready", JSON.stringify(r.blockers));
    assert.equal(r.reviews, 3);

    const bare = new FakeJira([{ key: "CAV-7280" }, { key: "CAV-7281", subtask: true, parent: "CAV-7280" }]);
    const t2 = (await resolveTrees(bare, ["CAV-7280"])).trees.get("CAV-7280")!;
    const none = computeReadiness({ root: "CAV-7280", tree: t2, recordsByIssue: (await loadRecords(bare, t2.nodes, caches())).byIssue });
    assert.deepEqual(none.blockers.map((b) => [b.code, b.message]), [["no_record", "No review comment found on this Jira"]]);
  });
});

describe("linked-issue cap", () => {
  it("70 'relates' links with the review comment on the root is READY with a linked_truncated warning (linked issues never block)", async () => {
    const links = Array.from({ length: 70 }, (_, i) => ({ key: `OTH-${i + 1}` }));
    const jira = new FakeJira([{ key: "CAV-7280", links, comments: [fixtureComment("CAV-7280-81643")] }]);
    const t = (await resolveTrees(jira, ["CAV-7280"])).trees.get("CAV-7280")!;
    assert.equal(t.nodes.length, 60);
    const out = await loadRecords(jira, t.nodes, caches());
    const r = computeReadiness({ root: "CAV-7280", tree: t, recordsByIssue: out.byIssue });
    assert.equal(r.readiness, "ready", JSON.stringify(r.blockers));
    assert.ok(r.warnings.some((w) => w.code === "linked_truncated"));
  });
});

describe("JiraClient", () => {
  it("satisfies the JiraSource interface the movement code depends on (compile-time check)", () => {
    const real: JiraSource = new JiraClient({ baseUrl: "https://example.atlassian.net", email: "a@b.c", apiToken: "t" });
    assert.equal(typeof real.searchByJql, "function");
    assert.equal(typeof real.fetchIssueComments, "function");
  });
});

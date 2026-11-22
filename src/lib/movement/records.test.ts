import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ByteLru } from "./cache";
import { FakeJira, fixtureComment, noiseComment } from "./fake-jira";
import type { JiraSource } from "./jira-source";
import { approxBytes, type ParsedRecord } from "./record";
import { loadRecords, type IssueRecords } from "./records";
import type { TreeNode } from "./tree";

const node = (key: string, kind: TreeNode["kind"]): TreeNode => ({ key, kind, parentKey: null, issueType: "", statusName: "", summary: "" });
const caches = () => ({
  recordCache: new ByteLru<string, ParsedRecord>({ maxBytes: 8_000_000, weigh: approxBytes }),
  resultCache: new ByteLru<string, IssueRecords>({ maxBytes: 4_000_000, ttlMs: 60_000, weigh: () => 1000 }),
});
const T0 = Date.parse("2026-11-19T00:00:00Z");

describe("loadRecords", () => {
  it("reads the roots directly, finds the sub-Jiras with records through ONE JQL, and ignores non-record comments", async () => {
    const jira = new FakeJira([
      { key: "CAV-7346", comments: [noiseComment("1", T0), fixtureComment("CAV-7346-81399"), fixtureComment("CAV-7346-81400"), fixtureComment("CAV-7346-81421"), noiseComment("2", T0 + 1e6)] },
      { key: "CAV-8001", subtask: true, parent: "CAV-7346", comments: [noiseComment("3", T0)] },
      { key: "CAV-8002", subtask: true, parent: "CAV-7346" }, // no comments
      { key: "CAV-8003", subtask: true, parent: "CAV-7346", comments: [fixtureComment("CAV-7304-81424")] }, // a record
      { key: "CAV-8004", subtask: true, parent: "CAV-7346", comments: [noiseComment("4", T0)] },
    ]);
    const nodes = ["CAV-7346", "CAV-8001", "CAV-8002", "CAV-8003", "CAV-8004"].map((k, i) => node(k, i === 0 ? "root" : "subtask"));
    const out = await loadRecords(jira, nodes, caches());

    assert.equal(jira.jqls.length, 1);
    assert.match(jira.jqls[0], /^issue in \(CAV-8001,CAV-8002,CAV-8003,CAV-8004\) AND comment ~ "DEPLOYMENT-RECORD"$/);
    assert.deepEqual([...out.byIssue.keys()].sort(), ["CAV-7346", "CAV-8003"]);
    assert.equal(out.byIssue.get("CAV-7346")!.records.length, 3);
    assert.equal(out.byIssue.get("CAV-8003")!.records[0].marker.repo, "kpi-dashboard");
    assert.equal(out.stats.recordsParsed, 4);
    assert.equal(out.stats.commentsSeen, 5 + 1);
    assert.equal(out.stats.jiraCalls, 1 + 2);
  });

  it("legacy per-PR records: reading continues until every sibling the records name has its own record, then stops", async () => {
    const old = Array.from({ length: 300 }, (_, i) => noiseComment(String(100 + i), T0 - (i + 1) * 60_000));
    const jira = new FakeJira([{ key: "CAV-7346", comments: [fixtureComment("CAV-7346-81399"), fixtureComment("CAV-7346-81400"), fixtureComment("CAV-7346-81421"), ...old] }]);
    const out = await loadRecords(jira, [node("CAV-7346", "root")], caches());
    assert.equal(jira.commentCalls, 1, "the 3 records are in the first page and cover each other's siblings; 300 older comments untouched");
    assert.equal(out.byIssue.get("CAV-7346")!.records.length, 3);
    assert.equal(out.byIssue.get("CAV-7346")!.capped, false);

    // only one of them: its siblings are not covered, so the read goes on to the end of the comments (here: the cap)
    const lonely = new FakeJira([{ key: "CAV-7346", comments: [fixtureComment("CAV-7346-81399"), ...old] }]);
    const more = await loadRecords(lonely, [node("CAV-7346", "root")], caches());
    assert.equal(lonely.commentCalls, 4);
    assert.equal(more.byIssue.get("CAV-7346")!.capped, true);
  });

  it("flags capped when 200 comments hold no record (a record at position 250 is never seen)", async () => {
    const comments = Array.from({ length: 300 }, (_, i) => noiseComment(String(1000 + i), T0 - (i + 1) * 60_000));
    comments[249] = { ...fixtureComment("CAV-7346-81399"), created: new Date(T0 - 250 * 60_000).toISOString() };
    const jira = new FakeJira([{ key: "CAV-7346", comments }]);
    const out = await loadRecords(jira, [node("CAV-7346", "root")], caches());
    const r = out.byIssue.get("CAV-7346")!;
    assert.equal(r.capped, true);
    assert.equal(r.exhausted, false);
    assert.equal(r.records.length, 0);
    assert.equal(jira.commentCalls, 4);
  });

  it("a failed discovery batch reports every key of the batch as unreadable instead of silently finding nothing", async () => {
    const jira = new FakeJira([{ key: "CAV-1" }, { key: "CAV-2", subtask: true, parent: "CAV-1" }, { key: "CAV-3", subtask: true, parent: "CAV-1" }]);
    jira.failSearchWhen = (j) => j.includes("comment ~");
    const out = await loadRecords(jira, [node("CAV-1", "root"), node("CAV-2", "subtask"), node("CAV-3", "subtask")], caches());
    for (const k of ["CAV-2", "CAV-3"]) assert.match(out.byIssue.get(k)!.error ?? "", /record discovery failed/);
    assert.equal(out.stats.discoveryFailed, 2);
  });

  it("an explicit Refresh reads every non-linked node directly (no text-index discovery) while the run is <= 150 nodes", async () => {
    const T = Date.parse("2026-11-19T00:00:00Z");
    const jira = new FakeJira([
      { key: "CAV-1" },
      { key: "CAV-2", subtask: true, parent: "CAV-1", comments: [fixtureComment("CAV-7304-81424")] }, // record not yet searchable
      { key: "CAV-3", subtask: true, parent: "CAV-1", comments: [noiseComment("1", T)] },
      { key: "CAV-9", comments: [] },
    ]);
    jira.failSearchWhen = (j) => !j.includes("CAV-9"); // text search "not indexed yet": finds nothing for the others
    const nodes = [node("CAV-1", "root"), node("CAV-2", "subtask"), node("CAV-3", "subtask"), node("CAV-9", "linked")];
    const out = await loadRecords(jira, nodes, { ...caches(), bypassResultCache: true });
    assert.equal(out.byIssue.get("CAV-2")!.records.length, 1, "found without discovery");
    assert.equal(jira.commentCalls, 3, "root + 2 sub-tasks read; the linked node goes through discovery");
    assert.equal(jira.searchCalls, 1);
  });

  it("two simultaneous loads of the same issue share one Jira read", async () => {
    const jira = new FakeJira([{ key: "CAV-7346", comments: [fixtureComment("CAV-7346-81399")] }]);
    const c = caches();
    const nodes = [node("CAV-7346", "root")];
    const [a, b] = await Promise.all([loadRecords(jira, nodes, c), loadRecords(jira, nodes, c)]);
    assert.equal(jira.commentCalls, 1);
    assert.equal(a.byIssue.get("CAV-7346")!.records.length, 1);
    assert.equal(b.byIssue.get("CAV-7346")!.records.length, 1);
  });

  it("a union record (real comment 81643) ends the read at the newest page; an older union of the same ticket is superseded", async () => {
    const old = Array.from({ length: 120 }, (_, i) => noiseComment(String(100 + i), T0 - (i + 1) * 60_000));
    const dup = { ...fixtureComment("CAV-7280-81643"), id: "81500", created: "2026-11-20T19:00:00.000+0000", updated: "2026-11-20T19:00:00.000+0000" }; // an older copy
    const jira = new FakeJira([{ key: "CAV-7280", comments: [fixtureComment("CAV-7280-81643"), dup, ...old] }]);
    const out = await loadRecords(jira, [node("CAV-7280", "root")], caches());
    assert.equal(jira.commentCalls, 1, "a record is held and it names no uncovered sibling: 120 older comments untouched");
    const r = out.byIssue.get("CAV-7280")!;
    assert.equal(r.records.length, 1, "one review comment per Jira: the newest union");
    assert.equal(r.records[0].comment.id, "81643");
    assert.equal(r.capped, false);
  });

  it("30 different union comments on one ticket: only the newest is kept (and at most 20 are ever held while paging)", async () => {
    const base = fixtureComment("CAV-7280-81643");
    const many = Array.from({ length: 30 }, (_, i) => {
      // 30 distinct covers sets: swap the PR number in the readable text of the first PR line
      const body = JSON.parse(JSON.stringify(base.body).replace(/#931/g, `#${5000 + i}`).replace(/\/pull\/931/g, `/pull/${5000 + i}`));
      return { ...base, id: String(90000 + i), body, created: new Date(T0 - i * 60_000).toISOString(), updated: new Date(T0 - i * 60_000).toISOString() };
    });
    const jira = new FakeJira([{ key: "CAV-7280", comments: many }]);
    const out = await loadRecords(jira, [node("CAV-7280", "root")], caches());
    const kept = out.byIssue.get("CAV-7280")!.records;
    assert.deepEqual(kept.map((r) => r.comment.id), ["90000"]);
  });

  it("parses once: a second run is served by the 60 s result cache, then by the parsed-record cache; an edit re-parses", async () => {
    const jira = new FakeJira([{ key: "CAV-7346", comments: [fixtureComment("CAV-7346-81399")] }]);
    const c = caches();
    const nodes = [node("CAV-7346", "root")];
    const a = await loadRecords(jira, nodes, c);
    assert.equal(a.stats.recordsParsed, 1);
    const b = await loadRecords(jira, nodes, c);
    assert.equal(b.stats.issueCacheHits, 1);
    assert.equal(b.stats.jiraCalls, 0);
    const d = await loadRecords(jira, nodes, { ...c, bypassResultCache: true });
    assert.equal(d.stats.cacheHits, 1);
    assert.equal(d.stats.recordsParsed, 0);
    // the comment is edited: same id, new `updated` -> new cache key -> parsed again
    jira.issues.get("CAV-7346")!.comments![0].updated = "2026-11-19T15:00:00.000+0000";
    const e = await loadRecords(jira, nodes, { ...c, bypassResultCache: true });
    assert.equal(e.stats.recordsParsed, 1);
  });

  it("degrades per issue when Jira fails, and never runs more than 5 reads at once", async () => {
    const jira = new FakeJira([]);
    for (let i = 0; i < 12; i++) jira.add({ key: `CAV-${9000 + i}`, comments: [noiseComment("1", T0)] });
    jira.failCommentsFor.add("CAV-9003");
    let inflight = 0;
    let peak = 0;
    const slow: JiraSource = {
      searchByJql: (j, o) => jira.searchByJql(j, o),
      fetchIssueComments: async (k, o) => {
        inflight++;
        peak = Math.max(peak, inflight);
        await new Promise((r) => setTimeout(r, 5));
        try {
          return await jira.fetchIssueComments(k, o);
        } finally {
          inflight--;
        }
      },
    };
    const nodes = Array.from({ length: 12 }, (_, i) => node(`CAV-${9000 + i}`, "root"));
    const out = await loadRecords(slow, nodes, caches());
    assert.equal(peak, 5);
    assert.match(out.byIssue.get("CAV-9003")!.error ?? "", /failed \(500\)/);
    assert.equal(out.byIssue.get("CAV-9004")!.error, undefined);
  });
});

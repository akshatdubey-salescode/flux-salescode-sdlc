import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FakeJira } from "./fake-jira";
import { allKeys, resolveTrees } from "./tree";

const kinds = (t: { nodes: Array<{ key: string; kind: string }> }) => Object.fromEntries(t.nodes.map((n) => [n.key, n.kind]));

describe("resolveTrees", () => {
  it("finds sub-tasks, deeper children and one-hop linked leaves with the right kinds and parents", async () => {
    const jira = new FakeJira([
      { key: "CAV-1", type: "Epic", links: [{ key: "CAV-90", type: "Blocks" }] },
      { key: "CAV-2", subtask: true, parent: "CAV-1" },
      { key: "CAV-3", parent: "CAV-1", links: [{ key: "CAV-91" }] }, // a Story under the epic
      { key: "CAV-4", subtask: true, parent: "CAV-3" }, // level 2
      { key: "CAV-90", summary: "linked", subtask: false },
      { key: "CAV-91" },
      { key: "CAV-92", parent: "CAV-91" }, // child of a LINKED issue: must not be followed
    ]);
    const r = await resolveTrees(jira, ["CAV-1"]);
    const t = r.trees.get("CAV-1")!;
    assert.deepEqual(kinds(t), { "CAV-1": "root", "CAV-2": "subtask", "CAV-3": "child", "CAV-4": "subtask", "CAV-90": "linked", "CAV-91": "linked" });
    assert.equal(t.nodes.find((n) => n.key === "CAV-4")!.parentKey, "CAV-3");
    assert.equal(t.nodes.find((n) => n.key === "CAV-91")!.parentKey, "CAV-3", "linked from the node it hangs off");
    assert.equal(t.nodes.find((n) => n.key === "CAV-90")!.linkType, "Blocks");
    assert.equal(t.truncated, false);
    assert.deepEqual(t.errors, []);
    assert.ok(!allKeys(r.trees.values()).includes("CAV-92"));
  });

  it("is cycle-safe (a child linked back to the root, a parent loop)", async () => {
    const jira = new FakeJira([
      { key: "CAV-1", parent: "CAV-3" }, // CAV-1 -> CAV-2 -> CAV-3 -> CAV-1 by parent links
      { key: "CAV-2", parent: "CAV-1" },
      { key: "CAV-3", parent: "CAV-2", links: [{ key: "CAV-1" }] },
    ]);
    const t = (await resolveTrees(jira, ["CAV-1"])).trees.get("CAV-1")!;
    assert.deepEqual(t.nodes.map((n) => n.key).sort(), ["CAV-1", "CAV-2", "CAV-3"]);
    assert.equal(t.truncated, false);
  });

  it("caps depth at 5 levels and flags it", async () => {
    const issues = [{ key: "CAV-1" }];
    for (let i = 2; i <= 9; i++) issues.push({ key: `CAV-${i}`, parent: `CAV-${i - 1}` } as never);
    const t = (await resolveTrees(new FakeJira(issues), ["CAV-1"])).trees.get("CAV-1")!;
    assert.equal(t.nodes.length, 6, "root + 5 levels");
    assert.equal(t.truncated, true);
    assert.match(t.warnings.join(" "), /Depth limit 5/);
  });

  it("a chain whose depth-5 node has no children is NOT truncated", async () => {
    const issues = [{ key: "CAV-1" }];
    for (let i = 2; i <= 6; i++) issues.push({ key: `CAV-${i}`, parent: `CAV-${i - 1}` } as never);
    const t = (await resolveTrees(new FakeJira(issues), ["CAV-1"])).trees.get("CAV-1")!;
    assert.equal(t.nodes.length, 6);
    assert.equal(t.truncated, false);
  });

  it("follows nextPageToken when a parent has more children than one page", async () => {
    const issues = [{ key: "CAV-1" }];
    for (let i = 0; i < 5; i++) issues.push({ key: `CAV-${10 + i}`, subtask: true, parent: "CAV-1" } as never);
    const jira = new FakeJira(issues);
    const t = (await resolveTrees(jira, ["CAV-1"], { pageSize: 2 })).trees.get("CAV-1")!;
    assert.equal(t.nodes.length, 6);
    assert.equal(jira.jqls.filter((j) => j.startsWith("parent in")).length, 3, "5 children in pages of 2");
  });

  it("cap of 60: hierarchy first; a cut that only drops linked issues is linkedTruncated, not truncated", async () => {
    const issues = [{ key: "CAV-1", links: Array.from({ length: 10 }, (_, i) => ({ key: `OTH-${i + 1}` })) }];
    for (let i = 0; i < 59; i++) issues.push({ key: `CAV-${100 + i}`, parent: "CAV-1" } as never);
    const t = (await resolveTrees(new FakeJira(issues as never), ["CAV-1"])).trees.get("CAV-1")!;
    assert.equal(t.nodes.length, 60);
    assert.equal(t.nodes.filter((n) => n.kind === "child").length, 59, "every child kept");
    assert.equal(t.nodes.filter((n) => n.kind === "linked").length, 0, "linked crowded out, not children");
    assert.equal(t.linkedTruncated, true);
    assert.equal(t.truncated, false);

    issues.push({ key: "CAV-999", parent: "CAV-1" } as never); // one child too many: the hierarchy itself is cut
    const cut = (await resolveTrees(new FakeJira(issues as never), ["CAV-1"])).trees.get("CAV-1")!;
    assert.equal(cut.truncated, true);
  });

  it("reads a node shared by two roots once and gives both roots the node", async () => {
    const jira = new FakeJira([
      { key: "CAV-1" },
      { key: "CAV-2", links: [{ key: "CAV-10" }] },
      { key: "CAV-10", parent: "CAV-1" },
      { key: "CAV-11", subtask: true, parent: "CAV-10" },
    ]);
    const r = await resolveTrees(jira, ["CAV-1", "CAV-2"]);
    assert.ok(r.trees.get("CAV-1")!.nodes.some((n) => n.key === "CAV-11"));
    assert.equal(r.trees.get("CAV-2")!.nodes.find((n) => n.key === "CAV-10")!.kind, "linked", "per-root kind");
    // roots (1) + children of CAV-1,CAV-2 (1) + children of CAV-10 (1); the sub-task CAV-11 is a leaf
    assert.equal(jira.searchCalls, 3);
  });

  it("uses 50-key batches, asks only for the lean fields and never expands the changelog", async () => {
    const issues = Array.from({ length: 120 }, (_, i) => ({ key: `CAV-${i + 1}` }));
    const jira = new FakeJira(issues);
    await resolveTrees(jira, issues.map((i) => i.key));
    const rootCalls = jira.jqls.filter((j) => j.startsWith("key in"));
    assert.equal(rootCalls.length, 3, "120 roots -> 3 batches of <= 50");
    for (const j of jira.jqls) assert.ok((j.match(/CAV-\d+/g) ?? []).length <= 50);
    assert.equal(jira.jqls.filter((j) => j.startsWith("parent in")).length, 3);
  });

  it("rejects bad keys, reports a missing root and degrades when a batch fails", async () => {
    const jira = new FakeJira([{ key: "CAV-1" }, { key: "CAV-2", parent: "CAV-1" }]);
    jira.failSearchWhen = (j) => j.startsWith("parent in");
    const r = await resolveTrees(jira, ["CAV-1", "cav-404", "x y", "DROP-1; --"]);
    assert.equal(r.warnings.length, 2, "two invalid keys ignored");
    assert.match(r.trees.get("CAV-404")!.errors[0], /not found/);
    const t1 = r.trees.get("CAV-1")!;
    assert.match(t1.errors.join(" "), /Could not read the children of CAV-1/);
    assert.equal(t1.nodes.length, 1);
  });

  it("a failed depth-limit children check is an ERROR (degraded), not only a cut; a healthy check at the limit is clean", async () => {
    // R -> C1 -> C2: with maxDepth 1 the node left at the limit is C1, and the check asks for ITS children.
    const mk = () => new FakeJira([{ key: "CAV-1" }, { key: "CAV-2", parent: "CAV-1" }, { key: "CAV-3", parent: "CAV-2" }]);
    const ok = (await resolveTrees(mk(), ["CAV-1"], { maxDepth: 1 })).trees.get("CAV-1")!;
    assert.equal(ok.truncated, true, "CAV-2 really has a child");
    assert.deepEqual(ok.errors, [], "a cut that was read fine is not an outage");
    const jira = mk();
    jira.failSearchWhen = (j) => j.startsWith("parent in (CAV-2");
    const t = (await resolveTrees(jira, ["CAV-1"], { maxDepth: 1 })).trees.get("CAV-1")!;
    assert.equal(t.truncated, true);
    assert.ok(t.errors.some((e) => /CAV-2/.test(e) && /depth limit/.test(e)), t.errors.join("|"));
  });

  it("a sub-task whose own fields cannot be read marks the tree degraded (its links would be lost silently)", async () => {
    const inner = new FakeJira([{ key: "CAV-1" }, { key: "CAV-5", subtask: true, parent: "CAV-1", links: [{ key: "CAV-77" }] }, { key: "CAV-77" }]);
    // The children JQL returns nothing, so the sub-task is only known from the parent's `subtasks` field;
    // reading its fields (`key in (...)`) then fails.
    const jira = {
      fetchIssueComments: inner.fetchIssueComments.bind(inner),
      searchByJql: async (jql: string, o: { fields: string[]; nextPageToken?: string; maxResults?: number }) => {
        if (jql.startsWith("parent in")) return { issues: [] };
        if (jql.startsWith("key in (CAV-5")) throw new Error("Jira search failed (503): simulated");
        return inner.searchByJql(jql, o);
      },
    };
    const t = (await resolveTrees(jira, ["CAV-1"])).trees.get("CAV-1")!;
    assert.ok(t.nodes.some((n) => n.key === "CAV-5"), "the sub-task is still listed");
    assert.ok(!t.nodes.some((n) => n.key === "CAV-77"), "its link could not be seen");
    assert.ok(t.errors.some((e) => /Could not read CAV-5/.test(e)), t.errors.join("|"));
  });
});

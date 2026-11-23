import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDeploymentRecord } from "./parse";
import { approxBytes, pickNewestPerPr } from "./pick";
import { loadFixture, RECORD_FIXTURES } from "./testkit";
import { normalizeRepo, prKey, refsIn } from "./util";
import type { ParsedRecord } from "./types";

function rec(o: { id: number; v?: number; repo?: string; pr?: number; key?: string; updated?: string; sup?: string }): ParsedRecord {
  const body = `DEPLOYMENT-RECORD v${o.v ?? 1} | ${o.key ?? "CAV-1"} | ${o.repo ?? "channelkart"}#${o.pr ?? 7} | 2026-11-19 10:00 | bot\nsupersedes: ${o.sup ?? "none"}`;
  const r = parseDeploymentRecord({ id: o.id, body, created: "2026-11-19T10:00:00.000+0000", updated: o.updated ?? "2026-11-19T10:00:00.000+0000" });
  assert.ok(r);
  return r;
}
const ids = (rs: ParsedRecord[]) => rs.map((r) => r.comment.id);

describe("repo and PR identity", () => {
  it("normalises owner prefixes, urls and case", () => {
    for (const s of ["channelkart-flutter", "salescode-ai/channelkart-flutter", "https://github.com/salescode-ai/channelkart-flutter.git", "SalesCode-AI/Channelkart-Flutter"]) {
      assert.equal(normalizeRepo(s), "channelkart-flutter");
    }
    assert.equal(prKey("salescode-ai/channelkart-flutter", 49), "channelkart-flutter#49");
    assert.deepEqual(refsIn("PR #12, Flutter #50 and kpi-dashboard#269 (#7)"), [
      { repo: "flutter", pr: 50 },
      { repo: "kpi-dashboard", pr: 269 },
    ]);
  });
});

describe("pickNewestPerPr", () => {
  it("v2 beats v1 for the same PR, in any input order", () => {
    const v1 = rec({ id: 100, v: 1 });
    const v2 = rec({ id: 90, v: 2, updated: "2026-11-18T10:00:00.000+0000" });
    assert.deepEqual(ids(pickNewestPerPr([v1, v2])), ["90"]);
    assert.deepEqual(ids(pickNewestPerPr([v2, v1])), ["90"]);
  });

  it("an edited comment (later updated) beats a newer-numbered one of the same version", () => {
    const edited = rec({ id: 81399, updated: "2026-11-19T12:00:00.000+0000" });
    const reposted = rec({ id: 81500, updated: "2026-11-19T11:00:00.000+0000" });
    assert.deepEqual(ids(pickNewestPerPr([reposted, edited])), ["81399"]);
  });

  it("a newer record that names an older one in `supersedes` removes it", () => {
    const old = rec({ id: 81399, updated: "2026-11-19T10:00:00.000+0000" });
    const repl = rec({ id: 81500, sup: "81399", updated: "2026-11-19T11:00:00.000+0000" });
    assert.deepEqual(ids(pickNewestPerPr([old, repl])), ["81500"]);
  });

  it("an OLDER record naming a newer one never discards it (supersedes only removes strictly older)", () => {
    const newer = rec({ id: 81399, updated: "2026-11-19T15:00:00.000+0000" }); // edited late
    const older = rec({ id: 81500, sup: "81399", updated: "2026-11-19T11:00:00.000+0000" });
    assert.deepEqual(ids(pickNewestPerPr([newer, older])), ["81399"]);
    const v2 = rec({ id: 1, v: 2 });
    const v1 = rec({ id: 2, v: 1, sup: "v2" });
    assert.deepEqual(ids(pickNewestPerPr([v2, v1])), ["1"]);
  });

  it("supersedes by version drops the lower version even if it is newer in time", () => {
    const v1 = rec({ id: 5, v: 1, updated: "2026-11-20T10:00:00.000+0000" });
    const v2 = rec({ id: 4, v: 2, sup: "v1", updated: "2026-11-19T10:00:00.000+0000" });
    assert.deepEqual(ids(pickNewestPerPr([v1, v2])), ["4"]);
  });

  it("a supersedes cycle falls back to plain ordering", () => {
    const a = rec({ id: 1, sup: "2", updated: "2026-11-19T10:00:00.000+0000" });
    const b = rec({ id: 2, sup: "1", updated: "2026-11-19T11:00:00.000+0000" }); // commentId needs 4+ digits: no effect
    assert.deepEqual(ids(pickNewestPerPr([a, b])), ["2"]);
    const c = rec({ id: 1001, sup: "1002", updated: "2026-11-19T10:00:00.000+0000" });
    const d = rec({ id: 1002, sup: "1001", updated: "2026-11-19T11:00:00.000+0000" });
    assert.deepEqual(ids(pickNewestPerPr([c, d])), ["1002"]);
  });

  it("groups owner-prefixed and bare repo names, keeps different PRs, and optionally splits per Jira key", () => {
    const a = rec({ id: 1, repo: "salescode-ai/channelkart-flutter", pr: 49 });
    const b = rec({ id: 2, repo: "channelkart-flutter", pr: 49, v: 2 });
    const c = rec({ id: 3, repo: "channelkart-flutter", pr: 50 });
    assert.deepEqual(ids(pickNewestPerPr([a, b, c])).sort(), ["2", "3"]);
    const other = rec({ id: 4, repo: "channelkart-flutter", pr: 49, key: "CAV-2" });
    assert.equal(pickNewestPerPr([a, other]).length, 1);
    assert.equal(pickNewestPerPr([a, other], { perKey: true }).length, 2);
  });

  it("the 7 real records are one per PR (nothing collapses wrongly)", () => {
    const all = RECORD_FIXTURES.map((n) => parseDeploymentRecord(loadFixture(n))!);
    assert.equal(pickNewestPerPr(all).length, 7);
    assert.equal(pickNewestPerPr([...all, ...all]).length, 7);
  });
});

describe("approxBytes", () => {
  it("is positive, deterministic and grows with content", () => {
    const small = rec({ id: 1 });
    const big = parseDeploymentRecord(loadFixture("CAV-7346-81399"))!;
    assert.ok(approxBytes(small) > 100);
    assert.equal(approxBytes(big), approxBytes(big));
    assert.ok(approxBytes(big) > approxBytes(small) * 3);
  });
});

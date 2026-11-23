import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsedFixture } from "./fake-jira";
import type { ParsedRecord } from "./record";
import type { IssueRecords } from "./records";
import { computeReadiness } from "./readiness";
import type { RootTree, TreeNode } from "./tree";

const N = (key: string, kind: TreeNode["kind"], parentKey: string | null = null): TreeNode => ({ key, kind, parentKey, issueType: "", statusName: "", summary: "" });
const tree = (nodes: TreeNode[], over: Partial<RootTree> = {}): RootTree => ({ root: nodes[0].key, nodes, truncated: false, linkedTruncated: false, warnings: [], errors: [], ...over });
const issue = (key: string, records: ParsedRecord[], over: Partial<IssueRecords> = {}): [string, IssueRecords] => [
  key, { issueKey: key, records, commentsSeen: records.length, exhausted: true, capped: false, ...over },
];
const T = (key: string) => tree([N(key, "root")]);

const R1184 = () => parsedFixture("CAV-7346-81399"); // channelkart#1184, BLOCKED
const R267 = () => parsedFixture("CAV-7346-81400"); // kpi-dashboard#267, PARTIAL
const R49 = () => parsedFixture("CAV-7346-81421"); // channelkart-flutter#49, BLOCKED
const R1185 = () => parsedFixture("CAV-7304-81422"); // channelkart#1185, replaces #1160 (closed), head moved
const R332 = () => parsedFixture("CAV-7304-81423"); // salescode-auth-service#332
const R269 = () => parsedFixture("CAV-7304-81424"); // kpi-dashboard#269
const R50 = () => parsedFixture("CAV-7304-81425"); // channelkart-flutter#50
const UNION = () => parsedFixture("CAV-7280-81643"); // CAV-7280, covers slake-custom-reports#931 + slake-reporting-config#1313, HELD / PARTIAL

const withKey = (r: ParsedRecord, key: string) => {
  r.marker = { ...r.marker, key };
  return r;
};
const unionOf = (covers: Array<{ repo: string; pr: number; sha?: string }>, over: Partial<ParsedRecord["marker"]> = {}, id = "81643") => {
  const r = structuredClone(UNION());
  r.comment = { ...r.comment, id };
  r.facts = { ...r.facts, covers: covers.map((c) => ({ ...c, state: "merged" as const })) };
  r.marker = { ...r.marker, ...over };
  return r;
};

describe("legacy records, one per PR (CAV-7346, CAV-7304)", () => {
  it("CAV-7346 with its 3 per-PR records is ready; BLOCKED/PARTIAL status and unknowns are warnings only", () => {
    const r = computeReadiness({ root: "CAV-7346", tree: T("CAV-7346"), recordsByIssue: new Map([issue("CAV-7346", [R1184(), R267(), R49()])]) });
    assert.equal(r.readiness, "ready", JSON.stringify(r.blockers));
    assert.deepEqual([r.reviews, r.prsCovered, r.records.length], [3, 3, 3]);
    const status = r.warnings.filter((w) => w.code === "record_status");
    assert.equal(status.length, 3, "BLOCKED, PARTIAL, BLOCKED");
    assert.match(status.map((w) => w.message).join("|"), /channelkart#1184: BLOCKED for release \(4 open Should-fix/);
    assert.ok(r.warnings.some((w) => w.code === "open_unknowns" && /^15 open/.test(w.message)), "7+4+4 unknowns");
    assert.ok(r.records.every((p) => p.scope === "pr"));
  });

  it("CAV-7304 with its 4 per-PR records is ready (#1160 was replaced); a sibling that has no record of its own blocks", () => {
    const all = computeReadiness({ root: "CAV-7304", tree: T("CAV-7304"), recordsByIssue: new Map([issue("CAV-7304", [R1185(), R332(), R269(), R50()])]) });
    assert.equal(all.readiness, "ready", JSON.stringify(all.blockers));
    const missing = computeReadiness({ root: "CAV-7304", tree: T("CAV-7304"), recordsByIssue: new Map([issue("CAV-7304", [R1185(), R332(), R50()])]) });
    assert.equal(missing.readiness, "blocked");
    assert.deepEqual(missing.blockers.map((b) => [b.code, b.ref]), [["sibling_no_record", "kpi-dashboard#269"]]);
    assert.match(missing.blockers[0].message, /^kpi-dashboard#269 is named as a sibling in the record of CAV-7304 but has no record of its own$/);
  });

  it("a sibling the record says it replaces (closed) is ignored", () => {
    const rec = R1185();
    rec.facts = { ...rec.facts, siblings: [{ repo: "channelkart", pr: 1160 }], replaces: [{ pr: 1160, state: "closed" }] };
    assert.equal(computeReadiness({ root: "CAV-7304", tree: T("CAV-7304"), recordsByIssue: new Map([issue("CAV-7304", [rec])]) }).readiness, "ready");
  });

  it("short sibling names are reconciled only by the alias table, only to a repo the records name; no prefix guessing", () => {
    const core = R1185();
    core.facts = { ...core.facts, siblings: [{ repo: "flutter", pr: 50 }] };
    const blocked = computeReadiness({ root: "CAV-7304", tree: T("CAV-7304"), recordsByIssue: new Map([issue("CAV-7304", [core])]) });
    assert.deepEqual(blocked.blockers.map((b) => b.ref), ["flutter#50"], "no record names channelkart-flutter: unresolved, written name");
    const ok = computeReadiness({ root: "CAV-7304", tree: T("CAV-7304"), recordsByIssue: new Map([issue("CAV-7304", [core, R50(), R332(), R269()])]) });
    assert.equal(ok.readiness, "ready", JSON.stringify(ok.blockers));

    const rec = R1185();
    rec.facts = { ...rec.facts, siblings: [{ repo: "channelkart", pr: 49 }] }; // `channelkart #49` is not channelkart-flutter#49
    const flutter49 = withKey(R49(), "CAV-7304");
    flutter49.facts = { ...flutter49.facts, siblings: [] };
    const r = computeReadiness({ root: "CAV-7304", tree: T("CAV-7304"), recordsByIssue: new Map([issue("CAV-7304", [rec, flutter49])]) });
    assert.deepEqual(r.blockers.map((b) => b.ref), ["channelkart#49"]);
  });

  it("a record whose marker says `flutter#50` and one that says `channelkart-flutter#50` are one PR", () => {
    const short = R50();
    short.marker = { ...short.marker, repo: "flutter" };
    const full = R50();
    full.comment = { ...full.comment, id: "99999999", updated: "2020-01-01T00:00:00.000+0000", created: "2020-01-01T00:00:00.000+0000" };
    const r = computeReadiness({ root: "CAV-7304", tree: T("CAV-7304"), recordsByIssue: new Map([issue("CAV-7304", [short, full, R269(), R1185(), R332()])]) });
    assert.equal(r.records.filter((x) => x.pr === 50).length, 1);
    assert.equal(r.records.find((x) => x.pr === 50)!.prKey, "channelkart-flutter#50");
    assert.equal(r.readiness, "ready", JSON.stringify(r.blockers));
  });
});

describe("one review comment per Jira (union record, the real CAV-7280 comment 81643)", () => {
  it("the real comment alone makes CAV-7280 ready; HELD / PARTIAL is a warning, the covers are listed per PR", () => {
    const r = computeReadiness({ root: "CAV-7280", tree: T("CAV-7280"), recordsByIssue: new Map([issue("CAV-7280", [UNION()])]) });
    assert.equal(r.readiness, "ready", JSON.stringify(r.blockers));
    assert.deepEqual([r.reviews, r.prsCovered], [1, 2]);
    assert.ok(r.warnings.some((w) => w.code === "record_status" && /HELD in the DEMO movement/.test(w.message)));
    assert.deepEqual(r.records.map((p) => [p.prKey, p.scope, p.commentId, p.headReviewed]).sort(), [
      ["slake-custom-reports#931", "union", "81643", "689b6d326c"],
      ["slake-reporting-config#1313", "union", "81643", "5c9b08cdf1"],
    ]);
    assert.equal(r.recordsUsed.length, 1, "the comment is kept ONCE");
  });

  it("no review comment at all is blocked: 'No review comment found on this Jira'", () => {
    const r = computeReadiness({ root: "CAV-7280", tree: T("CAV-7280"), recordsByIssue: new Map() });
    assert.equal(r.readiness, "blocked");
    assert.deepEqual(r.blockers.map((b) => [b.code, b.message]), [["no_record", "No review comment found on this Jira"]]);
  });

  it("the newest union supersedes an older one whatever the covers (older covered 3, newer covers 2)", () => {
    const old = unionOf([{ repo: "a", pr: 1 }, { repo: "b", pr: 2 }, { repo: "c", pr: 3 }], {}, "81000");
    const newer = UNION();
    newer.marker = { ...newer.marker, version: 2 };
    const r = computeReadiness({ root: "CAV-7280", tree: T("CAV-7280"), recordsByIssue: new Map([issue("CAV-7280", [old, newer])]) });
    assert.equal(r.readiness, "ready");
    assert.deepEqual([r.reviews, r.prsCovered], [1, 2]);
    assert.equal(r.recordsUsed[0].comment.id, "81643");
  });

  it("a union posted on a sub-Jira satisfies the root; a record found only on a LINKED issue does not (it is still listed)", () => {
    const sub = tree([N("CAV-7280", "root"), N("CAV-7281", "subtask", "CAV-7280")]);
    const onSub = computeReadiness({ root: "CAV-7280", tree: sub, recordsByIssue: new Map([issue("CAV-7281", [UNION()])]) });
    assert.equal(onSub.readiness, "ready", JSON.stringify(onSub.blockers));
    assert.equal(onSub.records[0].issueKey, "CAV-7281");

    const linked = tree([N("CAV-7280", "root"), N("CAV-9", "linked", "CAV-7280")]);
    const onLinked = computeReadiness({ root: "CAV-7280", tree: linked, recordsByIssue: new Map([issue("CAV-9", [UNION()])]) });
    assert.deepEqual(onLinked.blockers.map((b) => b.code), ["no_record"]);
    assert.equal(onLinked.records.length, 2, "linked issues add records");
  });

  it("a legacy per-PR record of a PR the newest union covers is dropped; one the union does not cover stays", () => {
    const covered = withKey(R1184(), "CAV-7280");
    covered.marker = { ...covered.marker, repo: "slake-reporting-config", pr: 1313 };
    covered.facts = { ...covered.facts, siblings: [] };
    const other = withKey(R267(), "CAV-7280");
    other.facts = { ...other.facts, siblings: [] };
    const r = computeReadiness({ root: "CAV-7280", tree: T("CAV-7280"), recordsByIssue: new Map([issue("CAV-7280", [UNION(), covered, other])]) });
    assert.equal(r.readiness, "ready");
    assert.deepEqual(r.recordsUsed.map((x) => x.comment.id).sort(), ["81400", "81643"]);
  });

  it("a record for another ticket does not count: ignored with a warning (so the Jira is blocked)", () => {
    const foreign = withKey(UNION(), "CAV-777");
    const r = computeReadiness({ root: "CAV-7280", tree: T("CAV-7280"), recordsByIssue: new Map([issue("CAV-7280", [foreign])]) });
    assert.deepEqual(r.blockers.map((b) => b.code), ["no_record"]);
    assert.ok(r.warnings.some((w) => w.code === "record_wrong_ticket" && /union of 2 merged PRs/.test(w.message)));
  });
});

describe("fail closed on partial data", () => {
  const rec = () => issue("CAV-7280", [UNION()]);

  it("an unreadable or cut tree blocks; only linked issues cut is a warning", () => {
    const bad = computeReadiness({ root: "CAV-7280", tree: tree([N("CAV-7280", "root")], { errors: ["Could not read the children of CAV-7280: 503"] }), recordsByIssue: new Map([rec()]) });
    assert.deepEqual(bad.blockers.map((b) => b.code), ["tree_unreadable"]);
    const cut = computeReadiness({ root: "CAV-7280", tree: tree([N("CAV-7280", "root")], { truncated: true, warnings: ["tree capped at 60 Jiras"] }), recordsByIssue: new Map([rec()]) });
    assert.deepEqual(cut.blockers.map((b) => b.code), ["tree_incomplete"]);
    assert.match(cut.blockers[0].message, /capped at 60/);
    const linkedCut = computeReadiness({ root: "CAV-7280", tree: tree([N("CAV-7280", "root")], { linkedTruncated: true }), recordsByIssue: new Map([rec()]) });
    assert.equal(linkedCut.readiness, "ready");
    assert.ok(linkedCut.warnings.some((w) => w.code === "linked_truncated"));
  });

  it("comments that could not be read, or only partly (200-comment cap), are said; with no record found they block", () => {
    const failed = computeReadiness({ root: "CAV-7280", tree: T("CAV-7280"), recordsByIssue: new Map([issue("CAV-7280", [], { error: "500", exhausted: false })]) });
    assert.match(failed.blockers[0].message, /some Jira comments could not be read/);
    assert.ok(failed.warnings.some((w) => w.code === "comments_unreadable"));
    const capped = computeReadiness({ root: "CAV-7280", tree: T("CAV-7280"), recordsByIssue: new Map([issue("CAV-7280", [], { capped: true, exhausted: false, commentsSeen: 200 })]) });
    assert.ok(capped.warnings.some((w) => w.code === "records_capped"));
    assert.match(capped.blockers[0].message, /only the newest comments were read/);
  });
});

describe("stale heads (optional, never blocks)", () => {
  const rec = () => new Map([issue("CAV-7280", [UNION()])]);

  it("warns for a covered PR whose head moved since the review; same head is silent", () => {
    const heads = new Map([["slake-custom-reports#931", "689b6d326c0000000000000000000000000000ff"], ["slake-reporting-config#1313", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]]);
    const r = computeReadiness({ root: "CAV-7280", tree: T("CAV-7280"), recordsByIssue: rec(), heads });
    assert.equal(r.readiness, "ready");
    const stale = r.warnings.filter((w) => w.code === "stale_record");
    assert.deepEqual(stale.map((w) => w.message), ["PR slake-reporting-config#1313 has new commits since the review: reviewed 5c9b08cdf1, now aaaaaaaaaa"]);
  });

  it("an unreadable head gives one aggregated warning; a per-PR record uses the head it reviewed", () => {
    const r = computeReadiness({ root: "CAV-7280", tree: T("CAV-7280"), recordsByIssue: rec(), heads: new Map([["slake-custom-reports#931", "unknown"]]) });
    assert.match(r.warnings.find((w) => w.code === "heads_unknown")!.message, /2 PRs/);
    const legacy = computeReadiness({ root: "CAV-7304", tree: T("CAV-7304"), recordsByIssue: new Map([issue("CAV-7304", [R1185(), R332(), R269(), R50()])]), heads: new Map([["channelkart#1185", "e2ad816ab0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]]) });
    assert.match(legacy.warnings.find((w) => w.code === "stale_record")!.message, /^PR channelkart#1185 has new commits since the review: reviewed f249c2be9c, now e2ad816ab0$/);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockerKind,
  blockerKinds,
  compareKeys,
  jirasCopyText,
  notCoveredPrs,
  plainWording,
  RECORD_HELP,
  todoLines,
  truncate,
  warningParts,
  warningRows,
  whyText,
  whyTitle,
  WHY_MAX,
} from "./jira-notes";

const note = (code: string, message: string) => ({ code, message });
const NO_COMMENT = note("no_record", "No review comment found on this Jira");
const sibling = (pr: string, owner = "CAV-7280") => note("sibling_no_record", `${pr} is named as a sibling in the record of ${owner} but has no record of its own`);
const item = (over: Record<string, unknown> = {}) => ({ key: "CAV-7280", readiness: "blocked" as const, blockers: [NO_COMMENT], override: null, recordCount: 0, reviews: 0, prs: { covered: 0 }, ...over });

describe("the CAV-7280 example: no review comment vs the union comment", () => {
  it("no comment on the Jira: 'Review not posted yet', and the to-do names the Jira once", () => {
    assert.equal(whyText(item()), "Review not posted yet");
    const t = todoLines([NO_COMMENT], "CAV-7280");
    assert.equal(t.length, 1);
    assert.equal(t[0].text, "The review comment has not been posted on CAV-7280. Ask the reviewer to post one (the Jira comment with the DEPLOYMENT-RECORD marker), or an admin can override with a reason.");
  });
  it("with the union comment (1 comment covering 2 PRs) the row is ready: '1 review comment · 2 PRs'; the HELD warning reads as a Where / Warning", () => {
    assert.equal(whyText(item({ readiness: "ready", blockers: [], recordCount: 1, reviews: 1, prs: { covered: 2 } })), "1 review comment · 2 PRs");
    const w = warningParts(note("record_status", "CAV-7280 (demo): HELD in the DEMO movement"));
    assert.deepEqual(w, { where: "CAV-7280 (demo)", text: "HELD in the DEMO movement" });
  });
});

describe("the row's why, by code", () => {
  it("no_record, and the legacy pr_no_record rows still stored, are 'Review not posted yet' (no PR counts)", () => {
    assert.equal(whyText(item({ blockers: [note("pr_no_record", "lite#5 (open, CAV-7280) has no deployment record")] })), "Review not posted yet");
    assert.equal(blockerKind("pr_no_record"), "no_comment");
    assert.equal(blockerKind("no_record"), "no_comment");
  });
  it("sibling_no_record: 'Partly reviewed: repo#9 not covered' (+N more)", () => {
    assert.equal(whyText(item({ blockers: [sibling("bundle#9")] })), "Partly reviewed: bundle#9 not covered");
    assert.equal(whyText(item({ blockers: [sibling("bundle#9"), sibling("lite#2"), sibling("lite#3")] })), "Partly reviewed: bundle#9 not covered (+2 more)");
    assert.deepEqual(notCoveredPrs([sibling("bundle#9"), sibling("bundle#9"), NO_COMMENT]).map((p) => [p.repo, p.number]), [["bundle", 9]]);
  });
  it("read problems keep their words; several kinds add '+K more problems'", () => {
    const only = (code: string, message = "x") => whyText(item({ blockers: [note(code, message)] }));
    assert.equal(only("tree_unreadable", "Jira 500"), "Jira could not be read");
    assert.equal(only("tree_incomplete", "Jira tree incomplete: x"), "Too many sub-Jiras to check");
    assert.equal(whyText(item({ blockers: [NO_COMMENT, note("tree_unreadable", "x")] })), "Review not posted yet · +1 more problem");
    assert.equal(whyText(item({ blockers: [NO_COMMENT, note("tree_unreadable", "x"), note("tree_incomplete", "y")] })), "Review not posted yet · +2 more problems");
  });
  it("an unknown blocker is shown as the server wrote it, in plain wording, cut", () => {
    assert.equal(whyText(item({ blockers: [note("brand_new", "A deployment record problem nobody has heard of before, described at some length")] })), truncate("A review comment problem nobody has heard of before, described at some length", WHY_MAX));
    assert.ok(whyText(item({ blockers: [note("brand_new", "x".repeat(300))] })).length <= WHY_MAX);
    assert.equal(whyText(item({ blockers: [] })), "Blocked");
  });
  it("overridden: who and why, cut; ready: the review comments and the PRs they cover", () => {
    assert.equal(whyText(item({ readiness: "override", override: { by: "Admin A", reason: "agreed with lead" } })), "Overridden by Admin A: agreed with lead");
    assert.ok(whyText(item({ readiness: "override", override: { by: "Admin A", reason: "r".repeat(200) } })).length <= WHY_MAX);
    assert.equal(whyTitle(item({ readiness: "override", override: { by: "Admin A", reason: "r".repeat(200) } })).length > WHY_MAX, true, "the tooltip has it all");
    const ready = (reviews: number, covered: number) => whyText(item({ readiness: "ready", blockers: [], recordCount: reviews, reviews, prs: { covered } }));
    assert.equal(ready(1, 2), "1 review comment · 2 PRs");
    assert.equal(ready(1, 1), "1 review comment · 1 PR");
    assert.equal(ready(2, 5), "2 review comments · 5 PRs");
    assert.equal(ready(1, 0), "1 review comment");
    assert.equal(ready(0, 0), "No PR to move");
  });
  it("the tooltip lists every blocker, in plain wording", () => {
    const t = whyTitle(item({ blockers: [NO_COMMENT, sibling("a#1")] }));
    assert.equal(t.split("\n").length, 2);
    assert.ok(!/deployment/i.test(t));
  });
});

describe("what to do, per kind", () => {
  it("one line per kind present, in a stable order", () => {
    assert.deepEqual(blockerKinds([note("tree_unreadable", ""), note("sibling_no_record", ""), note("no_record", ""), note("pr_no_record", "")]), ["no_comment", "not_covered", "unreadable"]);
    const t = todoLines([note("tree_incomplete", ""), note("tree_unreadable", ""), sibling("a#1")], "CAV-1");
    assert.deepEqual(t.map((x) => x.kind), ["not_covered", "unreadable", "incomplete"]);
    assert.match(t[0].text, /names PRs that no review comment covers\. Ask the reviewer to post the review comment that covers them/);
    assert.match(t[1].text, /Press Refresh/);
    assert.match(t[2].text, /Split the delivery/);
    assert.deepEqual(todoLines([], "CAV-1"), []);
  });
});

describe("warnings: what and where", () => {
  it("stale head: readable, with the PR as the where", () => {
    assert.deepEqual(warningParts(note("stale_record", "PR channelkart#9 has new commits since the review: reviewed abc1234567, now def7654321")), {
      where: "channelkart#9",
      text: "New commits since the review on channelkart#9: reviewed abc1234567, now def7654321",
    });
  });
  it("splits a leading PR or Jira off as 'where'; the rest in plain wording", () => {
    assert.deepEqual(warningParts(note("record_parse", "CAV-5: one table had no header")), { where: "CAV-5", text: "one table had no header" });
    assert.equal(warningParts(note("linked_pr_no_record", "CAV-9 (linked CAV-7280) has no deployment record; linked issues do not block")).where, "CAV-9");
    assert.match(warningParts(note("linked_pr_no_record", "CAV-9 (linked CAV-7280) has no deployment record; linked issues do not block")).text, /has no review comment \(linked issues do not block\)/);
    assert.equal(warningParts(note("comments_unreadable", "Comments of CAV-7 could not be read fully: x")).where, "CAV-7");
    assert.deepEqual(warningParts(note("heads_unknown", "Current head not readable for 2 PRs; stale check skipped for them")), { where: null, text: "Current head not readable for 2 PRs; stale check skipped for them" });
    assert.deepEqual(warningParts(note("open_unknowns", '3 open "unknown, owner to confirm" items across 2 records')), { where: null, text: '3 open "unknown, owner to confirm" items across 2 records' });
  });
  it("shows five, 'Show all' for the rest", () => {
    const rows = Array.from({ length: 8 }, (_, i) => i);
    assert.deepEqual(warningRows(rows, false), { shown: [0, 1, 2, 3, 4], hidden: 3 });
    assert.deepEqual(warningRows(rows, true), { shown: rows, hidden: 0 });
    assert.deepEqual(warningRows([1, 2], false), { shown: [1, 2], hidden: 0 });
  });
});

describe("wording", () => {
  it("'deployment record' becomes 'review comment'; the help says it is one comment per Jira, read from the comments only", () => {
    assert.equal(plainWording("X has no deployment record"), "X has no review comment");
    assert.equal(plainWording("Deployment records are read"), "Review comments are read");
    assert.match(RECORD_HELP, /^Each Jira carries one review comment: the Jira comment, posted by the review agent when you ask for it, that lists every merged PR of the Jira/);
    assert.match(RECORD_HELP, /never from the PRs themselves\. A Jira can move only when it has one\.$/);
    assert.ok(!/nightly|synced PR data/i.test(RECORD_HELP), "nothing about the PR table any more");
    assert.equal(truncate("  a   b  ", 10), "a b");
    assert.equal(truncate("abcdefghij", 5), "abcd…");
  });
});

describe("copying the Jiras", () => {
  const j = (key: string, summary: string, readiness: "ready" | "blocked" | "override", included: boolean) => ({ key, summary, readiness, included });
  const movement = [j("CAV-7346", "Partner banner", "ready", true), j("CAV-7347", "Loading sheet filter", "ready", false), j("CAV-7304", "Account lock", "blocked", false)];
  const base = "https://applicate.atlassian.net";
  it("selected: only the ticked ones, a heading with the count, a link per line, no marker", () => {
    assert.equal(
      jirasCopyText({ environment: "prod", deliveryName: "Release 19 Nov", items: movement, jiraBaseUrl: base, variant: "selected" }),
      ["Jiras for PROD movement: Release 19 Nov (1)", "- CAV-7346: Partner banner https://applicate.atlassian.net/browse/CAV-7346"].join("\n")
    );
  });
  it("all: every Jira, sorted naturally, each with its marker (blocked / ready / overridden / not selected)", () => {
    const text = jirasCopyText({ environment: "prod", deliveryName: "Release 19 Nov", items: [...movement, j("CAV-1", "Overridden one", "override", true)], jiraBaseUrl: base, variant: "all" });
    assert.deepEqual(text.split("\n"), [
      "Jiras for PROD movement: Release 19 Nov (4)",
      "- CAV-1: Overridden one https://applicate.atlassian.net/browse/CAV-1 [overridden]",
      "- CAV-7304: Account lock https://applicate.atlassian.net/browse/CAV-7304 [blocked]",
      "- CAV-7346: Partner banner https://applicate.atlassian.net/browse/CAV-7346 [ready]",
      "- CAV-7347: Loading sheet filter https://applicate.atlassian.net/browse/CAV-7347 [not selected]",
    ]);
  });
  it("natural order: CAV-9 before CAV-10; other prefixes sorted by prefix", () => {
    assert.ok(compareKeys("CAV-9", "CAV-10") < 0);
    assert.ok(compareKeys("CAV-100", "CAV-20") > 0);
    assert.ok(compareKeys("ABC-5", "CAV-1") < 0);
    const lines = jirasCopyText({ environment: "uat", deliveryName: "D", items: [j("CAV-10", "b", "ready", true), j("CAV-9", "a", "ready", true), j("CAV-2", "c", "ready", true)], jiraBaseUrl: null, variant: "selected" }).split("\n");
    assert.deepEqual(lines.slice(1).map((l) => l.split(":")[0]), ["- CAV-2", "- CAV-9", "- CAV-10"]);
  });
  it("without a Jira base URL (or a junk one) the links are left out; summaries are one line and cut to 140", () => {
    const text = jirasCopyText({ environment: "demo", deliveryName: "D", items: [j("CAV-1", "line one\n\n  line   two\ttabbed", "ready", true), j("CAV-2", "x".repeat(300), "ready", true)], jiraBaseUrl: "javascript:alert(1)", variant: "selected" });
    const [head, a, b] = text.split("\n");
    assert.equal(head, "Jiras for DEMO movement: D (2)");
    assert.equal(a, "- CAV-1: line one line two tabbed");
    assert.ok(!text.includes("http") && !text.includes("javascript"));
    assert.equal(b.length, "- CAV-2: ".length + 140);
    assert.ok(b.endsWith("…"));
    assert.ok(!text.includes("<"), "plain text, no HTML");
  });
  it("a trailing slash on the base URL and an empty list are handled", () => {
    assert.equal(jirasCopyText({ environment: "prod", deliveryName: "D", items: [j("CAV-1", "s", "ready", true)], jiraBaseUrl: `${base}//`, variant: "selected" }).split("\n")[1], "- CAV-1: s https://applicate.atlassian.net/browse/CAV-1");
    assert.equal(jirasCopyText({ environment: "prod", deliveryName: "D", items: [], jiraBaseUrl: base, variant: "all" }), "Jiras for PROD movement: D (0)");
  });
});

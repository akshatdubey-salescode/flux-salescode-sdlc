import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemRow } from "./core";
import { parsedFixture } from "../fake-jira";
import type { ParsedRecord } from "../record";
import { pointerHash } from "./inputs";
import { decideItems, RECHECK_CODE, refsOf, warningsOf, withRecheckWarning, type FreshItem } from "./refresh";

const NOW = "2026-11-19T12:00:00.000Z";
const row = (o: Partial<ItemRow> = {}): ItemRow => ({
  issueId: "i1",
  key: "CAV-1",
  summary: "s",
  included: true,
  tickSet: false,
  readiness: "ready",
  overrideReason: null,
  overrideBy: null,
  overrideByName: null,
  overrideAt: null,
  result: "pending",
  resultComment: null,
  warnings: [],
  recordRefs: [{ repo: "channelkart", pr: 1, commentId: "9", version: 1, updated: "u", status: "READY" }],
  ...o,
});
const fresh = (o: Partial<FreshItem> = {}): FreshItem => ({ issueId: "i1", key: "CAV-1", summary: "s", readiness: "ready", warnings: [], records: [], degraded: false, ...o });

describe("decideItems: an outage never rewrites what is approved (B2)", () => {
  it("an EXISTING item that could not be re-read keeps readiness, tick and refs; only the re-check warning is added, once", () => {
    const ex = row({ warnings: [{ code: "open_unknowns", message: "2 open" }] });
    const d1 = decideItems([fresh({ readiness: "blocked", degraded: true, warnings: [{ code: "tree_unreadable", message: "Jira could not be read" }] })], [ex], NOW);
    assert.equal(d1.updates.length, 1);
    assert.deepEqual([d1.updates[0].readiness, d1.updates[0].included, d1.updates[0].recordRefs], ["ready", true, ex.recordRefs]);
    assert.deepEqual(d1.updates[0].warnings.map((w) => w.code), ["open_unknowns", RECHECK_CODE]);
    assert.equal(d1.updates[0].warnings[1].message, "Could not re-check since 19 Nov, 5:30 pm IST", "plain words, no raw ISO, no code");
    assert.equal(d1.updates[0].warnings[1].at, NOW);
    assert.deepEqual([d1.rows[0].readiness, d1.rows[0].included], ["ready", true]);
    assert.deepEqual(d1.events, { added: [], removed: [], readiness: [], overrideCleared: [] }, "no event, so no reset and no mail");
    // the next failing refresh keeps the ORIGINAL time: nothing to write
    const again = decideItems([fresh({ readiness: "blocked", degraded: true })], [row({ warnings: d1.updates[0].warnings })], "2026-11-19T13:00:00.000Z");
    assert.equal(again.updates.length, 0);
    // recovery: a healthy read drops the warning (and changes nothing else)
    const back = decideItems([fresh()], [row({ warnings: d1.updates[0].warnings })], NOW);
    assert.deepEqual(back.updates[0].warnings, []);
    assert.deepEqual(back.events.readiness, []);
  });

  it("an override and a tick survive an outage too; a NEW item with no history fails closed (blocked, not ticked)", () => {
    const ov = row({ readiness: "override", overrideReason: "ok", overrideBy: "a", overrideAt: new Date() });
    const d = decideItems([fresh({ readiness: "blocked", degraded: true })], [ov], NOW);
    assert.equal(d.rows[0].readiness, "override");
    const n = decideItems([fresh({ readiness: "blocked", degraded: true, warnings: [{ code: "tree_unreadable", message: "x" }] })], [], NOW);
    assert.deepEqual([n.inserts[0].readiness, n.inserts[0].included], ["blocked", false]);
  });

  it("the re-check warning respects the 20-warning cap", () => {
    const full = Array.from({ length: 20 }, (_, i) => ({ code: `c${i}`, message: "m" }));
    const w = withRecheckWarning(full, NOW);
    assert.equal(w.length, 20);
    assert.equal(w[19].code, RECHECK_CODE);
  });
});

describe("decideItems: the tick (S9)", () => {
  it("a new ready item is ticked, a new blocked one is not", () => {
    const d = decideItems([fresh(), fresh({ issueId: "i2", key: "CAV-2", readiness: "blocked" })], [], NOW);
    assert.deepEqual(d.inserts.map((w) => [w.issueId, w.included]), [["i1", true], ["i2", false]]);
  });

  it("blocked -> ready auto-ticks only while nobody has ticked or unticked it; an explicit choice is never overridden", () => {
    const blocked = (o: Partial<ItemRow>) => row({ readiness: "blocked", included: false, ...o });
    assert.equal(decideItems([fresh()], [blocked({ tickSet: false })], NOW).rows[0].included, true);
    assert.equal(decideItems([fresh()], [blocked({ tickSet: true })], NOW).rows[0].included, false, "the person unticked it: stays");
    // an item the person ticked stays ticked, and one they unticked stays unticked, through ready <-> blocked
    assert.equal(decideItems([fresh({ readiness: "blocked" })], [row({ tickSet: true, included: true })], NOW).rows[0].included, true);
    assert.equal(decideItems([fresh()], [row({ tickSet: true, included: false })], NOW).rows[0].included, false);
    // a ready item that is still ready keeps whatever it had, even untouched
    assert.equal(decideItems([fresh()], [row({ tickSet: false, included: false })], NOW).rows[0].included, false);
  });

  it("an override is dropped when the record becomes valid; an item that left the delivery is removed", () => {
    const ov = row({ readiness: "override", overrideReason: "ok", overrideBy: "a", overrideAt: new Date() });
    const d = decideItems([fresh()], [ov, row({ issueId: "gone", key: "CAV-9" })], NOW);
    assert.deepEqual([d.updates[0].clearOverride, d.updates[0].readiness], [true, "ready"]);
    assert.deepEqual(d.removed, ["gone"]);
    assert.deepEqual(d.events.removed, ["CAV-9"]);
  });
});

describe("warnings are generic about failures (S4)", () => {
  it("never carry a Jira body, a database message or a URL; every message is < 200 chars and there are at most 20", () => {
    const secret = "Failed query: select * from github_pull_requests params: AKIA-SECRET https://x.atlassian.net/rest/api?token=abc";
    const w = warningsOf({
      blockers: [
        { code: "tree_unreadable", ref: "CAV-1", message: `Could not read CAV-1: ${secret}` },
        { code: "tree_incomplete", ref: "CAV-1", message: `Jira tree incomplete: ${secret}` },
        { code: "no_record", ref: "CAV-1", message: "No review comment found on this Jira" },
      ],
      warnings: [{ code: "comments_unreadable", ref: "CAV-2", message: `Comments of CAV-2 could not be read fully: ${secret}` }, ...Array.from({ length: 30 }, () => ({ code: "open_unknowns" as const, ref: null, message: "x".repeat(300) }))],
    });
    assert.ok(w.length <= 20);
    assert.ok(w.every((x) => x.message.length < 200));
    assert.ok(!/AKIA|Failed query|atlassian|token|select \*/i.test(JSON.stringify(w)));
    assert.equal(w[0].message, "Jira could not be read");
    assert.match(w[2].message, /No review comment found on this Jira/);
  });
});

describe("record pointers (refsOf, pointerHash)", () => {
  const union = parsedFixture("CAV-7280-81643");

  it("a union comment is one pointer per covered PR sharing the comment id; a per-PR record is one pointer without a scope", () => {
    const refs = refsOf([union, parsedFixture("CAV-7346-81399")]);
    assert.deepEqual(refs.map((r) => [r.repo, r.pr, r.commentId, r.scope]), [
      ["slake-custom-reports", 931, "81643", "union"],
      ["slake-reporting-config", 1313, "81643", "union"],
      ["channelkart", 1184, "81399", undefined],
    ]);
    assert.equal(refsOf([{ ...union, facts: { ...union.facts, covers: Array.from({ length: 80 }, (_, i) => ({ repo: "r", pr: i + 1 })) } }]).length, 50, "cap 50");
  });

  it("the stored-inputs hash changes when the union comment is edited or replaced, and not otherwise", () => {
    const item = (r: ParsedRecord) => [{ issue: "i1", records: [r] }];
    const base = pointerHash(item(union));
    assert.equal(pointerHash(item(structuredClone(union))), base);
    assert.notEqual(pointerHash(item({ ...union, comment: { ...union.comment, updated: "2026-11-21T00:00:00.000+0000" } })), base);
    assert.notEqual(pointerHash(item({ ...union, comment: { ...union.comment, id: "81999" } })), base);
  });
});


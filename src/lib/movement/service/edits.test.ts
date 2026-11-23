import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fixtureComment, parsedFixture } from "../fake-jira";
import { blocksToMarkdown, bodyToBlocks, parseDeploymentRecord, type ParsedRecord } from "../record";
import { applyEdits, checkEdit, editsHash, MARKER_MESSAGE, previewOf, sameCovers, type CommentEdit } from "./edits";

const textOf = (name: string) => blocksToMarkdown(bodyToBlocks(fixtureComment(name).body).blocks);
const orig = parsedFixture("CAV-7346-81399"); // channelkart#1184 on CAV-7346
const edit = (text: string, over: Partial<CommentEdit> = {}): CommentEdit => ({ issueId: "i1", commentId: orig.comment.id, text, baseUpdated: orig.comment.updated, editedBy: "a@x.com", editedByName: "A", editedAt: new Date(), ...over });

describe("comment edits (pure)", () => {
  it("the Jira text, read back as markdown and parsed again, is the same record (so an edit starts from a faithful copy)", () => {
    const again = parseDeploymentRecord({ id: orig.comment.id, body: textOf("CAV-7346-81399"), created: orig.comment.created, updated: orig.comment.updated })!;
    assert.deepEqual(again.facts.deploy, orig.facts.deploy);
    assert.deepEqual(again.facts.configs, orig.facts.configs);
    assert.equal(again.status, orig.status);
  });

  it("checkEdit: the first line must stay, name the ticket, and cover the same PRs", () => {
    const t = textOf("CAV-7346-81399");
    const ok = checkEdit(t.replace(orig.facts.deploy![0].name, "Edited Service Name"), orig, "CAV-7346");
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.record.facts.deploy![0].name, "Edited Service Name");
    const gone = checkEdit(t.split("\n").slice(1).join("\n").padEnd(40, "."), orig, "CAV-7346");
    assert.deepEqual([gone.ok, !gone.ok && gone.message], [false, MARKER_MESSAGE]);
    assert.equal(checkEdit("just some words with no header line at all", orig, "CAV-7346").ok, false);
    const wrongTicket = checkEdit(t.replace("| CAV-7346 |", "| CAV-9999 |"), orig, "CAV-7346");
    assert.equal(wrongTicket.ok, false);
    const otherPr = checkEdit(t.replace("channelkart#1184", "channelkart#1185"), orig, "CAV-7346");
    assert.deepEqual([otherPr.ok, !otherPr.ok && /PRs/.test(otherPr.message)], [false, true]);
    assert.equal(sameCovers(orig, orig), true);
  });

  it("applyEdits replaces the record of that comment only, never changes its input, and ignores an edit whose comment is gone", () => {
    const other = parsedFixture("CAV-7346-81400");
    const records = new Map<string, ParsedRecord[]>([["i1", [orig, other]]]);
    const svc = orig.facts.deploy![0].name;
    const edited = textOf("CAV-7346-81399").replace(svc, "Edited Service Name");
    assert.notEqual(edited, textOf("CAV-7346-81399"), "the replacement really changed the text");
    const out = applyEdits(records, [edit(edited)]);
    assert.notStrictEqual(out.get("i1"), records.get("i1"));
    assert.equal(records.get("i1")![0], orig, "the cached input is untouched");
    assert.strictEqual(out.get("i1")![1], other, "the other comment is the same object");
    assert.equal(out.get("i1")![0].comment.id, orig.comment.id, "it keeps the Jira comment's identity");
    assert.notDeepEqual(out.get("i1")![0].facts, orig.facts);
    assert.strictEqual(applyEdits(records, []), records, "no edits: nothing is copied");
    assert.strictEqual(applyEdits(records, [edit(edited, { commentId: "999" })]).get("i1")![0], orig, "an orphan edit is ignored");
    assert.strictEqual(applyEdits(records, [edit(edited, { issueId: "other" })]).get("i1")![0], orig, "an edit of another Jira is ignored");
  });

  it("editsHash ignores order, is null for none and changes with any text", () => {
    assert.equal(editsHash([]), null);
    const a = { commentId: "1", text: "x" };
    const b = { commentId: "2", text: "y" };
    assert.equal(editsHash([a, b]), editsHash([b, a]));
    assert.notEqual(editsHash([a, b]), editsHash([a, { ...b, text: "z" }]));
  });

  it("previewOf gives small plain counts: covers, rows by state, unknowns, plain warnings", () => {
    const p = previewOf(orig);
    assert.equal(p.covers, 1);
    assert.equal(typeof p.unknowns, "number");
    assert.ok(Array.isArray(p.warnings) && p.warnings.every((w) => !/_/.test(w)));
    assert.ok(JSON.stringify(p).length < 2000);
  });
});

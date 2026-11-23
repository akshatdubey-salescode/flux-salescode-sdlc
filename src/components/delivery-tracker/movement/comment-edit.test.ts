/** The review-comment editor: its pure rules (what may be saved, badges, preview chips) and its states as server renders. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommentPreview, CommentsResponse, CommentView } from "./api-types";
import { canSave, commentBadges, commentTabLabel, effectiveText, isDirty, lengthProblem, MAX_EDIT_CHARS, MIN_EDIT_CHARS, previewChips, RESET_WARNING, SAVE_WARNING } from "./comment-edit";
import { CommentEditButton, CommentPane, EditorBody, PreviewBox } from "./comment-editor";
import type { ItemView } from "./api-types";

const ORIGINAL = "DEPLOYMENT-RECORD\nKey: CAV-7280\nStatus: READY\nWhat: loading reports honour the selected Loadout Number";
const comment = (over: Partial<CommentView> = {}): CommentView => ({
  commentId: "81643",
  scope: "union",
  covers: ["slake-custom-reports#931", "slake-reporting-config#1313"],
  version: 2,
  status: "READY",
  updated: "2026-11-19T06:00:00Z",
  original: ORIGINAL,
  originalTruncated: false,
  edited: null,
  editedBy: null,
  editedAt: null,
  stale: false,
  current: true,
  ...over,
});
const preview = (over: Partial<CommentPreview> = {}): CommentPreview => ({ status: "READY", covers: 2, rows: { done: 5, not_done: 2, unknown: 1 }, unknowns: 3, warnings: [], ...over });
const noop = () => {};
const tag = (html: string, testid: string): string => {
  const at = html.indexOf(`data-testid="${testid}"`);
  assert.ok(at >= 0, `no element with data-testid=${testid}`);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};
const isDisabled = (t: string) => /\sdisabled(=|\s|>)/.test(t);

describe("comment editor: pure rules", () => {
  it("the text to edit is the Flux edit, else the Jira text, else empty", () => {
    assert.equal(effectiveText(comment()), ORIGINAL);
    assert.equal(effectiveText(comment({ edited: "mine" })), "mine");
    assert.equal(effectiveText(comment({ original: null })), "");
    assert.equal(isDirty(ORIGINAL, comment()), false);
    assert.equal(isDirty(`${ORIGINAL}!`, comment()), true);
  });
  it("length: at least 20 characters (trimmed), at most 40000", () => {
    assert.match(lengthProblem("too short") ?? "", /at least 20/);
    assert.equal(lengthProblem("x".repeat(MIN_EDIT_CHARS)), null);
    assert.match(lengthProblem(`${"x".repeat(MAX_EDIT_CHARS)}y`) ?? "", /at most 40000/);
    assert.match(lengthProblem(`   ${"x".repeat(MIN_EDIT_CHARS - 1)}   `) ?? "", /at least 20/, "spaces do not count");
  });
  it("Save is allowed only for a changed text whose preview is OK; each refusal has its own reason", () => {
    const c = comment();
    const ok = { phase: "ok", preview: preview() } as const;
    assert.deepEqual(canSave(ORIGINAL, c, ok), { ok: false, reason: "Nothing changed yet" });
    assert.match(canSave("short", c, ok).reason ?? "", /too short/);
    assert.deepEqual(canSave(`${ORIGINAL}\nmore`, c, { phase: "pending" }), { ok: false, reason: "Checking the text…" });
    assert.deepEqual(canSave(`${ORIGINAL}\nmore`, c, { phase: "error", message: "No DEPLOYMENT-RECORD marker" }), { ok: false, reason: "No DEPLOYMENT-RECORD marker" });
    assert.deepEqual(canSave(`${ORIGINAL}\nmore`, c, ok), { ok: true, reason: null });
  });
  it("badges: edited (who, when), stale, not applied, original not available", () => {
    assert.deepEqual(commentBadges(comment(), true), []);
    const edited = commentBadges(comment({ edited: "t", editedBy: "Asha", editedAt: "2026-11-20T06:00:00Z" }), true);
    assert.equal(edited.length, 1);
    assert.match(edited[0].text, /^Edited in Flux by Asha on /);
    assert.equal(commentBadges(comment({ edited: "t", stale: true }), true).some((b) => b.testId === "movement-comment-badge-stale" && /Jira comment changed after your edit/.test(b.text)), true);
    assert.equal(commentBadges(comment({ edited: "t", current: false }), true).some((b) => b.testId === "movement-comment-badge-notcurrent"), true);
    assert.equal(commentBadges(comment({ current: false }), true).some((b) => b.testId === "movement-comment-badge-notcurrent"), false, "only an edit can be 'not applied'");
    assert.equal(commentBadges(comment({ original: null }), true).some((b) => b.testId === "movement-comment-badge-nooriginal"), true);
    assert.equal(commentBadges(comment(), false).some((b) => b.testId === "movement-comment-badge-nooriginal"), true, "Jira could not be read");
  });
  it("preview chips: status, PRs covered, rows by state in a fixed order, open questions", () => {
    assert.deepEqual(previewChips(preview()).map((c) => c.label), ["READY", "covers 2 PRs", "5 done", "2 not done", "1 unknown", "3 open questions"]);
    assert.deepEqual(previewChips(preview({ status: null, covers: 1, rows: {}, unknowns: 1 })).map((c) => c.label), ["covers 1 PR", "1 open question"]);
    assert.equal(previewChips(preview({ status: "PARTIAL" }))[0].tone, "warn");
  });
  it("tab label: version, PRs, edited", () => {
    assert.equal(commentTabLabel(comment({ edited: "x" }), 0), "v2 · 2 PRs · edited");
    assert.equal(commentTabLabel(comment({ version: null, covers: ["a#1"] }), 1), "comment 2 · 1 PR");
  });
  it("both warnings are said plainly", () => {
    assert.match(SAVE_WARNING, /resets the sign-offs/);
    assert.match(RESET_WARNING, /Jira version is used again/);
  });
});

describe("comment editor: states", () => {
  const item = { key: "CAV-7280", issueId: "10001" } as ItemView;
  const pane = (c: CommentView, text: string, extra: Partial<Parameters<typeof CommentPane>[0]> = {}) =>
    renderToStaticMarkup(h(CommentPane, { url: "/api/x/items/10001/comment", c, jiraAvailable: true, more: 0, tabs: [c], at: 0, onTab: noop, text, onText: noop, dirtyAny: false, onClose: noop, onSaved: noop, ...extra }));

  it("the button: enabled for a manager; disabled with the reason for anyone else", () => {
    const on = renderToStaticMarkup(h(CommentEditButton, { base: "/api/x", item, edit: { allowed: true, reason: null }, onSaved: noop }));
    assert.ok(!isDisabled(tag(on, "movement-comment-edit-CAV-7280")));
    const off = renderToStaticMarkup(h(CommentEditButton, { base: "/api/x", item, edit: { allowed: false, reason: "Only a manager can edit" }, onSaved: noop }));
    assert.ok(isDisabled(tag(off, "movement-comment-edit-CAV-7280")) || /aria-disabled="true"/.test(tag(off, "movement-comment-edit-CAV-7280")));
    assert.ok(!off.includes("movement-comment-editor"), "closed until clicked");
  });
  it("untouched text: the textarea holds the Jira text (monospace, spellcheck off), Save is off with 'Nothing changed yet', no Reset", () => {
    const html = pane(comment(), ORIGINAL);
    const ta = tag(html, "movement-comment-text");
    assert.match(ta, /spellcheck="false"/i);
    assert.ok(html.includes("DEPLOYMENT-RECORD"), "the text is in the textarea");
    assert.ok(isDisabled(tag(html, "movement-comment-save")));
    assert.match(html.slice(html.indexOf('data-testid="movement-comment-save-reason"')), /Nothing changed yet/);
    assert.ok(!html.includes("movement-comment-reset"), "an unedited comment has nothing to reset");
    assert.ok(!html.includes("movement-comment-badge-"), "no badges");
  });
  it("a changed text starts as 'Checking the text…' (Save off, with that reason); too short says so without asking the server", () => {
    const html = pane(comment(), `${ORIGINAL}\nand more`);
    assert.match(html.slice(html.indexOf('data-testid="movement-comment-preview"')), /Checking the text…/);
    assert.ok(isDisabled(tag(html, "movement-comment-save")));
    assert.match(html, /data-testid="movement-comment-save-reason"[^>]*>Checking the text…/);
    const short = pane(comment(), "too short");
    assert.match(short.slice(short.indexOf('data-testid="movement-comment-preview-error"')), /too short \(at least 20 characters\)/);
    assert.ok(isDisabled(tag(short, "movement-comment-save")));
  });
  it("an edited comment: Edited badge with who, the Reset button, and the text is the edit", () => {
    const c = comment({ edited: "EDITED RECORD TEXT that is long enough", editedBy: "Asha", editedAt: "2026-11-20T06:00:00Z" });
    const html = pane(c, "EDITED RECORD TEXT that is long enough");
    assert.match(tag(html, "movement-comment-badge-edited"), /data-testid/);
    assert.match(html, /Edited in Flux by Asha on /);
    assert.ok(html.includes("movement-comment-reset"));
    assert.ok(!isDisabled(tag(html, "movement-comment-reset")));
  });
  it("stale badge: the Jira comment changed after the edit", () => {
    const c = comment({ edited: "EDITED RECORD TEXT that is long enough", stale: true, editedBy: "Asha", editedAt: null });
    const html = pane(c, "EDITED RECORD TEXT that is long enough");
    assert.match(html.slice(html.indexOf('data-testid="movement-comment-badge-stale"')), /Jira comment changed after your edit: review/);
  });
  it("an edit that is not applied, and a Jira that could not be read", () => {
    const html = pane(comment({ edited: "EDITED RECORD TEXT that is long enough", current: false, original: null }), "EDITED RECORD TEXT that is long enough", { jiraAvailable: false });
    assert.match(html, /This edit is not applied: a newer comment took its place/);
    assert.match(html, /Original not available/);
  });
  it("the preview box: pending, error (a role=alert sentence) and OK (chips + warnings)", () => {
    assert.match(renderToStaticMarkup(h(PreviewBox, { state: { phase: "pending" } })), /Checking the text…/);
    const err = renderToStaticMarkup(h(PreviewBox, { state: { phase: "error", message: "The text has no DEPLOYMENT-RECORD marker" } }));
    assert.match(err, /role="alert"[^>]*data-testid="movement-comment-preview-error"[^>]*>The text has no DEPLOYMENT-RECORD marker</);
    const ok = renderToStaticMarkup(h(PreviewBox, { state: { phase: "ok", preview: preview({ warnings: ["Row 11 has no answer"] }) } }));
    assert.match(ok, />READY</);
    assert.match(ok, />covers 2 PRs</);
    assert.match(ok, />3 open questions</);
    assert.match(ok, /<li>Row 11 has no answer<\/li>/);
    assert.ok(!ok.includes("movement-comment-preview-error"));
  });
  it("several comments: one tab each; the first is selected; the 'more' note", () => {
    const a = comment({ commentId: "1" });
    const b = comment({ commentId: "2", version: 3, edited: "x" });
    const data: CommentsResponse = { comments: [a, b], jiraAvailable: true, more: 2 };
    const html = renderToStaticMarkup(h(EditorBody, { url: "/u", data, onClose: noop, onSaved: noop }));
    assert.match(tag(html, "movement-comment-tab-0"), /aria-selected="true"/);
    assert.match(tag(html, "movement-comment-tab-1"), /aria-selected="false"/);
    assert.match(html, /v3 · 2 PRs · edited/);
    assert.match(html, /2 more comments of this Jira are not listed\./);
    const none = renderToStaticMarkup(h(EditorBody, { url: "/u", data: { comments: [], jiraAvailable: true, more: 0 }, onClose: noop, onSaved: noop }));
    assert.match(none, /no review comment to edit/);
  });
  it("the original is collapsed by default and read-only (a <pre>, never an input)", () => {
    const html = pane(comment(), ORIGINAL);
    assert.match(tag(html, "movement-comment-original-toggle"), /aria-expanded="false"/);
    assert.ok(!html.includes('data-testid="movement-comment-original"'));
  });
});

// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/ai-review/knowledge-sync.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHILDREN_SYNC_MS, VERSION_CHECK_MS, childrenSyncDue, movePage, needsFullRefresh, packPages, planNewChildren, versionCheckDue } from "./knowledge-sync";

const NOW = Date.parse("2026-11-19T10:00:00Z");
const ago = (ms: number) => new Date(NOW - ms);

test("a page confirmed within the last minute is not asked about again; never-read or older ones are", () => {
  assert.equal(versionCheckDue(ago(VERSION_CHECK_MS - 1000), NOW), false);
  assert.equal(versionCheckDue(ago(VERSION_CHECK_MS), NOW), true);
  assert.equal(versionCheckDue(ago(24 * 3600 * 1000), NOW), true);
  assert.equal(versionCheckDue(null, NOW), true);
});

test("text is fetched again only when the version moved or the last read failed", () => {
  assert.equal(needsFullRefresh({ savedVersion: 7, remoteVersion: 7, lastError: null }), false);
  assert.equal(needsFullRefresh({ savedVersion: 7, remoteVersion: 8, lastError: null }), true);
  assert.equal(needsFullRefresh({ savedVersion: 7, remoteVersion: 7, lastError: "Could not reach Confluence." }), true);
});

test("a section's sub-pages are listed again after five minutes, and on first sight", () => {
  assert.equal(childrenSyncDue(ago(CHILDREN_SYNC_MS - 1000), NOW), false);
  assert.equal(childrenSyncDue(ago(CHILDREN_SYNC_MS), NOW), true);
  assert.equal(childrenSyncDue(null, NOW), true);
});

test("only sub-pages not already in the library are new, in reading order", () => {
  const listed = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }];
  assert.deepEqual(planNewChildren(listed, new Set(["1", "3"]), 10), { toAdd: [{ id: "2" }, { id: "4" }], skipped: 0 });
  assert.deepEqual(planNewChildren(listed, new Set(["1", "2", "3", "4"]), 10), { toAdd: [], skipped: 0 });
});

test("when the library is nearly full, the earliest new pages are added and the rest counted as skipped", () => {
  const listed = [{ id: "1" }, { id: "2" }, { id: "3" }];
  assert.deepEqual(planNewChildren(listed, new Set(), 2), { toAdd: [{ id: "1" }, { id: "2" }], skipped: 1 });
  assert.deepEqual(planNewChildren(listed, new Set(), 0), { toAdd: [], skipped: 3 });
  assert.deepEqual(planNewChildren(listed, new Set(), -4), { toAdd: [], skipped: 3 });
});

test("pages are packed in priority order; one that does not fit whole is left out and later smaller ones still fit", () => {
  const pages = [{ n: "a", chars: 60 }, { n: "b", chars: 50 }, { n: "c", chars: 30 }, { n: "d", chars: 10 }];
  const { fit, omitted } = packPages(pages, 100);
  assert.deepEqual(fit.map((p) => p.n), ["a", "c", "d"]);
  assert.deepEqual(omitted.map((p) => p.n), ["b"]);
});

test("when everything fits nothing is omitted; empty pages are neither used nor counted as omitted", () => {
  const pages = [{ n: "a", chars: 40 }, { n: "empty", chars: 0 }, { n: "b", chars: 40 }];
  const { fit, omitted } = packPages(pages, 100);
  assert.deepEqual(fit.map((p) => p.n), ["a", "b"]);
  assert.deepEqual(omitted, []);
});

test("moving a page up or down swaps it with its neighbour and does nothing at the ends", () => {
  assert.deepEqual(movePage(["a", "b", "c"], 1, "up"), ["b", "a", "c"]);
  assert.deepEqual(movePage(["a", "b", "c"], 1, "down"), ["a", "c", "b"]);
  assert.deepEqual(movePage(["a", "b", "c"], 0, "up"), ["a", "b", "c"]);
  assert.deepEqual(movePage(["a", "b", "c"], 2, "down"), ["a", "b", "c"]);
  assert.deepEqual(movePage(["a", "b", "c"], 5, "up"), ["a", "b", "c"]);
});

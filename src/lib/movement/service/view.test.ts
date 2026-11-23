import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemRow } from "./core";
import { summarize, summarizeView } from "./service";

const msg = "x".repeat(199);
const row = (i: number): ItemRow => ({
  issueId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  key: `CAV-${1000 + i}`,
  summary: "s".repeat(200),
  included: true,
  tickSet: false,
  readiness: "blocked",
  overrideReason: null,
  overrideBy: null,
  overrideByName: null,
  overrideAt: null,
  result: "pending",
  resultComment: null,
  // 20 warnings: blockers first, the rest informational; every message at the 199-character limit
  warnings: Array.from({ length: 20 }, (_, k) => ({ code: k < 8 ? "pr_no_record" : "open_unknowns", message: msg })),
  recordRefs: Array.from({ length: 50 }, (_, k) => ({ repo: `channelkart-${k}`, pr: 1000 + k, commentId: String(900000 + k), version: 1, updated: "2026-11-19T10:00:00.000+0000", status: "READY" })),
});

describe("the view's per-Jira payload stays bounded", () => {
  it("200 Jiras x 20 warnings x 50 records: warnings are listed once (blockers / softWarnings), at most 5 record pointers, well under 1.2 MB", () => {
    const items = Array.from({ length: 200 }, (_, i) => summarizeView(row(i)));
    const bytes = Buffer.byteLength(JSON.stringify(items));
    assert.ok(bytes < 1_200_000, `view items are ${bytes} bytes`);
    for (const it of items) {
      assert.equal("warnings" in it, false, "the combined list is not repeated in the view");
      assert.equal(it.blockers.length + it.softWarnings.length, 12, "at most 12 notes, blockers first");
      assert.equal(it.blockers.length, 8);
      assert.equal(it.warningsMore, 8);
      assert.ok(it.records.length <= 5 && it.recordCount === 50);
      assert.ok(it.repos.length === 12 && it.reposMore === 38);
    }
    // the export still reads the combined list
    assert.equal(summarize(row(1)).warnings.length, 20);
    assert.equal(summarize(row(1)).records.length, 50);
  });
});

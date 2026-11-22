import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adfToBlocks, blocksToMarkdown, markdownToBlocks, MAX_DEPTH } from "./adf";
import { looksLikeRecord, parseDeploymentRecord } from "./parse";
import { loadFixture, NEGATIVE_FIXTURES, RECORD_FIXTURES } from "./testkit";

describe("adf structure reader", () => {
  it("keeps bold/code runs, tables with header, and the JSON code block of a real record", () => {
    const { blocks, truncated } = adfToBlocks(loadFixture("CAV-7346-81399").body);
    assert.equal(truncated, false);
    // First paragraph: marker line and supersedes line in one text node, newline kept.
    const first = blocks[0];
    assert.equal(first.kind, "paragraph");
    assert.match(first.kind === "paragraph" ? first.runs[0].text : "", /^DEPLOYMENT-RECORD v1 \|.*\nsupersedes: none$/);
    // Section headings are bold runs.
    const s2 = blocks[2];
    assert.ok(s2.kind === "paragraph" && s2.runs[0].bold && s2.runs[0].text === "2 Branches and owners:");
    // Inline code run flagged.
    assert.ok(s2.kind === "paragraph" && s2.runs.some((r) => r.code && r.text === "CAV-7346-partner-banner-pr"));
    const table = blocks.find((b) => b.kind === "table");
    assert.ok(table && table.kind === "table" && table.header);
    assert.deepEqual(table.rows[0], ["Key", "Store", "Default when absent", "Demo", "UAT", "Prod"]);
    assert.equal(table.rows.length, 7);
    assert.equal(table.rows[1][0], "partner.banner.enabled"); // code mark stripped inside cells
    const last = blocks[blocks.length - 1];
    assert.ok(last.kind === "code" && last.text.startsWith('{"marker"'));
  });

  it("caps recursion depth at 40 and never throws on absurdly nested input", () => {
    let node: Record<string, unknown> = { type: "text", text: "deep" };
    for (let i = 0; i < 5000; i++) node = { type: "blockquote", content: [node] };
    const r = adfToBlocks({ type: "doc", content: [node] });
    assert.equal(r.truncated, true);
    // The text sits below depth 40, so the walker drops it; only the head-text fallback remains.
    assert.ok(r.blocks.length <= 1);
    let ok: Record<string, unknown> = { type: "paragraph", content: [{ type: "text", text: "fine" }] };
    for (let i = 0; i < MAX_DEPTH - 5; i++) ok = { type: "blockquote", content: [ok] };
    assert.equal(adfToBlocks({ type: "doc", content: [ok] }).blocks.length, 1);
  });

  it("markdown text read back equals the ADF blocks (all 7 fixtures)", () => {
    for (const name of RECORD_FIXTURES) {
      const a = adfToBlocks(loadFixture(name).body).blocks;
      const md = blocksToMarkdown(a);
      assert.deepEqual(markdownToBlocks(md).blocks, a, name);
    }
  });

  it("markdown accepts the plain `**N Title:**` / `|` table shape written by hand", () => {
    const { blocks } = markdownToBlocks(
      "DEPLOYMENT-RECORD v1 | K-1 | r#2\n**1 Header:** hi **bold** `c`\n**8 Configs:**\n| Key | Prod |\n|---|---|\n| `a.b` | on |\n",
    );
    // The header line and the section lines are separate paragraphs even without blank lines.
    assert.equal(blocks.length, 4);
    assert.ok(blocks[3].kind === "table" && blocks[3].header && blocks[3].rows[1][0] === "a.b");
  });
});

describe("cheap record detection", () => {
  it("detects all 7 real records and rejects the 2 real non-record comments", () => {
    for (const n of RECORD_FIXTURES) assert.equal(looksLikeRecord(loadFixture(n).body), true, n);
    for (const n of NEGATIVE_FIXTURES) {
      const c = loadFixture(n);
      assert.equal(looksLikeRecord(c.body), false, n);
      assert.equal(parseDeploymentRecord(c), null, n);
    }
  });

  it("rejects a ~2 MB non-record ADF comment in a few ms without converting it", () => {
    const para = { type: "paragraph", content: [{ type: "text", text: "x".repeat(900) + " review notes" }] };
    const doc = { type: "doc", version: 1, content: Array.from({ length: 2300 }, () => para) };
    assert.ok(JSON.stringify(doc).length > 2_000_000);
    looksLikeRecord(doc); // warm-up
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) assert.equal(looksLikeRecord(doc), false);
    assert.equal(parseDeploymentRecord({ id: 1, body: doc }), null);
    const per = (performance.now() - t0) / 51;
    assert.ok(per < 5, `${per.toFixed(3)} ms per call`);
  });

  it("peeks into an ADF JSON string without parsing it, and handles markdown text", () => {
    const rec = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "DEPLOYMENT-RECORD v1 | K-1 | r#2 | 2026-01-01 | a" }] }],
    });
    assert.equal(looksLikeRecord(rec), true);
    assert.equal(looksLikeRecord("DEPLOYMENT-RECORD v1 | K-1 | r#2"), true);
    assert.equal(looksLikeRecord("> DEPLOYMENT-RECORD v1 quoted"), false); // a quoted reply
    assert.equal(looksLikeRecord("deployment-record v1 | K-1 | r#2"), true);
    assert.equal(looksLikeRecord("Please see the DEPLOYMENT-RECORD above"), false);
    assert.equal(looksLikeRecord(null), false);
    assert.equal(looksLikeRecord(42), false);
  });
});

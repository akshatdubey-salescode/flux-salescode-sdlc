import test from "node:test";
import assert from "node:assert/strict";
import { applyFormat, imageMarkdown, insertBlock } from "./markdown-format";

test("bold wraps the selection, or inserts a selected placeholder", () => {
  const r = applyFormat("bold", "make this loud", 5, 9);
  assert.equal(r.value, "make **this** loud");
  assert.equal(r.value.slice(r.selStart, r.selEnd), "this");
  const p = applyFormat("bold", "", 0, 0);
  assert.equal(p.value, "**bold text**");
  assert.equal(p.value.slice(p.selStart, p.selEnd), "bold text");
});

test("heading and list prefix every touched line, and toggle off", () => {
  const v = "one\ntwo\nthree";
  const r = applyFormat("list", v, 1, 6);
  assert.equal(r.value, "- one\n- two\nthree");
  const back = applyFormat("list", r.value, r.selStart, r.selEnd);
  assert.equal(back.value, v);
  assert.equal(applyFormat("heading", "a\ntitle", 3, 3).value, "a\n## title");
});

test("code uses a fence for multi-line selections", () => {
  assert.equal(applyFormat("code", "x y", 0, 1).value, "`x` y");
  assert.equal(applyFormat("code", "a\nb", 0, 3).value, "```\na\nb\n```");
});

test("link selects the URL part for typing", () => {
  const r = applyFormat("link", "see docs", 4, 8);
  assert.equal(r.value, "see [docs](https://)");
  assert.equal(r.value.slice(r.selStart, r.selEnd), "https://");
});

test("insertBlock puts text on its own line", () => {
  assert.equal(insertBlock("ab", 1, 1, "X").value, "a\nX\nb");
  assert.equal(insertBlock("", 0, 0, "X").value, "X");
  assert.equal(insertBlock("a\n", 2, 2, "X").value, "a\nX");
});

test("imageMarkdown builds safe alt text", () => {
  assert.equal(imageMarkdown("Screen Shot [1].png", "/u"), "![Screen Shot  1](/u)");
  assert.equal(imageMarkdown("", "/u"), "![image](/u)");
});

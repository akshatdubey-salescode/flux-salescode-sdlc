// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/ai-review/compact.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { compactText } from "./compact";

test("blank lines, separators, empty bullets and doubled lines go; headings keep one blank line before them", () => {
  const src = "# Title\n\n\nSome text\nSome text\n\n-----\n-\n| | |\n## Part\n\n\nMore";
  assert.equal(compactText(src), "# Title\nSome text\n\n## Part\nMore");
});

test("empty table cells collapse, but a '||' operator and a diagram label pipe are untouched", () => {
  assert.equal(compactText("a | | b |  | c"), "a | b | c");
  assert.equal(compactText("if (x || y)"), "if (x || y)");
  assert.equal(compactText("A -->|yes| B"), "A -->|yes| B");
});

test("diagram colouring lines are dropped, nodes and edges are kept", () => {
  const src = ["graph TD", "A[Order] --> B[Invoice]", "classDef red fill:#f00", "style A fill:#fff,stroke:#000", "class A,B red", "linkStyle 0 stroke:#f00", "%% a comment"].join("\n");
  assert.equal(compactText(src), "graph TD\nA[Order] --> B[Invoice]");
});

test("prose that merely starts with the word 'style' or 'class' is kept", () => {
  assert.equal(compactText("Style guide for reports"), "Style guide for reports");
  assert.equal(compactText("class diagrams are in 02a"), "class diagrams are in 02a");
});

test("compacting twice gives the same text", () => {
  const once = compactText("# A\n\n\nx | | y\nx | | y\n\n- \nlast");
  assert.equal(compactText(once), once);
});

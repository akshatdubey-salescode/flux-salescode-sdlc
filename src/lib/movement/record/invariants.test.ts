/**
 * Provenance invariants: nothing the parser reports may be invented or clipped at the front.
 * Every unknown, fact string, config cell and service note is a contiguous piece of the record's
 * own section text (after the documented whitespace normalisation and tag stripping), starts at a
 * word boundary, and each section's text begins with the first character that follows its heading.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adfToBlocks, blocksToMarkdown } from "./adf";
import { parseDeploymentRecord } from "./parse";
import { loadFixture, loadText, RECORD_FIXTURES, RECORD_FIXTURES_V2, UNION_FIXTURE } from "./testkit";
import type { ParsedRecord } from "./types";
import { stripTags } from "./util";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function haystackOf(r: ParsedRecord): string {
  // A free-form (dialect) record keeps its readable text as `body` instead of sections.
  const body = r.body ? norm(r.body) + "\n" + norm(stripTags(r.body)) + "\n" : "";
  return body + r.sections.map((s) => norm(s.text) + "\n" + norm(stripTags(s.text))).join("\n");
}

/** Keys whose values are derived (lowercased, resolved, generated) rather than copied text. */
const DERIVED = new Set(["id", "state", "prState", "rule31", "downtime", "bundleSdkBuild", "stepsSource", "source", "severity", "repo", "written", "refs", "edges", "jsonSteps", "applicable"]);

interface Piece {
  path: string;
  value: string;
}

/** Every text-derived string of the record. */
function pieces(r: ParsedRecord): Piece[] {
  const out: Piece[] = [];
  for (const u of r.unknowns) {
    out.push({ path: "unknown.text", value: u.text });
    if (u.owner) out.push({ path: "unknown.owner", value: u.owner });
  }
  for (const s of r.sections) for (const t of s.tables) for (const row of t.rows) for (const [k, v] of Object.entries(row)) out.push({ path: `table.${k}`, value: v });
  const f = r.facts;
  const walk = (v: unknown, path: string, key: string): void => {
    if (DERIVED.has(key)) return;
    if (typeof v === "string") out.push({ path, value: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, key));
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      // Values that came from the JSON block, or were resolved/generated, are not section text.
      if (o.source === "json" || (o.source === "text" && false)) return;
      for (const [k, x] of Object.entries(o)) walk(x, `${path}.${k}`, k);
    }
  };
  for (const [k, v] of Object.entries(f)) {
    if (k === "order" && (v as { stepsSource: string }).stepsSource === "json") {
      const o = { ...(v as Record<string, unknown>) };
      delete o.steps;
      walk(o, "facts.order", "order");
    } else walk(v, `facts.${k}`, k);
  }
  return out;
}

function checkProvenance(r: ParsedRecord, label: string): number {
  const hay = haystackOf(r);
  let n = 0;
  for (const p of pieces(r)) {
    const v = norm(p.value);
    if (!v) continue;
    n++;
    // Facts store the text normalised (tags stripped, spaces tidied); `trimDot` removes a final dot.
    assert.ok(hay.includes(v), `${label}: ${p.path} = "${v.slice(0, 60)}" is not a piece of the section text`);
    // It starts at a word boundary: some occurrence is at the start or after a non-word character.
    let ok = false;
    for (let i = hay.indexOf(v); i >= 0 && !ok; i = hay.indexOf(v, i + 1)) ok = i === 0 || !/[\p{L}\p{N}]/u.test(hay[i - 1]) || !/[\p{L}\p{N}]/u.test(v[0]);
    assert.ok(ok, `${label}: ${p.path} = "${v.slice(0, 30)}" starts in the middle of a word`);
  }
  return n;
}

/** First character after the heading of every section, read from the ADF JSON itself. */
function sourceFirstChars(body: unknown): Map<number, string> {
  const m = new Map<number, string>();
  const doc = body as { content: Array<{ type: string; content?: Array<{ type: string; text?: string; marks?: unknown[] }> }> };
  for (const node of doc.content) {
    if (node.type !== "paragraph" || !node.content?.length) continue;
    const first = node.content[0];
    const h = first.text && (first.marks ?? []).length > 0 ? /^(\d{1,2}) .*:$/.exec(first.text) : null;
    if (!h) continue;
    const rest = node.content.slice(1).map((c) => c.text ?? "").join("").trimStart();
    if (rest) m.set(parseInt(h[1], 10), rest[0]);
  }
  return m;
}

/** Same for markdown text: bold `**N Title:** x` or plain `N Title: x` lines. */
function mdFirstChars(md: string): Map<number, string> {
  const m = new Map<number, string>();
  for (const line of md.split("\n")) {
    // (a leading backtick is a code-span mark, not text)
    const h = /^\*\*(\d{1,2}) [^*]+:\*\* ?`?(\S)/.exec(line) ?? /^(\d{1,2}) [A-Z][^:]{0,80}: ?`?(\S)/.exec(line);
    if (h) m.set(parseInt(h[1], 10), h[2]);
  }
  return m;
}

const unbold = (s: string) => s.replace(/\*\*/g, "");
const noJson = (s: string) => s.slice(0, s.lastIndexOf("```\n{"));

describe("provenance invariants on the 7 real records", () => {
  it("every unknown, fact string, table cell and service note is a word-aligned piece of the section text", () => {
    let total = 0;
    for (const n of RECORD_FIXTURES) {
      const r = parseDeploymentRecord(loadFixture(n))!;
      total += checkProvenance(r, n);
    }
    assert.ok(total > 300, `checked ${total} strings`);
  });

  it("each section's text starts with the first character after its heading", () => {
    for (const n of RECORD_FIXTURES) {
      const c = loadFixture(n);
      const r = parseDeploymentRecord(c)!;
      const want = sourceFirstChars(c.body);
      assert.ok(want.size >= 12, n);
      for (const s of r.sections) {
        const w = want.get(s.number);
        if (w !== undefined) assert.equal(s.text[0], w, `${n} section ${s.number}: "${s.text.slice(0, 20)}"`);
      }
      // Section 8 with a table has no text after the heading: its first piece is the header row.
      if (!want.has(8)) assert.match(r.sections[7].text, /^Key \| Store \| /, n);
      else assert.match(r.sections[7].text, /^none in this PR/, n);
    }
  });

  it("exact first-sentence unknowns: 81423 and 81421", () => {
    const a = parseDeploymentRecord(loadFixture("CAV-7304-81423"))!;
    assert.equal(a.unknowns[0].text, "auth-service prod branch: unknown, owner to confirm: devops");
    assert.equal(a.unknowns[0].section, 3);
    const b = parseDeploymentRecord(loadFixture("CAV-7346-81421"))!;
    const u = b.unknowns.find((x) => x.section === 6)!;
    assert.match(u.text, /^Android and iOS build number, current live version, minimum version: unknown, owner to confirm: mobile lead$/);
    assert.equal(u.owner, "mobile lead");
    // And every other section's first unknown that begins its section.
    for (const n of RECORD_FIXTURES) {
      const r = parseDeploymentRecord(loadFixture(n))!;
      for (const u2 of r.unknowns) {
        const s = r.sections.find((x) => x.number === u2.section)!;
        if (s.text.indexOf(u2.text) === 0) assert.equal(u2.text[0], s.text[0], `${n} section ${u2.section}`);
      }
    }
  });

  it("restart/deploy names and notes in particular", () => {
    for (const n of RECORD_FIXTURES) {
      const r = parseDeploymentRecord(loadFixture(n))!;
      const hay = haystackOf(r);
      for (const sv of [...(r.facts.restart ?? []), ...(r.facts.deploy ?? [])]) {
        if (sv.written === undefined) assert.ok(hay.includes(norm(sv.name)), `${n}: ${sv.name}`);
        if (sv.note) assert.ok(hay.includes(norm(sv.note)), `${n}: note of ${sv.name}`);
      }
      for (const t of [...(r.facts.restartNotes ?? []), ...(r.facts.deployNotes ?? [])]) assert.ok(hay.includes(norm(t)), `${n}: ${t.slice(0, 30)}`);
    }
  });
});

describe("provenance invariants on the 6 real v2 records", () => {
  it("strings are word-aligned pieces of the section text and sections start at the heading's first char", () => {
    let total = 0;
    for (const n of RECORD_FIXTURES_V2) {
      const c = loadFixture(n);
      const r = parseDeploymentRecord(c)!;
      total += checkProvenance(r, n);
      const want = sourceFirstChars(c.body);
      for (const s of r.sections) {
        const w = want.get(s.number);
        if (w !== undefined) assert.equal(s.text[0], w, `${n} section ${s.number}: "${s.text.slice(0, 20)}"`);
      }
    }
    assert.ok(total > 200, `checked ${total} strings`);
  });
});

describe("provenance invariants on synthetic variants", () => {
  const variants: Array<[string, (md: string) => string]> = [
    ["markdown round trip", (m) => m],
    ["unbolded headings", unbold],
    ["JSON block removed", noJson],
    ["unbolded and JSON removed", (m) => unbold(noJson(m))],
  ];
  for (const [name, f] of variants) {
    it(`${name}: same invariants for all 7`, () => {
      for (const n of RECORD_FIXTURES) {
        const md = f(blocksToMarkdown(adfToBlocks(loadFixture(n).body).blocks));
        const r = parseDeploymentRecord({ id: 1, body: md })!;
        assert.equal(r.sections.length, 14, `${n}/${name}`);
        checkProvenance(r, `${n}/${name}`);
        const want = mdFirstChars(md);
        for (const s of r.sections) {
          const w = want.get(s.number);
          if (w !== undefined) assert.equal(s.text[0], w, `${n}/${name} section ${s.number}: "${s.text.slice(0, 20)}"`);
        }
      }
    });
  }

  it("a clause longer than the 200-char window is cut at a word boundary, never mid-word", () => {
    const long = "alpha ".repeat(60) + "gate: unknown, owner to confirm: ops.";
    const r = parseDeploymentRecord({ id: 1, body: `DEPLOYMENT-RECORD v1 | K-1 | r#2 | 2026-01-01 10:00 | a\n\n**3 Prod branch and cherry-pick:** ${long}` })!;
    assert.equal(r.unknowns.length, 1);
    assert.match(r.unknowns[0].text, /^(alpha )+gate: unknown, owner to confirm: ops$/);
    assert.ok(r.unknowns[0].text.length <= 200);
    checkProvenance(r, "long clause");
  });
});

describe("provenance invariants on the free-form union record (CAV-7280)", () => {
  const c = loadFixture(UNION_FIXTURE);
  const T: string = (c.body as { content: Array<{ content: Array<{ text: string }> }> }).content[0].content[0].text;

  it("every unknown, fact string, row and label is a word-aligned piece of the record's body", () => {
    const r = parseDeploymentRecord(c)!;
    assert.ok(r.body);
    const n = checkProvenance(r, UNION_FIXTURE);
    assert.ok(n > 80, `checked ${n} strings`);
    for (const u of r.unknowns) assert.ok(norm(r.body!).includes(norm(u.text)), u.text);
  });

  it("the same holds for the code-fence, tab, CRLF and one-paragraph-per-line shapes", () => {
    const shapes: unknown[] = [
      "```\n" + T + "\n```",
      T.replace(/ {2,}/g, "\t"),
      T.replace(/\n/g, "\r\n"),
      { type: "doc", content: T.split("\n").filter((l) => l.trim()).map((l) => ({ type: "paragraph", content: [{ type: "text", text: l }] })) },
    ];
    for (const [i, body] of shapes.entries()) {
      const r = parseDeploymentRecord({ id: 1, body })!;
      assert.equal(r.facts.releaseRows!.length, 23, `shape ${i}`);
      checkProvenance(r, `shape ${i}`);
    }
  });
});

describe("provenance invariants on the v2-spec union record (CAV-7300-like, 17 merged PRs)", () => {
  const T = loadText("CAV-7300-union");

  it("covers, PR groups, rows, owners, likely points and configs are word-aligned pieces of the body", () => {
    const shapes: unknown[] = [
      T,
      "```\n" + T + "\n```",
      T.replace(/\n/g, "\r\n"),
      T.replace(/ {3,}/g, "\t"),
      { type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: T }] }] },
    ];
    for (const [i, body] of shapes.entries()) {
      const r = parseDeploymentRecord({ id: 1, body })!;
      assert.equal(r.facts.covers!.length, 17, `shape ${i}`);
      const n = checkProvenance(r, `shape ${i}`);
      assert.ok(n > 150, `shape ${i}: ${n} strings`);
    }
  });
});

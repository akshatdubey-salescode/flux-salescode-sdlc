import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adfToBlocks, blocksToMarkdown } from "./adf";
import { parseDeploymentRecord, parseRecordDate } from "./parse";
import { loadFixture, RECORD_FIXTURES } from "./testkit";
import type { ParsedRecord } from "./types";

const base = (name: string) => blocksToMarkdown(adfToBlocks(loadFixture(name).body).blocks);
const md81422 = base("CAV-7304-81422");

function parse(body: unknown, id: number | string = 1): ParsedRecord {
  const r = parseDeploymentRecord({ id, body, created: "2026-11-19T10:00:00.000+0000", updated: "2026-11-19T10:00:00.000+0000" });
  assert.ok(r);
  return r;
}
const codes = (r: ParsedRecord) => r.warnings.map((w) => `${w.code}${w.path ? ":" + w.path : ""}`);

describe("same content from markdown text and ADF", () => {
  it("gives an identical parsed record for every fixture", () => {
    for (const name of RECORD_FIXTURES) {
      const fromAdf = parseDeploymentRecord(loadFixture(name))!;
      const fromMd = parseDeploymentRecord({ ...loadFixture(name), body: base(name) })!;
      assert.deepEqual(fromMd, fromAdf, name);
    }
  });
});

describe("missing, extra and renumbered sections", () => {
  it("missing sections are reported and everything else still parses", () => {
    const md = md81422.replace(/\*\*6 App release:\*\*[^\n]*\n\n/, "").replace(/\*\*9 Roles to test:\*\*[^\n]*\n\n/, "");
    const r = parse(md);
    // One aggregated warning (count + the missing numbers), not one per section.
    const miss = r.warnings.filter((w) => w.code === "section_missing");
    assert.equal(miss.length, 1);
    assert.equal(miss[0].count, 2);
    assert.match(miss[0].message, /: 6, 9$/);
    assert.equal(r.facts.appRelease, undefined);
    assert.equal(r.facts.roles, undefined);
    assert.equal(r.sections.length, 12);
    assert.equal(r.facts.configs!.length, 1);
    assert.equal(r.facts.order!.steps.length, 5);
  });

  it("an extra section 15 is kept as raw text with its unknowns", () => {
    const md = md81422.replace("\n\n```\n{", "\n\n**15 Rollout notes:** warm the cache first. Pager duty: unknown, owner to confirm: sre.\n\n```\n{");
    const r = parse(md);
    const s15 = r.sections.find((s) => s.number === 15)!;
    assert.equal(s15.canonical, null);
    assert.match(s15.text, /^warm the cache first/);
    assert.deepEqual(r.unknowns.filter((u) => u.section === 15).map((u) => u.owner), ["sre"]);
    assert.equal(r.sections.length, 15);
    assert.deepEqual(r.warnings, []);
  });

  it("a renumbered template is read by title (configs as 9, roles as 8)", () => {
    const md = md81422.replace("**8 Configs to move to prod (Rule 30):**", "**9 Configs to move to prod (Rule 30):**").replace("**9 Roles to test:**", "**8 Roles to test:**");
    const r = parse(md);
    assert.equal(r.facts.configs!.length, 1);
    assert.ok(r.facts.roles!.length >= 2);
    assert.ok(codes(r).includes("section_title_mismatch:section:9"));
  });

  it("a section heading after a hard break inside one ADF paragraph still splits", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "DEPLOYMENT-RECORD v1 | K-1 | r#2 | 2026-01-01 10:00 | bot" },
            { type: "hardBreak" },
            { type: "text", text: "supersedes: none" },
            { type: "hardBreak" },
            { type: "text", text: "1 Header:", marks: [{ type: "strong" }] },
            { type: "text", text: " Status " },
            { type: "text", text: "READY", marks: [{ type: "strong" }] },
            { type: "text", text: " (0 open Should-fix, 0 Blocking)." },
          ],
        },
      ],
    };
    const r = parse(doc);
    assert.equal(r.status, "READY");
    assert.equal(r.marker.supersedes, null);
    assert.equal(r.sections.length, 1);
  });
});

describe("JSON block problems", () => {
  const jsonStart = md81422.lastIndexOf("```\n{");

  it("malformed JSON is reported, the text still gives the facts", () => {
    const md = md81422.slice(0, jsonStart) + '```\n{"marker":{"version":1,"key":"CAV-7304" oops\n```';
    const r = parse(md);
    assert.ok(codes(r).includes("json_malformed:json"));
    assert.equal(r.json, null);
    assert.equal(r.status, "BLOCKED");
    assert.equal(r.facts.configs![0].source, "table");
    assert.equal(r.facts.order!.steps.length, 5);
    assert.equal(r.marker.pr, 1185);
  });

  it("a trailing comma and smart quotes are repaired silently", () => {
    const fixed = md81422.slice(jsonStart).replace('"status":"BLOCKED"', "\u201cstatus\u201d:\"BLOCKED\"").replace(/\}\n```$/, ",}\n```");
    const r = parse(md81422.slice(0, jsonStart) + fixed);
    assert.equal(codes(r).includes("json_malformed:json"), false);
    assert.equal(r.json?.status, "BLOCKED");
  });

  it("JSON that disagrees with the readable text loses; each disagreement is a warning", () => {
    const md = md81422
      .replace('"status":"BLOCKED"', '"status":"READY"')
      .replace('"defaultWhenAbsent":"off"', '"defaultWhenAbsent":"on"')
      .replace('"base":"master"', '"base":"main"')
      .replace('"pr":1185', '"pr":1999');
    const r = parse(md);
    assert.equal(r.status, "BLOCKED");
    assert.equal(r.facts.configs![0].default, "off (nothing changes)");
    assert.equal(r.facts.baseBranch, "master");
    assert.equal(r.marker.pr, 1185);
    const c = codes(r);
    for (const want of ["json_disagrees:json:status", "json_disagrees:json:configs[verify.active.session.enabled].default", "json_disagrees:json:branches.base", "json_disagrees:json:marker.pr"]) {
      assert.ok(c.includes(want), `${want} in ${c.join(" | ")}`);
    }
  });

  it("wrong JSON types never break extraction (each extractor is independent)", () => {
    const junk = '{"marker":7,"status":5,"branches":{"siblings":5,"approvers":"x"},"configs":"oops","risks":5,"order":[],"deploy":{"a":1},"restart":3,"prodBranch":"x"}';
    const r = parse(md81422.slice(0, jsonStart) + "```\n" + junk + "\n```");
    assert.equal(r.warnings.some((w) => w.code === "extractor_failed"), false);
    assert.equal(r.facts.configs!.length, 1);
    assert.equal(r.facts.order!.steps.length, 5);
    assert.equal(r.marker.key, "CAV-7304");
  });

  it("no JSON block at all gives a json_missing warning only", () => {
    const r = parse(md81422.slice(0, jsonStart));
    assert.deepEqual(codes(r), ["json_missing:json"]);
    assert.equal(r.facts.configs![0].source, "table");
  });
});

describe("marker-only and odd headers", () => {
  it("a comment holding only the marker line is a record with no sections", () => {
    const r = parse("DEPLOYMENT-RECORD v2 | CAV-1 | salescode-ai/some-repo#5 | 2026-01-02 10:00 | Bot (x)\nsupersedes: v1");
    assert.deepEqual(
      { v: r.marker.version, key: r.marker.key, repo: r.marker.repo, pr: r.marker.pr, agent: r.marker.agent },
      { v: 2, key: "CAV-1", repo: "some-repo", pr: 5, agent: "Bot (x)" },
    );
    assert.deepEqual({ ...r.marker.supersedes }, { raw: "v1", version: 1, commentId: null, versions: [1], commentIds: [], prs: [] });
    assert.equal(r.sections.length, 0);
    // Nothing but the additive `covers` (the record's own PR) is known.
    assert.deepEqual(r.facts, { covers: [{ repo: "some-repo", pr: 5 }] });
    assert.equal(r.status, null);
    const miss = r.warnings.filter((w) => w.code === "section_missing");
    assert.deepEqual(miss.map((w) => w.count), [14]);
  });

  it("a header without the pipes still returns a record with a header_mismatch warning", () => {
    const r = parse("DEPLOYMENT-RECORD something odd");
    assert.ok(codes(r).includes("header_mismatch:header"));
    assert.equal(r.marker.key, null);
  });

  it("parses several date formats; invalid ones are null", () => {
    const cases: Array<[string, string | null]> = [
      ["2026-11-19 11:30", "2026-11-19T11:30:00.000Z"],
      ["2026-11-19T11:30:00Z", "2026-11-19T11:30:00.000Z"],
      ["2026-11-19T11:30:00+05:30", "2026-11-19T06:00:00.000Z"],
      ["2026-11-19", "2026-11-19T00:00:00.000Z"],
      ["19/11/2026 11:30", "2026-11-19T11:30:00.000Z"],
      ["19-11-2026", "2026-11-19T00:00:00.000Z"],
      ["19 Nov 2026 11:30 UTC", "2026-11-19T11:30:00.000Z"],
      ["Nov 19, 2026 11:30", "2026-11-19T11:30:00.000Z"],
      ["31/02/2026", null],
      ["2026-13-01", null],
      ["yesterday", null],
    ];
    for (const [raw, want] of cases) assert.equal(parseRecordDate(raw), want, raw);
  });

  it("an unusual header date is read; an unreadable one is kept as text with a warning", () => {
    const a = parse("DEPLOYMENT-RECORD v1 | CAV-1 | r#2 | 19 Nov 2026 11:30 UTC | Claude (pr-review)");
    assert.equal(a.marker.at, "2026-11-19T11:30:00.000Z");
    assert.equal(a.marker.agent, "Claude (pr-review)");
    const b = parse("DEPLOYMENT-RECORD v1 | CAV-1 | r#2 | 19.11.26 11:30 | Claude (pr-review)");
    assert.equal(b.marker.at, null);
    assert.equal(b.marker.atRaw, "19.11.26 11:30");
    assert.equal(b.marker.agent, "Claude (pr-review)");
    assert.ok(codes(b).includes("date_unparseable:header"));
  });
});

describe("tables with varying columns", () => {
  const rec = (table: string) =>
    parse(`DEPLOYMENT-RECORD v1 | K-1 | r#2 | 2026-01-01 10:00 | a\n\n**8 Configs to move to prod:**\n\n${table}\n`);

  it("an extra column and a missing column are read by header name", () => {
    const r = rec(
      [
        "| Key | Store | Prod | Demo | Owner |",
        "|---|---|---|---|---|",
        "| `a.one` | env | on | off | ops |",
        "| `a.two` | prop | unknown |",
        "| `a.three` | prop | on | on | ops | surprise |",
      ].join("\n"),
    );
    const [one, two, three] = r.facts.configs!;
    // Columns in another order are matched by header, not position; unknown columns go to `extra`.
    assert.deepEqual({ k: one.key, store: one.store, prod: one.prod, demo: one.demo, extra: { ...one.extra } }, { k: "a.one", store: "env", prod: "on", demo: "off", extra: { Owner: "ops" } });
    // Missing trailing columns are simply absent.
    assert.deepEqual({ k: two.key, prod: two.prod, demo: two.demo, uat: two.uat }, { k: "a.two", prod: "unknown", demo: undefined, uat: undefined });
    // A cell beyond the header is kept under col<N>.
    assert.deepEqual({ ...three.extra }, { Owner: "ops", col6: "surprise" });
  });

  it("a table without a recognisable key header uses the first column; duplicates are suffixed", () => {
    const r = rec(["| Setting name | Prod | Prod |", "|---|---|---|", "| `x.y` | 1 | 2 |"].join("\n"));
    assert.equal(r.facts.configs![0].key, "x.y");
    // Two columns of the same environment: the first non-empty is `prod`, both stay in byTenant.
    assert.equal(r.facts.configs![0].prod, "1");
    assert.deepEqual({ ...r.facts.configs![0].byTenant }, { Prod: "1", "Prod#2": "2" });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adfToBlocks, blocksToMarkdown } from "./adf";
import { looksLikeRecord, parseDeploymentRecord } from "./parse";
import { approxBytes, pickNewestPerPr } from "./pick";
import { loadFixture, RECORD_FIXTURES } from "./testkit";
import type { ParsedRecord } from "./types";

const HEAD = "DEPLOYMENT-RECORD v1 | CAV-1 | r#2 | 2026-11-19 10:00 | bot\nsupersedes: none";
const md = (name: string) => blocksToMarkdown(adfToBlocks(loadFixture(name).body).blocks);
const noJson = (m: string) => m.slice(0, m.lastIndexOf("```\n{"));
function parse(body: unknown, id: number | string = 1): ParsedRecord {
  const r = parseDeploymentRecord({ id, body, created: "2026-11-19T10:00:00.000+0000", updated: "2026-11-19T10:00:00.000+0000" });
  assert.ok(r);
  return r;
}
function fixture(name: string): ParsedRecord {
  const r = parseDeploymentRecord(loadFixture(name));
  assert.ok(r);
  return r;
}
const text = (r: string) => `${HEAD}\n\n${r}`;

/** A markdown record with `payload` in the sections whose extractors carry the most regexes. */
function bad(payload: string): string {
  const titles = ["Header", "Branches and owners", "Prod branch", "Services to deploy", "Services to restart", "App release", "Database", "Configs", "Roles to test", "Backward compatibility", "Deploy order, gates, rollback", "Testing evidence", "Risks and open items", "Post-deploy verification"];
  return (
    HEAD +
    "\n\n" +
    titles.map((t, i) => `**${i + 1} ${t}:** Status BLOCKED (1 open Should-fix). Siblings: a#1 (open). ${[1, 2, 4, 5, 7, 11, 13].includes(i + 1) ? payload : "ok"}`).join("\n\n")
  );
}
function badAdf(payload: string): unknown {
  const paras = bad(payload).split("\n\n").slice(1);
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: HEAD }] },
      ...paras.map((p) => {
        const m = /^\*\*(.+?)\*\* ([\s\S]*)$/.exec(p)!;
        return { type: "paragraph", content: [{ type: "text", text: m[1], marks: [{ type: "strong" }] }, { type: "text", text: " " + m[2] }] };
      }),
    ],
  };
}

describe("pathological input finishes fast through the public API", () => {
  const N = 50_000;
  const families: Record<string, string> = {
    spaces: "a" + " ".repeat(N) + "b",
    "open parens": "(".repeat(N),
    "open brackets": "[".repeat(N),
    "one long word": "a".repeat(N),
    "dot-space repeats": "a. ".repeat(N / 3),
    "pipe runs": "|".repeat(N),
    digits: "1".repeat(N),
    "tab/newline soup": "x \t\n ".repeat(N / 5),
    "tag openers": "[V, ".repeat(N / 4),
    "owner-to-confirm repeats": "unknown, owner to confirm: x. ".repeat(N / 30),
    "Replaces repeats": "Replaces #1 and ".repeat(N / 16),
    "arrow repeats": "a -> ".repeat(N / 5),
    "gates/rollback repeats": "Gates: a; Rollback: b. ".repeat(N / 23),
    "mixed punctuation": "( ) [ ] ** ` | - # . ".repeat(N / 20),
  };
  for (const [name, payload] of Object.entries(families)) {
    it(`${name}: ADF and markdown both under 150 ms`, () => {
      for (const [kind, body] of [["adf", badAdf(payload)], ["md", bad(payload)]] as const) {
        // Best of three (the first call in a fresh process pays JIT warm-up; a loaded CI box can stall one).
        let ms = Infinity;
        let r!: ParsedRecord;
        for (let k = 0; k < 3; k++) {
          const t0 = performance.now();
          r = parse(body);
          ms = Math.min(ms, performance.now() - t0);
        }
        assert.ok(ms < 150, `${name}/${kind}: ${ms.toFixed(0)} ms`);
        assert.equal(r.marker.pr, 2);
        for (const s of r.sections) assert.ok(s.text.length <= 20_000, `section ${s.number}: ${s.text.length}`);
      }
    });
  }

  it("one ADF paragraph of alternating plain/bold runs and hard breaks (400 K chars) stays linear", () => {
    const content: unknown[] = [];
    for (let i = 0; i < 40_000; i++) {
      content.push({ type: "text", text: "plain text " });
      content.push({ type: "text", text: "bold", marks: [{ type: "strong" }] });
      content.push({ type: "hardBreak" });
    }
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: HEAD }] },
        { type: "paragraph", content: [{ type: "text", text: "1 Header:", marks: [{ type: "strong" }] }, ...content] },
      ],
    };
    let ms = Infinity;
    let r!: ParsedRecord;
    for (let k = 0; k < 2; k++) {
      const t0 = performance.now();
      r = parse(doc);
      ms = Math.min(ms, performance.now() - t0);
    }
    assert.ok(ms < 300, `${ms.toFixed(0)} ms`);
    assert.equal(r.sections.length, 1);
    assert.equal(r.truncated, true);
  });
});

describe("repo aliases are resolved inside the record", () => {
  it("81422: 'auth-service #332' and 'Flutter #50' in the order point at the sibling PRs", () => {
    const o = fixture("CAV-7304-81422").facts.order!;
    assert.deepEqual(o.steps[1].refs, [{ repo: "salescode-auth-service", pr: 332, written: "auth-service" }]);
    assert.deepEqual(o.steps[3].refs, [{ repo: "channelkart-flutter", pr: 50, written: "flutter" }]);
    assert.deepEqual(o.steps[0].refs, [{ repo: "channelkart", pr: 1185 }]); // already full: no `written`
    assert.deepEqual(o.edges[1], { before: "salescode-auth-service#332", after: "kpi-dashboard#269" });
  });

  it("81423 (JSON steps use 'auth-service#332', 'channelkart-flutter#50'): resolved to the record's own PR", () => {
    const r = fixture("CAV-7304-81423");
    const refs = r.facts.order!.steps.flatMap((s) => s.refs);
    assert.ok(refs.some((x) => x.repo === "salescode-auth-service" && x.pr === 332 && x.written === "auth-service"));
    assert.ok(r.facts.order!.edges.some((e) => e.before === "salescode-auth-service#332" && e.after === "kpi-dashboard#269"));
  });

  it("an alias that matches two repos, or none, is left as written", () => {
    const r = parse(text("**2 Branches and owners:** Siblings: foo-ui#1, bar-ui#2.\n\n**11 Deploy order:** after ui #3; then web #4."));
    const refs = r.facts.order!.steps.flatMap((s) => s.refs);
    assert.ok(refs.some((x) => x.repo === "ui" && x.written === undefined)); // two candidates: ambiguous
    assert.ok(refs.some((x) => x.repo === "web"));
  });

  it("pickNewestPerPr does not split 'auth-service#332' from 'salescode-auth-service#332'", () => {
    const mk = (id: number, repo: string, v: number) =>
      parse(`DEPLOYMENT-RECORD v${v} | CAV-1 | ${repo}#332 | 2026-11-19 10:00 | bot\nsupersedes: none`, id);
    const picked = pickNewestPerPr([mk(1, "auth-service", 1), mk(2, "salescode-auth-service", 2)]);
    assert.deepEqual(picked.map((r) => r.comment.id), ["2"]);
    // Different PR numbers (or unrelated repos) stay apart.
    assert.equal(pickNewestPerPr([mk(1, "auth-service", 1), parse(HEAD.replace("r#2", "other#332"), 3)]).length, 2);
  });
});

describe("field quality on the real records", () => {
  it("authors have no trailing punctuation (all 7)", () => {
    for (const n of RECORD_FIXTURES) assert.equal(fixture(n).facts.author, "dev-a", n);
  });

  it("restart: a statement is a note, not a service (81422 section 5, JSON removed)", () => {
    const r = parse(noJson(md("CAV-7304-81422")));
    assert.equal(r.json, null);
    // With and without the JSON block the same two services come out.
    for (const rec of [r, fixture("CAV-7304-81422")]) {
      assert.deepEqual(rec.facts.restart!.map((s) => s.name), ["Channel Kart", "salescode-auth-service"]);
      assert.match(rec.facts.restart![0].note!, /Kafka consumer/);
      assert.equal(rec.facts.restart![1].written, "auth-service");
      assert.match(rec.facts.restart![1].note!, /^auth-service restart loses its in-memory sweep timer/);
    }
  });

  it("database: noSql and hasAction are separate", () => {
    for (const n of ["CAV-7346-81399", "CAV-7304-81423"]) {
      const d = fixture(n).facts.database!;
      assert.equal(d.noSql, true, n);
      assert.equal(d.hasAction, true, n);
    }
    const d = fixture("CAV-7346-81421").facts.database!;
    assert.deepEqual({ noSql: d.noSql, hasAction: d.hasAction }, { noSql: true, hasAction: false });
    assert.equal("text" in d, false);
  });

  it("order: 81424 without the JSON reads 'after X and Y' as edges; 81399 is a structured chain", () => {
    const r = parse(noJson(md("CAV-7304-81424")));
    const o = r.facts.order!;
    assert.equal(o.structured, false);
    assert.equal(o.stepsSource, "text");
    assert.deepEqual(o.edges, [
      { before: "channelkart#1185", after: "kpi-dashboard#269" },
      { before: "salescode-auth-service#332", after: "kpi-dashboard#269" },
    ]);
    const c = fixture("CAV-7346-81399").facts.order!;
    assert.equal(c.structured, true);
    assert.deepEqual(c.edges[0], { before: "channelkart#1184", after: "kpi-dashboard#267" });
    assert.equal(c.edges.length, 3);
    // 81423: "after X, before the properties ...; then Y and Z" in prose.
    const p = fixture("CAV-7304-81423").facts.order!;
    assert.equal(p.structured, false);
    assert.ok(p.edges.some((e) => e.before === "channelkart#1185" && e.after === "salescode-auth-service#332"));
    assert.ok(p.edges.some((e) => e.before === "salescode-auth-service#332" && /properties are turned on/.test(e.after)));
  });
});

describe("headings", () => {
  it("the same record unbolded gives the same 14 sections and facts", () => {
    const bold = md("CAV-7304-81422");
    const plain = bold.replace(/\*\*/g, "");
    const a = parse(bold);
    const b = parse(plain);
    assert.deepEqual(b.sections.map((s) => [s.number, s.canonical]), a.sections.map((s) => [s.number, s.canonical]));
    assert.equal(b.sections.length, 14);
    assert.deepEqual(b.facts.configs, a.facts.configs);
    assert.deepEqual(b.facts.order!.steps.length, a.facts.order!.steps.length);
  });

  it("fullwidth asterisks and unicode-bold digits/letters are normalised", () => {
    const r = parse(text("＊＊1 Header:＊＊ Status READY (0 open Should-fix, 0 Blocking).\n\n\u{1D7D0} \u{1D401}\u{1D42B}\u{1D41A}\u{1D427}\u{1D41C}\u{1D421}\u{1D41E}\u{1D42C} and owners: PR #5, OPEN."));
    assert.deepEqual(r.sections.map((s) => [s.number, s.canonical]), [[1, "header"], [2, "branches"]]);
    assert.equal(r.status, "READY");
    assert.equal(r.facts.prState, "open");
  });

  it("a bold '2 blockers:' inside section 13 does not start a section; '2 Branches and owners' would", () => {
    const m = md("CAV-7304-81422").replace(/(\*\*13 Risks[^\n]*)/, "$1\n\n**2 blockers:** none");
    const r = parse(m);
    assert.equal(r.sections.length, 14);
    assert.match(r.sections[12].text, /2 blockers: none/);
    assert.equal(r.warnings.some((w) => w.code === "section_duplicate"), false);
  });
});

describe("header and marker variants", () => {
  const rec = (header: string, extra = "") => parse(`${header}\nsupersedes: none\n\n**1 Header:** Status READY (0 open Should-fix, 0 Blocking).${extra}`);
  it("owner/repo#n, repo PR #n, owner/repo/pull/n and github urls", () => {
    for (const rp of ["salescode-ai/some-repo#12", "some-repo PR #12", "some-repo PR 12", "salescode-ai/some-repo/pull/12", "https://github.com/salescode-ai/some-repo/pull/12"]) {
      const r = rec(`DEPLOYMENT-RECORD v1 | CAV-1 | ${rp} | 2026-11-19 10:00 | bot`);
      assert.deepEqual([r.marker.repo, r.marker.pr], ["some-repo", 12], rp);
      assert.equal(r.warnings.some((w) => w.code === "header_mismatch"), false, rp);
    }
  });
  it("an invalid repo word ('PR') falls back to the JSON marker; without JSON it is a header_mismatch", () => {
    const withJson = rec("DEPLOYMENT-RECORD v1 | CAV-1 | PR #12 | 2026-11-19 10:00 | bot", '\n\n```\n{"marker":{"repo":"salescode-ai/some-repo","pr":12}}\n```');
    assert.deepEqual([withJson.marker.repo, withJson.marker.pr], ["some-repo", 12]);
    assert.equal(withJson.warnings.some((w) => w.code === "header_mismatch"), false);
    const without = rec("DEPLOYMENT-RECORD v1 | CAV-1 | pull#12 | 2026-11-19 10:00 | bot");
    assert.equal(without.marker.repo, null);
    assert.ok(without.warnings.some((w) => w.code === "header_mismatch"));
  });
  it("supersedes accepts lists; 'repo#pr' is never taken for a comment id", () => {
    const a = rec("DEPLOYMENT-RECORD v2 | CAV-1 | r#2 | 2026-11-19 10:00 | bot").marker;
    assert.equal(a.supersedes, null);
    const s1 = parse("DEPLOYMENT-RECORD v2 | CAV-1 | r#2 | 2026-11-19 10:00 | bot\nsupersedes: 81399, 81400 and v1").marker.supersedes!;
    assert.deepEqual([s1.commentIds, s1.versions, s1.commentId], [["81399", "81400"], [1], "81399"]);
    const s2 = parse("DEPLOYMENT-RECORD v2 | CAV-1 | r#2 | 2026-11-19 10:00 | bot\nsupersedes: channelkart#1184").marker.supersedes!;
    assert.deepEqual([s2.commentIds, s2.prs], [[], ["channelkart#1184"]]);
  });
  it("detection: case-insensitive, first line split over many nodes, quoted replies rejected", () => {
    assert.equal(looksLikeRecord({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "DEPLOY" }, { type: "text", text: "MENT-RECORD v1 | K-1" }] }] }), true);
    const quoted = { type: "doc", content: [{ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: HEAD }] }] }] };
    assert.equal(looksLikeRecord(quoted), false);
    assert.equal(parseDeploymentRecord({ id: 1, body: quoted }), null);
  });
  it("status: 'NOT READY' and a bare 'BLOCKED for release'", () => {
    const a = parse(text("**1 Header:** x. Status NOT READY (1 open Should-fix, 0 Blocking)."));
    assert.deepEqual([a.status, a.statusText], ["BLOCKED", "NOT READY (1 open Should-fix, 0 Blocking)"]);
    const b = parse(text("**1 Header:** x. BLOCKED for release (2 open Should-fix, 0 Blocking)."));
    assert.deepEqual([b.status, b.counts], ["BLOCKED", { shouldFix: 2, blocking: 0 }]);
    assert.equal(parse(text("**1 Header:** this is ready soon.")).status, null);
  });
});

describe("section facts", () => {
  it("siblings: each ref takes its own state; no bleed past the sentence", () => {
    const f = parse(text("**2 Branches and owners:** a `x` -> `master`, PR #2, OPEN. Siblings: a#1 (merged), b#2 (open), c#3. Next: d#4 (closed).")).facts;
    assert.deepEqual(f.siblings, [{ repo: "a", pr: 1, state: "merged" }, { repo: "b", pr: 2, state: "open" }, { repo: "c", pr: 3 }]);
    const g = parse(text("**2 Branches and owners:** Siblings: a#1, b#2 (all open), c#3 (closed). Done.")).facts;
    assert.deepEqual(g.siblings, [{ repo: "a", pr: 1, state: "open" }, { repo: "b", pr: 2, state: "open" }, { repo: "c", pr: 3, state: "closed" }]);
  });
  it("Replaces: lists and repo-qualified refs", () => {
    const a = parse(text("**2 Branches and owners:** PR author x. Replaces #1160 and #1161 (closed). Approver: none.")).facts;
    assert.deepEqual(a.replaces, [{ pr: 1160, state: null }, { pr: 1161, state: "closed" }]);
    const b = parse(text("**2 Branches and owners:** Replaces channelkart#1160 (closed).")).facts;
    assert.deepEqual(b.replaces, [{ pr: 1160, state: "closed", repo: "channelkart" }]);
    const own = parse(text("**2 Branches and owners:** Replaces r#1160 (closed).")).facts;
    assert.deepEqual(own.replaces, [{ pr: 1160, state: "closed" }]); // own repo: no `repo`
  });
  it("prod branches: all of them, the first as prodBranch", () => {
    const f = parse(text("**3 Prod branch:** core uses `prod_blue_17` and the bundle `prod-17-july-blue`, not `master`.")).facts;
    assert.deepEqual(f.prodBranches, ["prod_blue_17", "prod-17-july-blue"]);
    assert.equal(f.prodBranch!.branch, "prod_blue_17");
  });
  it("order: '1) a 2) b' numbered markers, trimmed first", () => {
    const o = parse(text("**11 Deploy order, gates, rollback:**   1) first service  2) second service. Gates: g1; g2. Rollback: back.")).facts.order!;
    assert.deepEqual(o.steps.map((s) => s.text), ["first service", "second service"]);
    assert.equal(o.structured, true);
    assert.deepEqual(o.gates, ["g1", "g2"]);
  });
  it("risks written as bullets lose their list prefix before splitting", () => {
    const m = text("**13 Risks and open items:**\n\n- Blocking: token leak\n- Should-fix: slow query; missing index\n* Nitpick: naming\n1. Should-fix: second round");
    const r = parse(m).facts.risks!;
    assert.deepEqual(r.map((x) => [x.severity, x.text]), [
      ["Blocking", "token leak"],
      ["Should-fix", "slow query"],
      ["Should-fix", "missing index"],
      ["Nitpick", "naming"],
      ["Should-fix", "second round"],
    ]);
  });
  it("table headers named __proto__ / constructor are plain keys", () => {
    const r = parse(text("**8 Configs:**\n\n| Key | __proto__ | constructor |\n|---|---|---|\n| a.b | 1 | 2 |"));
    const extra = r.facts.configs![0].extra!;
    assert.deepEqual(Object.keys(extra), ["__proto__", "constructor"]);
    assert.equal(Object.getPrototypeOf(extra), null);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
  it("malformed ADF degrades gracefully and the marker is still read", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: HEAD }] },
        { type: "table", content: "x" },
        { type: "bulletList", content: { a: 1 } },
        { type: "paragraph", content: 5 },
        { type: "paragraph", content: [{ type: "text", text: "1 Header:", marks: "bold" }] },
      ],
    };
    const r = parse(doc);
    assert.equal(r.marker.pr, 2);
    // Even a document whose body cannot be walked keeps the marker via the head text.
    const hostile = { type: "doc", get content(): unknown { throw new Error("boom"); } };
    assert.equal(looksLikeRecord(hostile), false); // cannot even be peeked: not a record
  });
});

describe("size and shape bounds", () => {
  it("the JSON block is a whitelisted, depth/size-capped copy; 20,000-deep JSON is harmless", () => {
    const deep = "[".repeat(20_000) + "]".repeat(20_000);
    const body = `${HEAD}\n\n**1 Header:** Status READY (0 open Should-fix, 0 Blocking).\n\n\`\`\`\n{"marker":{"version":1,"key":"CAV-1","repo":"r","pr":2,"x":${deep}},"secret":"no","status":"READY","order":{"steps":["a"]}}\n\`\`\``;
    const r = parse(body);
    assert.equal(r.warnings.some((w) => w.code === "json_malformed"), false);
    assert.ok(r.json);
    assert.equal("secret" in r.json!, false);
    assert.ok(JSON.stringify(r).length < 100_000);
    assert.doesNotThrow(() => structuredClone(r));
    assert.doesNotThrow(() => JSON.stringify(r));
    // Every real record round-trips too.
    for (const n of RECORD_FIXTURES) {
      const rr = fixture(n);
      assert.doesNotThrow(() => structuredClone(rr), n);
      assert.deepEqual(JSON.parse(JSON.stringify(rr.facts)), JSON.parse(JSON.stringify(structuredClone(rr).facts)), n);
    }
  });

  it("preamble ~2 KB, section text 20 KB, every fact string 500 chars", () => {
    const long = "word ".repeat(10_000);
    const r = parse(`${HEAD}\n\n${long}\n\n**1 Header:** ${long} Status READY (0 open Should-fix, 0 Blocking).\n\n**2 Branches and owners:** ${long}\n\n**13 Risks:** ${"Should-fix: " + "aaaa ".repeat(500) + "; "}`);
    assert.ok(r.preamble.length <= 2000);
    assert.ok(r.sections[0].text.length <= 20_000);
    const walk = (v: unknown, path: string): void => {
      if (typeof v === "string") assert.ok(v.length <= 500, `${path} is ${v.length} chars`);
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(r.facts, "facts");
  });

  it("5 MB of text parses to a small record (approxBytes < 150 KB)", () => {
    const filler = "lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(900);
    let s = HEAD + "\n\n";
    for (let i = 1; i <= 14; i++) s += `**${i} Section ${i}:** ${filler}\n\n`.repeat(7);
    assert.ok(s.length > 5_000_000);
    const t0 = performance.now();
    const r = parse(s);
    const ms = performance.now() - t0;
    assert.ok(ms < 500, `${ms.toFixed(0)} ms`);
    const b = approxBytes(r);
    assert.ok(b < 150_000, `${b} bytes`);
    assert.equal(r.truncated, true);
  });

  it("approxBytes counts shared objects once (unknowns held by a section and the record)", () => {
    const r = fixture("CAV-7346-81399");
    const twice = approxBytes({ ...r, sections: r.sections.map((s) => ({ ...s, unknowns: s.unknowns.map((u) => ({ ...u })) })) });
    assert.ok(approxBytes(r) < twice, "copies cost more than shared references");
    assert.equal(r.unknowns.length, r.sections.reduce((n, s) => n + s.unknowns.length, 0));
    assert.ok(r.unknowns.every((u) => r.sections.find((s) => s.number === u.section)!.unknowns.includes(u)));
  });

  it("pick is independent of input order and of ties", () => {
    const mk = (id: string) => parse(HEAD, id);
    const a = [mk("a1"), mk("a2"), mk("a3")];
    const picks = [a, [...a].reverse(), [a[1], a[0], a[2]]].map((x) => pickNewestPerPr(x)[0].comment.id);
    assert.deepEqual(new Set(picks).size, 1);
  });
});

describe("round 2: boundaries, headings, header shapes", () => {
  it("unknowns keep their first character after a line break (81399, 81400, 81421 section 8)", () => {
    const want: Record<string, string> = {
      "CAV-7346-81399": "Evidence (config-compare or query) for prod: unknown, owner to confirm: deployer",
      "CAV-7346-81400": "Evidence for prod: unknown, owner to confirm: deployer",
      "CAV-7346-81421": "Evidence for prod: unknown, owner to confirm: deployer",
    };
    for (const [n, t] of Object.entries(want)) {
      const u = fixture(n).unknowns.find((x) => x.section === 8)!;
      assert.equal(u.text, t, n);
      assert.equal(u.owner, "deployer");
    }
  });

  it("bold text that merely starts with a number is not a section; renumbered templates still are", () => {
    const base = "**1 Header:** Status READY (0 open Should-fix, 0 Blocking).\n\n**2 Branches and owners:** PR #5, OPEN.\n\n**3 Prod branch and cherry-pick:** prod-x.\n\n";
    const a = parse(text(base + "**7 days later:** we deploy.\n\n**4 Services to deploy:** Channel Kart."));
    assert.deepEqual(a.sections.map((s) => s.number), [1, 2, 3, 4]);
    assert.match(a.sections[2].text, /7 days later: we deploy/);
    assert.equal(a.facts.database, undefined);
    const b = parse(text(base + "**4 Services to deploy:** x.\n\n**5 Services to restart:** y.\n\n**3 weeks of testing:** z.\n\n**9 months of testing:** z."));
    assert.deepEqual(b.sections.map((s) => s.number), [1, 2, 3, 4, 5]);
    assert.equal(b.facts.testing, undefined);
    // A skipped number is fine when the title is that section's template title.
    assert.deepEqual(parse(text(base + "**7 Database:** none.")).sections.map((s) => s.number), [1, 2, 3, 7]);
  });

  it("a heading after a line break inside ONE ADF paragraph starts a section (hardBreak or \\n; bold or plain)", () => {
    const p = (...c: unknown[]) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: HEAD }, { type: "hardBreak" }, ...c] }] });
    const t = (x: string, bold = false) => ({ type: "text", text: x, ...(bold ? { marks: [{ type: "strong" }] } : {}) });
    const hb = { type: "hardBreak" };
    const variants = [
      p(t("1 Header:", true), t(" x"), hb, t("2 Branches and owners:", true), t(" y")),
      p(t("1 Header: x"), hb, t("2 Branches and owners: y")),
      p(t("1 Header: x\n2 Branches and owners: y")),
    ];
    for (const v of variants) {
      const r = parse(v);
      assert.deepEqual(r.sections.map((s) => [s.number, s.text]), [[1, "x"], [2, "y"]]);
    }
  });

  it("a bold unicode digit in a bold heading is normalised", () => {
    const r = parse(text("**1 Header:** Status READY (0 open Should-fix, 0 Blocking).\n\n**\u{1D7D1} Prod branch and cherry-pick:** `prod-x`."));
    assert.deepEqual(r.sections.map((s) => [s.number, s.canonical]), [[1, "header"], [3, "prodBranch"]]);
  });

  it("a 200 000-item list is cut at once and cheaply", () => {
    const items = Array.from({ length: 200_000 }, () => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }));
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: HEAD }] }, { type: "bulletList", content: items }] };
    parse(doc);
    const t0 = performance.now();
    const r = parse(doc);
    const ms = performance.now() - t0;
    assert.ok(ms < 100, `${ms.toFixed(0)} ms`);
    assert.equal(r.truncated, true);
  });

  it("an ADF JSON string whose first text node is 2000 chars long is still recognised", () => {
    const body = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: HEAD + " " + "x".repeat(2000) }] }] });
    assert.equal(looksLikeRecord(body), true);
    assert.equal(parse(body).marker.pr, 2);
    const other = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello \u00e9 " + "x".repeat(2000) }] }] });
    assert.equal(looksLikeRecord(other), false);
  });

  it("testCount takes the first '<n> ... tests'; undo works with '=' ; 'No schema change.' is noSql without action", () => {
    const f = parse(text("**10 Backward compatibility:** same as today. Undo = set the flag off; restart.\n\n**12 Testing evidence:** 29 partner-banner tests, 247 suites; 12 tests pass.\n\n**7 Database:** No schema change.")).facts;
    assert.equal(f.testing!.testCount, 29);
    assert.equal(f.backwardCompat!.undo, "set the flag off");
    assert.deepEqual({ noSql: f.database!.noSql, hasAction: f.database!.hasAction }, { noSql: true, hasAction: false });
  });

  it("header without pipes, or with 'channelkart#1184 (open)', still gives key/repo/pr/date", () => {
    const a = parse("DEPLOYMENT-RECORD v2 CAV-7346 channelkart#1184 2026-11-19 11:30 Claude");
    assert.deepEqual([a.marker.version, a.marker.key, a.marker.repo, a.marker.pr, a.marker.at], [2, "CAV-7346", "channelkart", 1184, "2026-11-19T11:30:00.000Z"]);
    assert.equal(a.warnings.some((w) => w.code === "header_mismatch"), false);
    const b = parse("DEPLOYMENT-RECORD v1 | CAV-7346 | channelkart#1184 (open) | 2026-11-19 11:30 | Claude");
    assert.deepEqual([b.marker.repo, b.marker.pr, b.marker.at], ["channelkart", 1184, "2026-11-19T11:30:00.000Z"]);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeRecord, parseDeploymentRecord } from "./parse";
import { pickNewestPerPr, pickNewestRecords } from "./pick";
import { loadFixture, RECORD_FIXTURES, RECORD_FIXTURES_V2, UNION_FIXTURE } from "./testkit";
import type { ParsedRecord } from "./types";

const fx = loadFixture(UNION_FIXTURE);
/** The record text exactly as it sits in the one code block of the fixture. */
const T: string = (fx.body as { content: Array<{ content: Array<{ text: string }> }> }).content[0].content[0].text;

function parse(body: unknown, id: number | string = 1): ParsedRecord {
  const r = parseDeploymentRecord({ id, body, created: "2026-11-20T20:06:52.552+0000", updated: "2026-11-20T20:06:52.552+0000" });
  assert.ok(r);
  return r;
}
const real = () => parse(fx.body, 81643);

/** What every variant must agree on. */
function summary(r: ParsedRecord) {
  return {
    scope: r.marker.scope,
    covers: (r.facts.covers ?? []).map((c) => `${c.repo}#${c.pr} ${c.branch} ${c.sha}`),
    status: r.status,
    rows: (r.facts.releaseRows ?? []).map((x) => `${x.n}:${x.id}:${x.state}`),
    labels: (r.facts.labelled ?? []).map((b) => b.label),
    edges: r.facts.order?.edges,
    rollback: r.facts.order?.rollback,
    unknownOwners: r.unknowns.map((u) => u.owner),
  };
}

describe("free-form record in one code block (CAV-7280, comment 81643)", () => {
  const r = real();

  it("is detected, read as ordinary text, and flagged as info", () => {
    assert.equal(looksLikeRecord(fx.body), true);
    assert.deepEqual(r.warnings.map((w) => w.code), ["record_in_code_block"]);
    assert.deepEqual(r.sections, []);
    assert.equal(r.json, null);
    assert.ok(r.body && r.body.startsWith("DEPLOYMENT-RECORD v1 | CAV-7280"));
  });

  it("marker: union scope, free-text target, no repo/pr", () => {
    assert.deepEqual(
      { v: r.marker.version, key: r.marker.key, repo: r.marker.repo, pr: r.marker.pr, scope: r.marker.scope, target: r.marker.target, at: r.marker.at, agent: r.marker.agent, sup: r.marker.supersedes },
      { v: 1, key: "CAV-7280", repo: null, pr: null, scope: "union", target: "union of 2 merged PRs", at: "2026-11-20T20:06:00.000Z", agent: "Claude (pr-review)", sup: null },
    );
  });

  it("covers: the two merged PRs with branch, sha and note", () => {
    assert.deepEqual(r.facts.covers, [
      { repo: "slake-custom-reports", pr: 931, state: "merged", branch: "main", sha: "689b6d326c", note: "executor", approval: "all approved and merged by dev-b, 17 Nov; author Kunal-556" },
      { repo: "slake-reporting-config", pr: 1313, state: "merged", branch: "main", sha: "5c9b08cdf1", note: "4 ckcoedemo report configs", approval: "all approved and merged by dev-b, 17 Nov; author Kunal-556" },
    ]);
  });

  it("status HELD + PARTIAL reads as BLOCKED with the line as statusText", () => {
    assert.equal(r.status, "BLOCKED");
    assert.equal(r.statusText, "HELD in the DEMO movement (blocked) · PARTIAL");
    assert.equal(r.facts.summary, "ckcoedemo loading reports honour the selected Loadout Number");
  });

  it("23 release rows with canonical ids and states", () => {
    const rows = r.facts.releaseRows!;
    assert.equal(rows.length, 23);
    assert.deepEqual(rows.map((x) => x.n), Array.from({ length: 23 }, (_, i) => i + 1));
    assert.deepEqual(new Set(rows.map((x) => x.id)).size, 23); // every row has its own id
    const by = (n: number) => rows[n - 1];
    assert.deepEqual([by(1).id, by(1).state, by(1).text], ["meeting", "unknown", "release manager"]);
    assert.deepEqual([by(2).id, by(2).state, by(2).answer], ["services_deploy", "other", "Slake Reporting only (executor + configs)"]);
    assert.deepEqual([by(3).id, by(3).state], ["app_release", "not_required"]);
    assert.deepEqual([by(4).id, by(4).state], ["code_reviewed", "done"]);
    assert.deepEqual([by(6).id, by(6).state], ["new_app_old_data", "yes"]);
    assert.deepEqual([by(10).id, by(10).state], ["bundle_sdk", "no"]);
    assert.deepEqual([by(14).id, by(14).state], ["ui_indexdb", "not_required"]);
    assert.deepEqual([by(8).id, by(7).id], ["db_index", "db_queries"]);
    assert.deepEqual([by(16).id, by(16).state, by(17).id, by(17).state], ["automation_run", "unknown", "automation_updated", "unknown"]);
    assert.deepEqual([by(18).id, by(19).id, by(21).id], ["features_old_data", "beta_compat", "old_app_version"]);
    assert.deepEqual([by(20).id, by(20).state, by(22).id, by(22).state, by(23).id, by(23).state], ["designations", "not_done", "scenarios", "not_done", "cherry_pick", "unknown"]);
    // Row 11 continues over three indented lines.
    assert.deepEqual([by(11).id, by(11).state], ["configs_prod", "not_done"]);
    assert.equal(
      by(11).text,
      "param loadoutNumbers → loadout_number in dms_loading_sheet, dms_loadout_items, dms_loadout_items_without_batch, dms_loadout_items_filters (ckcoedemo). No new key.",
    );
    assert.deepEqual([by(12).id, by(12).state], ["services_restart", "other"]);
    assert.match(by(12).answer, /how: unknown, devops/);
  });

  it("unknown rows become unknowns with their owner; not-done rows become open items", () => {
    assert.deepEqual(
      r.unknowns.map((u) => [u.row, u.rowId, u.owner]),
      [[1, "meeting", "release manager"], [12, "services_restart", "devops"], [16, "automation_run", "QA"], [17, "automation_updated", "QA"], [23, "cherry_pick", "author, devops"]],
    );
    assert.equal(r.unknowns[0].text, "Production meeting + everyone invited unknown (release manager)");
    assert.deepEqual(r.facts.notDone!.map((x) => [x.n, x.id]), [[11, "configs_prod"], [20, "designations"], [22, "scenarios"]]);
  });

  it("labelled blocks: STATUS WHAT MERGED PRs LIKELY TO BE MISSED ORDER OPEN UNDO VERIFY", () => {
    const l = r.facts.labelled!;
    assert.deepEqual(l.map((b) => b.label), ["STATUS", "WHAT", "MERGED PRs", "LIKELY TO BE MISSED", "ORDER", "OPEN", "UNDO", "VERIFY"]);
    const likely = l.find((b) => b.label === "LIKELY TO BE MISSED")!;
    assert.equal(likely.lines.length, 3);
    assert.match(likely.lines[0], /^1\. Pick SEVERAL loadouts in the dropdown/);
    assert.match(likely.lines[2], /negative check\)$/);
    assert.match(l.find((b) => b.label === "MERGED PRs")!.text, /^\(all approved and merged by dev-b, 17 Nov; author Kunal-556\)/);
  });

  it("order, rollback and the other existing facts are fed from the dialect", () => {
    const o = r.facts.order!;
    assert.deepEqual(o.steps.map((s) => s.refs[0]), [
      { repo: "slake-custom-reports", pr: 931, written: "executor" },
      { repo: "slake-reporting-config", pr: 1313, written: "config" },
    ]);
    assert.deepEqual(o.edges, [{ before: "slake-custom-reports#931", after: "slake-reporting-config#1313" }]);
    assert.equal(o.structured, true);
    assert.equal(o.rollback, "revert both PRs");
    assert.deepEqual(r.facts.verification, ["Loading Sheet with one loadout returns only that loadout"]);
    assert.deepEqual(r.facts.deploy, [{ name: "Slake Reporting", note: "executor + configs" }]);
    assert.deepEqual(r.facts.restart, [{ name: "Slake Reporting", note: "executor reload; how: unknown, devops" }]);
    assert.equal(r.facts.bundleSdkBuild, "no");
    assert.deepEqual(r.facts.appRelease, { applicable: false, refs: [], section: 3 });
    assert.deepEqual(r.facts.database, { noSql: false, hasAction: false, items: [], sqlPaths: [], section: 7 });
    assert.deepEqual(r.facts.risks!.map((x) => [x.severity, x.text]), [
      ["Note", 'Pick SEVERAL loadouts in the dropdown (the PR says "unverified")'],
      ["Note", "Pick none: must still return all loadouts, as before"],
      ["Note", "ckcoe and ckcoeuat reports must be unchanged (negative check)"],
      ["Note", "multi-select dropdown not verified"],
    ]);
    assert.deepEqual(r.facts.configsText!.keys, ["loadout_number", "dms_loading_sheet", "dms_loadout_items", "dms_loadout_items_without_batch", "dms_loadout_items_filters"]);
    assert.equal(r.facts.configs, undefined); // never invented as config rows
    assert.equal(r.facts.cherryPick!.state, "unknown");
  });
});

describe("the same text in other shapes gives the same record", () => {
  const base = summary(real());
  const rowLines = T.split("\n");

  it("a markdown ``` fence, plain paragraphs, an ADF paragraph per line", () => {
    assert.deepEqual(summary(parse("```\n" + T + "\n```")), base);
    assert.equal(looksLikeRecord("```\n" + T + "\n```"), true);
    assert.deepEqual(summary(parse(T)), base);
    const doc = { type: "doc", content: rowLines.filter((l) => l.trim()).map((l) => ({ type: "paragraph", content: [{ type: "text", text: l }] })) };
    assert.deepEqual(summary(parse(doc)), base);
  });

  it("tabs instead of column gaps, and CRLF line ends", () => {
    assert.deepEqual(summary(parse(T.replace(/ {2,}/g, "\t"))), base);
    assert.deepEqual(summary(parse(T.replace(/\n/g, "\r\n"))), base);
    assert.deepEqual(summary(parse("```\r\n" + T.replace(/\n/g, "\r\n") + "\r\n```")), base);
  });

  it("only 5 rows: those rows are read, the others are simply absent", () => {
    const cut = rowLines.filter((l) => !/^\s{0,4}(?:[6-9]|1\d|2\d)\s{2,}/.test(l) && !/^ {6}\S/.test(l)).join("\n");
    const r = parse(cut);
    assert.deepEqual(r.facts.releaseRows!.map((x) => `${x.n}:${x.id}`), ["1:meeting", "2:services_deploy", "3:app_release", "4:code_reviewed", "5:previous_data"]);
    assert.deepEqual(r.facts.labelled!.length, 8);
    assert.equal(r.facts.notDone, undefined);
    assert.equal(r.facts.configsText, undefined);
  });

  it("labels in another order", () => {
    const i = rowLines.findIndex((l) => l.startsWith("ORDER"));
    const tail = rowLines.slice(i);
    const shuffled = [...rowLines.slice(0, i), tail[3], tail[2], tail[1], tail[0]].join("\n");
    const r = parse(shuffled);
    assert.deepEqual(r.facts.labelled!.map((b) => b.label).slice(-4), ["VERIFY", "UNDO", "OPEN", "ORDER"]);
    assert.deepEqual(summary(r).edges, base.edges);
    assert.equal(r.facts.order!.rollback, "revert both PRs");
  });

  it("an extra unknown label is kept as a labelled block and breaks nothing", () => {
    const r = parse(T + "\nRISK LEVEL   unknown (ops)\nGO NO GO\n   needs the release manager");
    assert.deepEqual(r.facts.labelled!.slice(-2).map((b) => [b.label, b.text]), [["RISK LEVEL", "unknown (ops)"], ["GO NO GO", "needs the release manager"]]);
    assert.equal(r.facts.releaseRows!.length, 23);
    assert.equal(r.facts.order!.rollback, "revert both PRs"); // the extra block does not swallow UNDO / VERIFY
    assert.equal(r.facts.verification!.length, 1);
  });

  it("a row without an answer, an unknown label, and a row number past 23", () => {
    const r = parse(T + "\n24  Something new   Done\n25  Cherry on top");
    const rows = r.facts.releaseRows!;
    assert.deepEqual(rows.slice(-2).map((x) => [x.n, x.id, x.state]), [[24, null, "done"], [25, "cherry_pick", "other"]]);
  });
});

describe("union and per-PR records side by side", () => {
  it("a per-PR record covers its own PR", () => {
    const r = parseDeploymentRecord(loadFixture("CAV-7346-81399"))!;
    assert.deepEqual(r.facts.covers, [{ repo: "channelkart", pr: 1184 }]);
    assert.equal(r.marker.scope, "pr");
    assert.equal(r.marker.target, undefined);
    assert.equal(r.body, undefined);
  });

  it("a numbered-section union record takes its covers from the header section", () => {
    const r = parse("DEPLOYMENT-RECORD v1 | CAV-1 | union of PRs | 2026-11-19 10:00 | bot\nsupersedes: none\n\n**1 Header:** Release of channelkart#10 and kpi-dashboard#11. Status READY (0 open Should-fix, 0 Blocking).\n\n**2 Branches and owners:** Siblings: channelkart-flutter#12 (open).");
    assert.deepEqual([r.marker.scope, r.marker.repo, r.marker.pr], ["union", null, null]);
    assert.deepEqual(r.facts.covers!.map((c) => `${c.repo}#${c.pr}`), ["channelkart#10", "kpi-dashboard#11", "channelkart-flutter#12"]);
    assert.equal(r.warnings.some((w) => w.code === "header_mismatch"), false);
    assert.equal(r.sections.length, 2);
  });

  const union = (id: number, v: number, prs: string[], opts: { key?: string; sup?: string; updated?: string } = {}) =>
    parseDeploymentRecord({
      id,
      updated: opts.updated ?? "2026-11-20T20:06:00.000+0000",
      created: "2026-11-20T20:06:00.000+0000",
      body: `DEPLOYMENT-RECORD v${v} | ${opts.key ?? "CAV-7280"} | union of ${prs.length} merged PRs | 2026-11-20 20:06 UTC | bot\nsupersedes: ${opts.sup ?? "none"}\n\nSTATUS   PARTIAL\nWHAT     x\nMERGED PRs (all merged)\n${prs.map((p) => `  ${p}   main   abcdef1234   note`).join("\n")}\n`,
    })!;
  const perPr = (id: number, v: number) =>
    parseDeploymentRecord({ id, created: "2026-11-20T20:06:00.000+0000", body: `DEPLOYMENT-RECORD v${v} | CAV-7280 | channelkart#5 | 2026-11-20 20:06 | bot\nsupersedes: none` })!;
  const ids = (rs: ParsedRecord[]) => rs.map((r) => r.comment.id);

  it("pickNewestRecords: the newest union of a ticket supersedes every older union of it; legacy per-PR records survive unless covered", () => {
    const a = union(10, 1, ["x#1", "y#2"]);
    const a2 = union(11, 1, ["y#2", "x#1"], { updated: "2026-11-20T21:00:00.000+0000" }); // same covers, edited/reposted later
    const b = union(8012, 1, ["z#3"], { updated: "2026-11-20T22:00:00.000+0000" }); // same version, OTHER PRs, newest
    const other = union(13, 1, ["x#1", "y#2"], { key: "CAV-9999" }); // another ticket: its own newest union
    // one newest union per ticket, whatever the covers
    assert.deepEqual(ids(pickNewestRecords([a, b, a2, other])).sort(), ["13", "8012"]);
    // a higher version wins over a later-posted lower version
    const c = union(14, 2, ["w#4"], { updated: "2026-11-20T19:00:00.000+0000" });
    assert.deepEqual(ids(pickNewestRecords([a, a2, b, c])), ["14"]);
    // per-PR legacy records: kept per PR, except those the ticket's newest union covers (the union wins)
    const p1 = perPr(1, 1); // channelkart#5 on CAV-7280
    const covers5 = union(20, 1, ["channelkart#5", "q#9"]);
    assert.deepEqual(ids(pickNewestRecords([p1, b])).sort(), ["1", "8012"], "union covers z#3 only: the per-PR record stays");
    assert.deepEqual(ids(pickNewestRecords([p1, covers5])), ["20"], "union covers channelkart#5: it wins for that PR");
    assert.deepEqual(ids(pickNewestRecords([p1, union(21, 1, ["channelkart#5"], { key: "CAV-9999" })])).sort(), ["1", "21"], "a union of another ticket does not cover it");
    // never dropped for lacking repo/pr, and pickNewestPerPr is unchanged
    assert.deepEqual(ids(pickNewestPerPr([a, p1, perPr(2, 2)])).sort(), ["10", "2"]);
    assert.equal(pickNewestRecords([a]).length, 1);
  });

  it("an older union naming a newer one in `supersedes` does not drop it; the newest wins", () => {
    const older = union(7020, 1, ["x#1"], { sup: "7021" });
    const newer = union(7021, 2, ["x#1"]);
    assert.deepEqual(ids(pickNewestRecords([older, newer])), ["7021"]);
    const sameVersion = union(7022, 1, ["m#1"], { updated: "2026-11-20T23:00:00.000+0000" });
    const namesNewer = union(7023, 1, ["n#1"], { sup: "7022" });
    assert.deepEqual(ids(pickNewestRecords([sameVersion, namesNewer])), ["7022"], "the later comment is the one review comment");
  });
});

describe("earlier fixtures are unaffected", () => {
  it("all 13 numbered-section records keep their sections, scope and no dialect fields", () => {
    for (const n of [...RECORD_FIXTURES, ...RECORD_FIXTURES_V2]) {
      const r = parseDeploymentRecord(loadFixture(n))!;
      assert.equal(r.sections.length, 14, n);
      assert.equal(r.marker.scope, "pr", n);
      for (const k of ["labelled", "releaseRows", "notDone", "configsText", "cherryPick"]) assert.equal(k in r.facts, false, `${n}.${k}`);
      assert.equal(r.body, undefined, n);
      assert.equal(r.warnings.some((w) => w.code === "record_in_code_block"), false, n);
      assert.deepEqual(r.facts.covers, [{ repo: r.marker.repo, pr: r.marker.pr }], n);
    }
  });
});

describe("free-form record: pathological input", () => {
  const timeIt = (body: unknown): number => {
    let ms = Infinity;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      parse(body);
      ms = Math.min(ms, performance.now() - t0);
    }
    return ms;
  };
  const wrap = (rows: string) => `${T}\n${rows}`;
  const cases: Record<string, string> = {
    "50 KB of spaces in a row": " 30  " + " ".repeat(50_000) + "x\n 31  a" + " ".repeat(50_000),
    "50 KB of digits": " 30  " + "1".repeat(50_000) + "\n 31  " + "9".repeat(50_000),
    "2000 label lines": "STATUS   x\n".repeat(2000),
    "2000 numbered rows": Array.from({ length: 2000 }, (_, i) => `${(i % 99) + 1}  label   Done`).join("\n"),
    "capital letters": "A".repeat(50_000) + "\n" + "A ".repeat(25_000),
    "tab soup": "\t \t\n".repeat(20_000),
    "parens": " 30  x   " + "(".repeat(50_000),
    "2000 PR lines": "MERGED PRs (x)\n" + "  repo#1   main   abcdef1234   note\n".repeat(2000),
    "PR group labels": "STILL OPEN:\nREVERTED (do not deploy as features):\nSTACK BRANCHES\n".repeat(700),
    "unknown parens": " 12  x   how: unknown " + "(unknown ".repeat(5000),
    "50 KB PR line": "MERGED PRs (x)\n  repo#1" + " ".repeat(50_000) + "main\n",
    "key lines": " 11  Configs   Not Done\n" + "      some.key.name   default: x   prod: y\n".repeat(2000),
  };
  for (const [name, rows] of Object.entries(cases)) {
    it(`${name}: under 150 ms, both as a code block and as plain text`, () => {
      const adf = { type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: wrap(rows) }] }] };
      assert.ok(timeIt(adf) < 150, `${name}/code`);
      assert.ok(timeIt(wrap(rows)) < 150, `${name}/text`);
      const r = parse(wrap(rows));
      assert.ok(r.facts.releaseRows!.length <= 60);
      assert.ok(r.facts.labelled!.length <= 40);
      assert.ok(r.body!.length <= 20_000);
    });
  }
});

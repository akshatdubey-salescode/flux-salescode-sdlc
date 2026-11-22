/** The v2 deployment record spec (Confluence page 2450096131): union of merged PRs, 23 rows, blocks. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeRecord, parseDeploymentRecord } from "./parse";
import { pickNewestRecords } from "./pick";
import { loadText } from "./testkit";
import type { ParsedRecord } from "./types";

const T = loadText("CAV-7300-union");
const parse = (body: unknown, id: number | string = 81800): ParsedRecord => parseDeploymentRecord({ id, body, created: "2026-11-21T09:30:00.000+0000" })!;
const keys = (cs: Array<{ repo: string; pr: number }> | undefined) => (cs ?? []).map((c) => `${c.repo}#${c.pr}`);

describe("CAV-7300-like union record (17 merged PRs)", () => {
  const r = parse(T);

  it("marker: union, declared count, supersedes list with all ids", () => {
    assert.deepEqual([r.marker.scope, r.marker.version, r.marker.key, r.marker.repo, r.marker.pr, r.marker.declaredPrs], ["union", 3, "CAV-7300", null, null, 17]);
    assert.deepEqual(r.marker.supersedesAll, ["81643", "81700", "81701"]);
    assert.deepEqual(r.marker.supersedes!.commentIds, ["81643", "81700", "81701"]);
    assert.equal(r.marker.supersedes!.commentId, "81643"); // the first, for compatibility
  });

  it("covers hold ONLY the 17 merged PRs, and the count matches the header", () => {
    const c = r.facts.covers!;
    assert.equal(c.length, 17);
    assert.equal(r.warnings.some((w) => w.code === "covers_count_mismatch"), false);
    assert.deepEqual(c[0], { repo: "channelkart", pr: 1346, state: "merged", branch: "master", sha: "1a2b3c4d5e", note: "distributor status filter (post-page filter fix)" });
    // Open, reverted and stack-branch PRs are named elsewhere, never counted.
    const all = keys(c);
    for (const other of ["channelkart#1399", "kpi-dashboard#301", "channelkart-bundle#269", "kpi-dashboard#288", "slake-custom-reports#985", "slake-reporting-config#1370", "channelkart-flutter#58", "channelkart-flutter#59"]) {
      assert.equal(all.includes(other), false, other);
    }
    assert.ok(c.every((x) => x.state === "merged" && /^[0-9a-f]{10}$/.test(x.sha!)));
  });

  it("approval: per PR 'no formal approval', header text only when it states approval", () => {
    const no = r.facts.covers!.filter((x) => x.approval === "no formal approval");
    assert.deepEqual(keys(no), ["channelkart#1352", "channelkart-bundle#283", "slake-reporting-config#1365"]);
    const b = parse("DEPLOYMENT-RECORD v1 | KK-1 | union of 2 merged PRs | 2026-11-21 09:30 UTC | a\nsupersedes: none\n\nSTATUS   READY\nWHAT     x\nMERGED PRs (no formal approval)\n  a#1   main   abcdef1234   one\n  b#2   main   abcdef1235   two\n");
    assert.deepEqual(b.facts.covers!.map((x) => x.approval), ["no formal approval", "no formal approval"]);
  });

  it("the other PR groups: still open, reverted (do not deploy), stack branches only", () => {
    assert.deepEqual(keys(r.facts.stillOpen), ["channelkart#1399", "kpi-dashboard#301"]);
    assert.deepEqual(r.facts.stillOpen![0], { repo: "channelkart", pr: 1399, state: "open", branch: "master", note: "retry for the outlet download" });
    assert.deepEqual(keys(r.facts.reverted), ["channelkart-bundle#269", "kpi-dashboard#288", "slake-custom-reports#985", "slake-reporting-config#1370"]);
    assert.deepEqual(keys(r.facts.stackOnly), ["channelkart-flutter#58", "channelkart-flutter#59"]);
    assert.equal(r.facts.stackOnly![0].branch, "stack/cav-7300-app");
    assert.deepEqual(r.facts.labelled!.map((b) => b.label).slice(2, 6), ["MERGED PRs", "STILL OPEN", "REVERTED", "MERGED INTO STACK BRANCHES ONLY"]);
  });

  it("a merged line whose base is a stack branch is not a cover; stray refs in free text never are", () => {
    const x = parse("DEPLOYMENT-RECORD v1 | KK-1 | union of 2 merged PRs | 2026-11-21 09:30 UTC | a\nsupersedes: none\n\nSTATUS   READY\nWHAT     see also channelkart#9999 which is not part of this\n\nMERGED PRs (all approved)\n  a#1   master   abcdef1234   one\n  b#2   stack/x   abcdef1235   two\n");
    assert.deepEqual(keys(x.facts.covers), ["a#1"]);
    assert.deepEqual(keys(x.facts.stackOnly), ["b#2"]);
    assert.equal(keys(x.facts.covers).includes("channelkart#9999"), false);
    assert.equal(x.warnings.find((w) => w.code === "covers_count_mismatch")?.count, 1); // declared 2, listed 1
  });

  it("labels in any case and tolerant spellings", () => {
    const body = `DEPLOYMENT-RECORD v1 | KK-1 | union of 1 merged PRs | 2026-11-21 09:30 UTC | a\nsupersedes: none\n\nSTATUS   HELD\nWHAT     x\nMERGED PRs (merged by x)\n  a#1   main   abcdef1234   one\n\nOpen PRs:\n  b#2   main   -   two\n\nDo not deploy as features:\n  c#3   main   abcdef1237   three\n\nSTACK BRANCHES\n  d#4   stack/y   abcdef1238   four\n`;
    const x = parse(body);
    assert.deepEqual([keys(x.facts.covers), keys(x.facts.stillOpen), keys(x.facts.reverted), keys(x.facts.stackOnly)], [["a#1"], ["b#2"], ["c#3"], ["d#4"]]);
    assert.equal(x.facts.stillOpen![0].sha, undefined); // "-" is a placeholder, not a commit
  });
});

describe("rows, owners and blocks of the v2 spec", () => {
  const r = parse(T);

  it("status word and reason; likely-to-be-missed title normalised with numbered points", () => {
    assert.deepEqual([r.facts.statusWord, r.facts.statusReason, r.status], ["PARTIAL", "(4 merged PRs are reverted; prod values unknown)", "PARTIAL"]);
    const b = r.facts.labelled!.find((x) => x.label === "LIKELY TO BE MISSED")!;
    assert.equal(b.written, "LIKELY TO BE MISSED IN TESTING");
    assert.equal(b.lines.length, 5);
    assert.deepEqual(r.facts.likelyMissed!.map((p) => p.n), [1, 2, 3, 4, 5]);
    assert.equal(r.facts.likelyMissed![1].text, "A distributor user calls the outlet API directly: must be refused with 403");
    assert.equal(r.facts.risks!.filter((x) => x.severity === "Note").length, 6); // 5 points + OPEN
  });

  it("HELD plus reason in the worked example (81643 shape)", () => {
    const h = parse("DEPLOYMENT-RECORD v1 | KK-1 | union of 1 merged PRs | 2026-11-21 09:30 UTC | a\nsupersedes: none\n\nSTATUS   HELD in the DEMO movement (blocked) · PARTIAL\nWHAT     x\nMERGED PRs (a)\n  a#1   main   abcdef1234   one\n");
    assert.deepEqual([h.facts.statusWord, h.facts.statusReason, h.status], ["HELD", "in the DEMO movement (blocked) · PARTIAL", "BLOCKED"]);
    assert.equal(parse(T.replace("PARTIAL (4", "READY (4")).facts.statusWord, "READY");
  });

  it("test owners per area, kept raw in labelled; 'unknown' when stated so; none when absent", () => {
    assert.deepEqual(r.facts.testOwners, [
      { area: "Reports", owner: "Chirag & Hemant" },
      { area: "Claims", owner: "unknown" },
      { area: "Loyalty", owner: "Priya" },
    ]);
    assert.equal(r.facts.labelled!.find((b) => b.label === "TEST OWNERS")!.text, "Reports - Chirag & Hemant; Claims - unknown; Loyalty - Priya");
    const mixed = parse(T.replace(/TEST OWNERS {3}.*/, "Test owner per area: Reports - A\n  Claims - B"));
    assert.deepEqual(mixed.facts.testOwners, [{ area: "Reports", owner: "A" }, { area: "Claims", owner: "B" }]);
    assert.deepEqual(parse(T.replace(/TEST OWNERS {3}.*/, "Owners: unknown")).facts.testOwners, [{ area: null, owner: "unknown" }]);
    assert.equal(parse(T.replace(/TEST OWNERS {3}.*\n/, "")).facts.testOwners, undefined);
  });

  it("row 2 service tick list over several lines; extras", () => {
    assert.deepEqual(r.facts.deploy!.map((s) => s.name), ["Channel Kart", "Channelkart Bundle", "KPI Dashboard - UI", "Stock", "saleslens", "auth service", "Flutter app"]);
    const one = parse(T.replace(/Channel Kart, Channelkart Bundle,\n.*\n.*saleslens, auth service, Flutter app/, "Slake Reporting only (executor + configs)"));
    assert.deepEqual(one.facts.deploy, [{ name: "Slake Reporting", note: "executor + configs" }]);
    const semi = parse(T.replace(/Channel Kart, Channelkart Bundle,\n.*\n.*saleslens, auth service, Flutter app/, "Channel Kart, Channelkart Bundle; extras: saleslens"));
    assert.deepEqual(semi.facts.deploy!.map((s) => s.name), ["Channel Kart", "Channelkart Bundle", "saleslens"]);
  });

  it("row 11: each 'key  default: x  prod: y' line is a config row; keys listed; raw kept", () => {
    assert.deepEqual(r.facts.configs!.map((c) => [c.key, c.default, c.prod, c.source]), [
      ["distributor.status.filter.enabled", "off", "not set", "text"],
      ["outlet.download.page.size", "500", "unknown", "text"],
      ["green.config.distributor.designations", "supplier,subd,ss", "supplier,subd,ss", "text"],
    ]);
    assert.deepEqual(r.facts.configsText!.keys, ["distributor.status.filter.enabled", "outlet.download.page.size", "green.config.distributor.designations"]);
    const row = r.facts.releaseRows![10];
    assert.deepEqual([row.id, row.state, row.lines!.length], ["configs_prod", "not_done", 4]);
    // Lines that are not cleanly `key  default  prod: state` stay raw.
    const raw = parse(T.replace(/ {6}distributor\.status.*\n.*\n.*\n/, "      set distributor_status_filter and outlet_page_size on prod first\n"));
    assert.equal(raw.facts.configs, undefined);
    assert.deepEqual(raw.facts.configsText!.keys, ["distributor_status_filter", "outlet_page_size"]);
    assert.deepEqual(raw.facts.releaseRows![10].lines!.length, 2);
  });

  it("unknown (owner) and 'unknown, owner to confirm: who' both become unknowns with the owner", () => {
    const owners = new Map(r.unknowns.filter((u) => u.row !== undefined).map((u) => [u.row, u.owner]));
    assert.deepEqual([owners.get(1), owners.get(3), owners.get(7), owners.get(12), owners.get(16), owners.get(19), owners.get(23)], ["release manager", "mobile lead", "author", "devops", "QA", "mobile lead", "author, devops"]);
    const x = parse(T.replace("Done (pointer reset for the 3 reports)", "Done (reload; backfill: unknown, owner to confirm: author)"));
    assert.ok(x.unknowns.some((u) => u.row === 5 && u.owner === "author"));
    // The row-12 unknown is reported once.
    assert.equal(r.unknowns.filter((u) => u.row === 12).length, 1);
    assert.equal(r.facts.restart!.map((s) => s.name).join("|"), "Slake Reporting|Channel Kart");
    assert.equal(r.facts.restart![0].note, "executor reload; how: unknown (devops)");
  });

  it("rows 20, 22, 23: roles, 'Not Done: see below', owners and the prod branch from the catalogue", () => {
    const rows = r.facts.releaseRows!;
    assert.equal(rows.length, 23);
    assert.deepEqual([rows[19].id, rows[19].state, rows[21].id, rows[21].state, rows[21].text, rows[22].id, rows[22].state], ["designations", "not_done", "scenarios", "not_done", "see below", "cherry_pick", "unknown"]);
    assert.deepEqual(r.facts.roles, [{ who: null, what: "salesman (allowed), distributor user (refused by the API)", negative: false }]);
    assert.deepEqual(r.facts.prodBranch, { branch: "prod_blue_21_sep_2026_branch" });
    assert.deepEqual(r.facts.notDone!.map((x) => x.n), [11, 15, 20, 22]);
  });

  it("order from the ORDER line, rollback, verification", () => {
    assert.deepEqual(r.facts.order!.edges.map((e) => `${e.before} > ${e.after}`), [
      "channelkart#1346 > channelkart-bundle#281",
      "channelkart-bundle#281 > kpi-dashboard#291",
      "kpi-dashboard#291 > channelkart-flutter#55",
    ]);
    assert.equal(r.facts.order!.rollback, "set distributor.status.filter.enabled off; redeploy previous executor");
    assert.equal(r.facts.verification!.length, 2);
  });
});

describe("the same record in other shapes", () => {
  const sum = (r: ParsedRecord) => ({
    covers: keys(r.facts.covers),
    open: keys(r.facts.stillOpen),
    rev: keys(r.facts.reverted),
    stack: keys(r.facts.stackOnly),
    rows: r.facts.releaseRows!.map((x) => `${x.n}:${x.id}:${x.state}`),
    owners: r.facts.testOwners,
    likely: r.facts.likelyMissed!.length,
    configs: r.facts.configs!.map((c) => c.key),
    unknown: r.unknowns.map((u) => u.owner),
    all: r.marker.supersedesAll,
  });
  const base = sum(parse(T));

  it("CRLF, a markdown code fence, an ADF codeBlock, an ADF paragraph per line, tabs", () => {
    assert.deepEqual(sum(parse(T.replace(/\n/g, "\r\n"))), base);
    assert.deepEqual(sum(parse("```\n" + T + "\n```")), base);
    assert.equal(looksLikeRecord("```\n" + T + "\n```"), true);
    assert.deepEqual(sum(parse({ type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: T }] }] })), base);
    assert.deepEqual(sum(parse({ type: "doc", content: T.split("\n").filter((l) => l.trim()).map((l) => ({ type: "paragraph", content: [{ type: "text", text: l }] })) })), base);
    assert.deepEqual(sum(parse(T.replace(/ {3,}/g, "\t"))), base);
  });

  it("count mismatch is reported as info and does not change the covers", () => {
    const x = parse(T.replace("union of 17 merged PRs", "union of 18 merged PRs"));
    const w = x.warnings.find((y) => y.code === "covers_count_mismatch")!;
    assert.deepEqual([x.marker.declaredPrs, x.facts.covers!.length, w.count], [18, 17, 17]);
    assert.match(w.message, /union of 18 merged PRs.*17 merged PR/);
  });
});

describe("supersedes lists and the 3-version chain", () => {
  const rec = (id: number, v: number, sup: string, updated = "2026-11-21T09:30:00.000+0000") =>
    parseDeploymentRecord({ id, updated, created: updated, body: `DEPLOYMENT-RECORD v${v} | CAV-7300 | union of 1 merged PRs | 2026-11-21 09:30 UTC | a\nsupersedes: ${sup}\n\nSTATUS   READY\nWHAT     x\nMERGED PRs (a)\n  a#1   main   abcdef1234   one\n` })!;

  it("ids separated by commas, spaces, 'and', with versions and brackets", () => {
    const all = (s: string) => rec(1, 1, s).marker.supersedesAll;
    assert.deepEqual(all("81643, 81700 and 81701"), ["81643", "81700", "81701"]);
    assert.deepEqual(all("81643 81700"), ["81643", "81700"]);
    assert.deepEqual(all("v1, v2"), ["v1", "v2"]);
    assert.deepEqual(all("81643 (v1) and 81700"), ["81643", "v1", "81700"]);
    assert.deepEqual(all("#81643; #81700"), ["81643", "81700"]);
    assert.equal(rec(1, 1, "none").marker.supersedesAll, undefined);
    assert.equal(rec(1, 1, "channelkart #1184").marker.supersedes!.commentIds.length, 0); // a PR, not a comment id
  });

  it("pickNewestRecords: v3 naming both older comments leaves only v3; one id each keeps the chain consistent", () => {
    const v1 = rec(81643, 1, "none");
    const v2 = rec(81700, 2, "81643");
    const v3 = rec(81701, 3, "81643, 81700");
    assert.deepEqual(pickNewestRecords([v1, v2, v3]).map((x) => x.comment.id), ["81701"]);
    assert.deepEqual(pickNewestRecords([v3, v1, v2]).map((x) => x.comment.id), ["81701"]);
    // Same version, newer by time, the supersedes line names two older ids.
    const a = rec(90001, 1, "none", "2026-11-21T08:00:00.000+0000");
    const b = rec(90002, 1, "none", "2026-11-21T08:10:00.000+0000");
    const c = rec(90003, 1, "90001 and 90002", "2026-11-21T08:20:00.000+0000");
    assert.deepEqual(pickNewestRecords([a, b, c]).map((x) => x.comment.id), ["90003"]);
  });
});

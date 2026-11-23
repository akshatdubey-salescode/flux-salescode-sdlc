import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChecklist } from "./build";
import { hashChecklist } from "./diff";
import { renderText, toRows } from "./render";
import { decodeSnapshot, encodeSnapshot } from "./snapshot";
import { jira, realJiras, synth, unionJira, unionRecord } from "./testkit";
import { SECTIONS, type Checklist, type ChecklistItem, type ChecklistJiraInput, type SectionId } from "./types";
import { parseDeploymentRecord, type ParsedRecord } from "../record";
import { loadText } from "../record/testkit";

const sec = (cl: Checklist, id: SectionId) => (cl.sections.find((s) => s.id === id) as Checklist["sections"][number]).items;
const get = (cl: Checklist, id: SectionId, key: string): ChecklistItem => {
  const hit = sec(cl, id).find((i) => i.key === key);
  assert.ok(hit, `${id}/${key} missing; have ${sec(cl, id).map((i) => i.key).join(" | ")}`);
  return hit;
};
const build = (jiras = [unionJira()], environment: "demo" | "uat" | "prod" = "demo") => buildChecklist({ environment, jiras, branches: [] });

/** A copy of the real union record with another comment id and a mutated release row. */
function variant(id: number, mutate: (r: ParsedRecord) => void): ParsedRecord {
  const r: ParsedRecord = JSON.parse(JSON.stringify(unionRecord()));
  r.comment.id = String(id);
  mutate(r);
  return r;
}
const setRow = (r: ParsedRecord, rowId: string, state: string, answer: string, text = "") => {
  const row = (r.facts.releaseRows ?? []).find((x) => x.id === rowId);
  assert.ok(row);
  Object.assign(row, { state, answer, text });
};

describe("CAV-7280 free-form union record (comment 81643)", () => {
  const demo = build();
  const prod = build([unionJira()], "prod");
  const K = "slake-custom-reports#931,slake-reporting-config#1313";

  it("keeps the 14 sections and shows the header: what, review status, release-manager row", () => {
    assert.deepEqual(demo.sections.map((s) => s.id), SECTIONS.map((s) => s.id));
    assert.equal(get(demo, "header", `rec:union:${K}`).text, "union of 2 merged PRs: ckcoedemo loading reports honour the selected Loadout Number");
    const st = get(demo, "header", `status:${K}`);
    assert.equal(st.text, "Review status: HELD in the DEMO movement (blocked) · PARTIAL");
    assert.deepEqual([st.severity, st.needsAttention], ["warn", true]); // HELD
    const m = get(demo, "header", "row:meeting");
    assert.equal(m.text, "Production meeting + everyone invited: Unknown (release manager)");
    assert.deepEqual([m.severity, m.needsAttention], ["warn", true]);
  });

  it("lists the two merged PRs and the merge note under branches", () => {
    assert.equal(get(demo, "branches", "cover:slake-custom-reports#931").text, "slake-custom-reports#931 main 689b6d326c executor [merged]");
    assert.equal(get(demo, "branches", "cover:slake-reporting-config#1313").text, "slake-reporting-config#1313 main 5c9b08cdf1 4 ckcoedemo report configs [merged]");
    assert.ok(sec(demo, "branches").some((i) => /^Merged PRs: all approved and merged by dev-b/.test(i.text)));
    assert.match(get(demo, "branches", "row:code_reviewed").text, /^Code reviewed, no breakage other LOBs: Done ckcoedemo only/);
  });

  it("row 11 (configs to add in prod): Not done with the keys as chips; attention on PROD only", () => {
    const p = get(prod, "configs", "row:configs_prod");
    assert.match(p.text, /^Configs to add in prod: Not done param loadoutNumbers/);
    assert.deepEqual(p.chips, ["loadout_number", "dms_loading_sheet", "dms_loadout_items", "dms_loadout_items_without_batch", "dms_loadout_items_filters"]);
    assert.deepEqual([p.severity, p.needsAttention], ["warn", true]);
    const d = get(demo, "configs", "row:configs_prod");
    assert.deepEqual([d.severity, d.needsAttention], [undefined, undefined]);
    assert.ok(prod.stats.needsAttention === demo.stats.needsAttention + 1);
    assert.deepEqual(get(build([unionJira()], "uat"), "configs", "row:configs_prod").needsAttention, undefined);
  });

  it("puts every release-page row in its section with the right severity", () => {
    assert.match(get(demo, "restart", "row:services_restart").text, /^Services to restart: Slake Reporting \(executor reload; how: unknown, devops\)$/);
    assert.match(get(demo, "deploy", "row:services_deploy").text, /^Services to deploy: Slake Reporting only/);
    assert.equal(get(demo, "deploy", "row:bundle_sdk").text, "Bundle SDK build required: No");
    for (const k of ["row:automation_run", "row:automation_updated"]) {
      const i = get(demo, "testing", k);
      assert.match(i.text, /: Unknown \(QA\)$/);
      assert.deepEqual([i.severity, i.needsAttention], ["warn", true]);
    }
    assert.equal(get(demo, "testing", "row:scenarios").text, "Scenarios to be tested: Not done see below");
    assert.equal(get(demo, "roles", "row:designations").severity, "warn");
    assert.equal(get(demo, "prodBranch", "row:cherry_pick").needsAttention, true);
    // every database row says "no / none": ONE "No database change" line, not four rows
    assert.equal(get(demo, "database", "db:none").text, "No database change");
    assert.equal(sec(demo, "database").filter((i) => i.key.startsWith("row:")).length, 0);
    assert.equal(get(demo, "compat", "row:new_app_old_data").severity, undefined);
  });

  it("collapses 'Not required' rows into one item per section", () => {
    assert.equal(get(demo, "appRelease", "notreq:appRelease").text, "Not required: App release, Test old version of existing app");
    assert.equal(sec(demo, "database").filter((i) => i.key.startsWith("notreq:")).length, 0, "the database rows are one \"No database change\" line");
    assert.equal(get(demo, "testing", "notreq:testing").text, "Not required: Performance testing (filter fix)");
    assert.equal(get(demo, "branches", "notreq:branches").text, "Not required: Bundle code reviewed, UI code reviewed");
    assert.equal(sec(demo, "appRelease").filter((i) => i.key.startsWith("row:")).length, 0);
  });

  it("shows the labelled blocks: likely-to-be-missed notes, the open note, order, rollback, verify, with no duplicates", () => {
    const missed = sec(demo, "testing").filter((i) => i.text.startsWith("Likely to be missed: "));
    assert.equal(missed.length, 3);
    assert.ok(missed.every((i) => i.label === "Note" && i.severity === undefined));
    assert.match(missed[0].text, /Pick SEVERAL loadouts in the dropdown/);
    const open = get(demo, "risks", "open:multi select dropdown not verified");
    assert.equal(open.text, "Open: multi-select dropdown not verified");
    assert.equal(sec(demo, "risks").length, 1); // the parser's risk copies of those lines are not shown twice
    const seq = (k: string) => get(demo, "order", `step:pr:${k}`).seq as number;
    assert.ok(seq("slake-custom-reports#931") < seq("slake-reporting-config#1313"));
    assert.equal(get(demo, "order", "rollback:CAV-7280:revert both prs").text, "Rollback: revert both PRs");
    assert.equal(sec(demo, "verify")[0].text, "Loading Sheet with one loadout returns only that loadout");
    assert.ok(!sec(demo, "risks").some((i) => /^Other:/.test(i.text)));
  });

  it("an unknown label block is kept as a raw 'Other:' item", () => {
    const r = variant(81650, (x) => x.facts.labelled?.push({ label: "ROLLOUT NOTE", text: "do it after 6 pm", lines: ["do it after 6 pm"] }));
    const cl = build([unionJira({ records: [r] })]);
    const o = sec(cl, "risks").find((i) => i.text === "Other: ROLLOUT NOTE: do it after 6 pm");
    assert.ok(o?.raw);
  });

  it("feeds unknownsByOwner once per row (release manager, QA x2, author+devops) and counts PRs, not comments", () => {
    assert.deepEqual(demo.unknownsByOwner.map((g) => [g.owner, g.items.length]), [["author, devops", 1], ["devops", 1], ["qa", 2], ["release manager", 1]]);
    assert.equal(demo.stats.unknowns, 5);
    // an unknown row the parser did not report still reaches the list, once
    const bare = variant(81651, (x) => (x.unknowns = []));
    const cl = build([unionJira({ records: [bare] })]);
    assert.equal(cl.stats.unknowns, 4); // row 12's "how: unknown (devops)" is only reported by the parser's own unknown
    assert.deepEqual(cl.unknownsByOwner.map((g) => g.owner).sort(), ["author, devops", "qa", "release manager"]);
    assert.equal(demo.stats.prs, 2);
    assert.equal(demo.stats.comments, 1);
    assert.match(demo.summary, /^2 PRs \(1 review comment\), 0 conflicts, 7 need attention, 5 unknowns$/);
  });

  it("sources are {jira, 'union'} with the PR count; no comment id anywhere; rendering says 'review comment (2 PRs)'", () => {
    const src = get(demo, "restart", "row:services_restart").sources[0];
    assert.deepEqual([src.jira, src.pr, src.n], ["CAV-7280", "union", 2]);
    assert.deepEqual(src.covers, ["slake-custom-reports#931", "slake-reporting-config#1313"]);
    assert.ok(!JSON.stringify(demo).includes("81643"));
    assert.match(renderText(demo), /Production meeting \+ everyone invited: Unknown \(release manager\) \[CAV-7280: review comment \(2 PRs\)\]/);
    assert.equal(get(demo, "order", "step:pr:slake-custom-reports#931").sources[0].n, 2);
    const rows = toRows(prod);
    assert.equal(rows.find((r) => r.item === "row:configs_prod")?.flags, "WARN; NEEDS ATTENTION");
    assert.ok(rows.some((r) => r.item === "notreq:appRelease"));
  });

  it("a different comment id with the same text is the same checklist; a changed row answer changes the hash", () => {
    const again = build([unionJira({ records: [variant(99999, () => undefined)] })]);
    assert.equal(again.hash, demo.hash);
    const changed = build([unionJira({ records: [variant(99998, (r) => setRow(r, "configs_prod", "done", "Done: added", "added"))] })]);
    assert.notEqual(changed.hash, demo.hash);
    assert.equal(get(changed, "configs", "row:configs_prod").text, "Configs to add in prod: Done added");
    const two = [unionJira({ records: [variant(1, () => undefined)] }), unionJira({ key: "CAV-7281", records: [variant(2, (r) => setRow(r, "performance", "yes", "Yes", ""))] })];
    assert.equal(build(two).hash, build([...two].reverse()).hash);
  });

  it("round-trips through the snapshot", () => {
    const back = decodeSnapshot(encodeSnapshot(prod));
    assert.deepEqual(back, prod);
    assert.equal(hashChecklist(back), prod.hash);
  });
});

describe("release-page rows across records", () => {
  it("different Jiras answer a row for themselves: aggregated per Jira, never a conflict; a Jira's own unknown does not hide its answer", () => {
    const same = variant(2, () => undefined);
    const known = variant(3, (r) => setRow(r, "meeting", "done", "Done: held 20 Nov", "held 20 Nov"));
    const cl = build([unionJira({ records: [unionRecord()] }), unionJira({ key: "CAV-7281", records: [same] }), unionJira({ key: "CAV-7282", records: [known] })]);
    assert.equal(sec(cl, "restart").filter((i) => i.key === "row:services_restart").length, 1);
    assert.deepEqual(get(cl, "restart", "row:services_restart").sources.map((x) => x.jira), ["CAV-7280", "CAV-7281", "CAV-7282"]);
    assert.equal(get(cl, "header", "row:meeting").text, "Production meeting + everyone invited: Unknown \u2014 Unknown: CAV-7280, CAV-7281 (release manager) \u00b7 Done: CAV-7282 \u2014 held 20 Nov");
    assert.equal(cl.conflicts.length, 0);
    assert.ok(cl.unknownsByOwner.some((g) => g.owner === "release manager"));
    // identical answers everywhere stay one plain phrase
    assert.equal(get(cl, "database", "db:none").text, "No database change");

    const other = variant(4, (r) => setRow(r, "services_deploy", "not_required", "Not required", ""));
    const cl2 = build([unionJira({ records: [unionRecord()] }), unionJira({ key: "CAV-7281", records: [other] })]);
    assert.equal(cl2.conflicts.length, 0);
    assert.equal(get(cl2, "deploy", "row:services_deploy").text, "Services to deploy: Slake Reporting only (executor + configs) (CAV-7280) \u00b7 Not required: CAV-7281");
  });

  it("of two review comments on one Jira only the newest feeds the checklist, whatever the input order", () => {
    const older = variant(100, (r) => setRow(r, "configs_prod", "done", "Done: old", "old"));
    const newer = variant(200, (r) => {
      r.marker.version = 2;
      setRow(r, "configs_prod", "not_done", "Not Done: new", "new");
    });
    const a = build([unionJira({ records: [older, newer] })], "prod");
    const b = build([unionJira({ records: [newer, older] })], "prod");
    assert.equal(a.hash, b.hash);
    assert.match(get(a, "configs", "row:configs_prod").text, /Not done new$/);
    assert.equal(a.conflicts.length, 0);
    assert.ok(a.warnings.some((w) => w.code === "older_review_comment_ignored"));
    assert.equal(a.stats.comments, 1);
  });

  it("a union Jira and per-PR Jiras in one movement: PRs are distinct PRs covered, comments are counted apart", () => {
    const cl = buildChecklist({ environment: "prod", branches: [], jiras: [unionJira(), ...realJiras()] });
    assert.equal(cl.stats.prs, 9);
    assert.equal(cl.stats.comments, 8);
    assert.match(cl.summary, /^9 PRs \(8 review comments\)/);
    assert.deepEqual(cl.scope.jiras.find((j) => j.jira === "CAV-7280")?.prs, ["slake-custom-reports#931", "slake-reporting-config#1313"]);
  });

  it("a record without repo or PR does not crash and never uses its comment id", () => {
    const r = synth({ pr: 1, id: 424242, facts: { risks: [{ severity: "Nitpick", text: "x risk", source: "text" }] } });
    r.marker.repo = null;
    r.marker.pr = null;
    const cl = build([jira("CAV-1", [r])], "prod");
    assert.ok(!JSON.stringify(cl).includes("424242"));
    assert.equal(get(cl, "risks", "risk:x risk").sources[0].pr, "(no PR)");
  });

  it("row answers are spreadsheet-safe in the rows", () => {
    const r = variant(7, (x) => setRow(x, "designations", "other", "=HYPERLINK(\"x\")", "=HYPERLINK(\"x\")"));
    const cl = build([unionJira({ records: [r] })]);
    for (const row of toRows(cl)) for (const v of [row.section, row.item, row.text, row.sources, row.envValue, row.flags]) assert.ok(!/^[=+\-@\t\r]/.test(v), v);
  });
});

describe("template v2: CAV-7300-like union record (17 merged PRs)", () => {
  const body = loadText("CAV-7300-union");
  const rec = (id: number, version = 3, mutate?: (b: string) => string): ParsedRecord => {
    const text = (mutate ? mutate(body) : body).replace("DEPLOYMENT-RECORD v3", `DEPLOYMENT-RECORD v${version}`);
    const r = parseDeploymentRecord({ id, body: text, created: `2026-11-21T09:${10 + (id % 40)}:00.000+0000`, updated: `2026-11-21T09:${10 + (id % 40)}:00.000+0000` });
    assert.ok(r);
    return r;
  };
  const j = (records: ParsedRecord[]) => jira("CAV-7300", records);
  const prod = build([j([rec(81702)])], "prod");
  const demo = build([j([rec(81702)])], "demo");

  it("counts the 17 merged PRs only; still open, reverted and stack-only PRs are shown and never counted", () => {
    assert.equal(prod.stats.prs, 17);
    assert.deepEqual(prod.scope.jiras[0].prs.length, 17);
    assert.match(prod.summary, /^17 PRs \(1 review comment\)/);
    const so = sec(prod, "branches").find((i) => i.key.startsWith("stillopen:"));
    assert.equal(so?.text, "Still open (not released): channelkart#1399 retry for the outlet download; kpi-dashboard#301 portal: empty state");
    assert.deepEqual([so?.severity, so?.needsAttention], ["warn", true]);
    const rv = sec(prod, "branches").find((i) => i.key.startsWith("reverted:"));
    assert.match(rv?.text ?? "", /^Reverted, do not deploy as features: channelkart-bundle#269 .*slake-reporting-config#1370/);
    assert.equal(rv?.severity, "warn");
    assert.match(sec(prod, "branches").find((i) => i.key.startsWith("stackonly:"))?.text ?? "", /^Merged into stack branches only, nothing is released: channelkart-flutter#58 app: status chips; channelkart-flutter#59/);
    for (const k of ["channelkart#1399", "channelkart-bundle#269", "channelkart-flutter#58"]) assert.equal(sec(prod, "branches").some((i) => i.key === `cover:${k}`), false);
    assert.equal(sec(prod, "branches").filter((i) => i.key.startsWith("cover:")).length, 17);
  });

  it("warns about the PRs without formal approval and keeps the approval line as one note", () => {
    // the warning is on the PR's own line: there is no second "No formal approval: repo#n" item
    assert.equal(sec(prod, "branches").filter((i) => i.key.startsWith("noapproval:")).length, 0);
    const w = sec(prod, "branches").filter((i) => i.key.startsWith("cover:") && / - no formal approval$/.test(i.text));
    assert.deepEqual(w.map((i) => i.key).sort(), ["cover:channelkart#1352", "cover:channelkart-bundle#283", "cover:slake-reporting-config#1365"]);
    assert.ok(w.every((i) => i.severity === "warn"));
    assert.match(get(prod, "branches", "cover:channelkart#1352").text, /\[merged\] - no formal approval$/);
    assert.equal(sec(prod, "branches").filter((i) => /^Merged PRs: merged by dev-b/.test(i.text)).length, 1);
  });

  it("header status uses the STATUS word; a declared-vs-listed PR count mismatch is a plain warning", () => {
    const st = sec(prod, "header").find((i) => i.key.startsWith("status:"));
    assert.deepEqual([st?.severity, st?.needsAttention], ["warn", undefined]); // PARTIAL
    const ready = build([j([rec(81703, 3, (b) => b.replace("STATUS   PARTIAL (4 merged PRs are reverted; prod values unknown)", "STATUS   READY (all checked)"))])]);
    assert.equal(sec(ready, "header").find((i) => i.key.startsWith("status:"))?.severity, "info");
    const bad = build([j([rec(81704, 3, (b) => b.replace("union of 17 merged PRs", "union of 18 merged PRs"))])]);
    assert.ok(bad.warnings.some((w) => w.code === "covers_count_mismatch" && w.message === "CAV-7300: The comment says 18 PRs but lists 17"));
    assert.equal(bad.warnings.filter((w) => /covers_count_mismatch/.test(w.code)).length, 1);
  });

  it("shows test owners (unknown ones flagged) and the five likely-missed notes once", () => {
    const owners = sec(prod, "testing").filter((i) => i.text.startsWith("Test owners: "));
    assert.deepEqual(owners.map((i) => i.text), ["Test owners: Reports - Chirag & Hemant", "Test owners: Claims - unknown", "Test owners: Loyalty - Priya"]);
    assert.deepEqual(owners.map((i) => i.needsAttention), [undefined, true, undefined]);
    const missed = sec(prod, "testing").filter((i) => i.text.startsWith("Likely to be missed: "));
    assert.equal(missed.length, 5);
    assert.ok(missed.every((i) => i.label === "Note"));
    assert.equal(sec(prod, "risks").filter((i) => /Switch the filter off|100000 outlets/.test(i.text)).length, 0);
    assert.deepEqual(sec(prod, "risks").map((i) => i.text), ["Open: prod values for the two new properties"]);
    assert.equal(sec(prod, "testing").some((i) => i.key.startsWith("owner:") && i.text === "Test owners: unknown"), false);
  });

  it("row 11 text lines become config items (prod state decides attention); the row keeps the Not done answer and chips", () => {
    const keys = sec(prod, "configs").filter((i) => i.key.startsWith("cfg:")).map((i) => i.key);
    assert.deepEqual(keys, ["cfg:distributor.status.filter.enabled", "cfg:green.config.distributor.designations", "cfg:outlet.download.page.size"]);
    const on = get(prod, "configs", "cfg:distributor.status.filter.enabled");
    assert.deepEqual([on.env?.targetValue, on.config?.default, on.needsAttention], ["not set", "off", true]);
    assert.equal(get(prod, "configs", "cfg:outlet.download.page.size").needsAttention, true); // prod: unknown
    assert.equal(get(prod, "configs", "cfg:green.config.distributor.designations").needsAttention, undefined); // prod: supplier,subd,ss
    const row = get(prod, "configs", "row:configs_prod");
    assert.match(row.text, /^Configs to add in prod: Not done prod values are not known yet/);
    assert.ok(row.chips?.length);
    // the same rows say nothing about demo: not flagged on a demo movement
    assert.equal(get(demo, "configs", "cfg:distributor.status.filter.enabled").needsAttention, undefined);
    assert.equal(get(demo, "configs", "row:configs_prod").needsAttention, undefined);
  });

  it("rows 2 and 12 are the single place for the services of a free-form record; legacy records keep svc:/restart:", () => {
    assert.equal(sec(prod, "deploy").some((i) => i.key.startsWith("svc:")), false);
    assert.equal(sec(prod, "restart").some((i) => i.key.startsWith("restart:")), false);
    assert.match(get(prod, "deploy", "row:services_deploy").text, /^Services to deploy: Channel Kart, Channelkart Bundle, KPI Dashboard - UI/);
    assert.match(get(prod, "restart", "row:services_restart").text, /^Services to restart: Slake Reporting \(executor reload; how: unknown \(devops\)\), Channel Kart$/);
    const legacy = build(realJiras(), "prod");
    assert.equal(sec(legacy, "deploy").filter((i) => i.key.startsWith("svc:")).length, 4);
    assert.equal(sec(legacy, "restart").filter((i) => i.key.startsWith("restart:") && i.key !== "restart:none").length, 2);
    // unknowns: the parser's row 12 devops unknown is in the owner list
    assert.ok(prod.unknownsByOwner.some((g) => g.owner === "devops"));
  });

  it("a three-version chain: only the newest comment feeds the checklist, whatever the order", () => {
    const v1 = rec(81643, 1, (b) => b.replace("Done (pointer reset for the 3 reports)", "Not Done: old answer"));
    const v2 = rec(81700, 2, (b) => b.replace("Done (pointer reset for the 3 reports)", "Not Done: middle answer"));
    const v3 = rec(81701, 3);
    const a = build([j([v1, v2, v3])], "prod");
    const b = build([j([v3, v1, v2])], "prod");
    assert.equal(a.hash, b.hash);
    assert.equal(a.stats.comments, 1);
    assert.match(get(a, "database", "row:previous_data").text, /Done pointer reset for the 3 reports/);
    assert.ok(!JSON.stringify(a).includes("old answer"));
  });

  it("round-trips through the snapshot and renders in Copy / rows", () => {
    assert.deepEqual(decodeSnapshot(encodeSnapshot(prod)), prod);
    assert.match(renderText(prod), /Still open \(not released\): channelkart#1399/);
    assert.ok(toRows(prod).some((r) => r.item === "cover:channelkart#1352" && /WARN/.test(r.flags)));
  });
});

describe("one review comment per Jira: the user's movement shape", () => {
  const row = (r: ParsedRecord, id: string, state: string, answer: string, text = "") => setRow(r, id, state, answer, text);
  const jiraN = (i: number): ChecklistJiraInput => {
    const key = `CAV-${7280 + i}`;
    const r = variant(90000 + i, (x) => {
      x.marker.key = key;
      (x.facts.covers ?? []).forEach((c, k) => (c.pr = 9000 + i * 10 + k));
      row(x, "code_reviewed", i % 3 === 0 ? "not_done" : "done", i % 3 === 0 ? "Not Done: pending approval" : "Done", i % 3 === 0 ? "pending approval" : "");
      row(x, "bundle_sdk", i % 4 === 0 ? "yes" : "no", i % 4 === 0 ? "Yes" : "No");
      row(x, "configs_prod", i % 2 === 0 ? "not_done" : "done", i % 2 === 0 ? "Not Done: values" : "Done: added", i % 2 === 0 ? "values" : "added");
      row(x, "services_restart", "other", i % 2 === 0 ? "Slake Reporting (executor reload)" : "Channel Kart", i % 2 === 0 ? "Slake Reporting (executor reload)" : "Channel Kart");
      row(x, "designations", i % 5 === 0 ? "not_done" : "done", i % 5 === 0 ? "Not Done: portal users" : "Done", i % 5 === 0 ? "portal users" : "");
    });
    return { key, included: true, readiness: "ready", records: [r] };
  };

  it("two Jiras answering rows 4, 10, 11, 12 and 20 differently: no conflicts, one aggregated item per row naming both Jiras", () => {
    const cl = build([jiraN(0), jiraN(1)], "prod");
    assert.equal(cl.conflicts.length, 0);
    assert.equal(get(cl, "branches", "row:code_reviewed").text, "Code reviewed, no breakage other LOBs: Not done \u2014 Not done: CAV-7280 (pending approval) \u00b7 Done: CAV-7281");
    assert.equal(get(cl, "deploy", "row:bundle_sdk").text, "Bundle SDK build required: Yes \u2014 Yes: CAV-7280 \u00b7 No: CAV-7281");
    assert.equal(get(cl, "configs", "row:configs_prod").text, "Configs to add in prod: Not done \u2014 Not done: CAV-7280 (values) \u00b7 Done: CAV-7281 \u2014 added");
    assert.equal(get(cl, "restart", "row:services_restart").text, "Services to restart: Slake Reporting (executor reload) (CAV-7280); Channel Kart (CAV-7281)");
    assert.equal(get(cl, "roles", "row:designations").needsAttention, true);
    for (const [s, k] of [["branches", "row:code_reviewed"], ["deploy", "row:bundle_sdk"], ["configs", "row:configs_prod"]] as const) assert.deepEqual([...new Set(get(cl, s, k).sources.map((x) => x.jira))], ["CAV-7280", "CAV-7281"]);
  });

  it("13 Jiras with a review comment each: zero conflicts, listings capped at 8 Jiras, within bounds", () => {
    const jiras = Array.from({ length: 13 }, (_, i) => jiraN(i));
    const cl = build(jiras, "prod");
    assert.equal(cl.conflicts.length, 0);
    assert.equal(cl.stats.conflicts, 0);
    assert.equal(cl.stats.comments, 13);
    assert.equal(cl.stats.prs, 26);
    assert.match(cl.summary, /^26 PRs \(13 review comments\), 0 conflicts, \d+ need attention, \d+ unknowns$/);
    console.log(`  [P4] 13-Jira movement summary: ${cl.summary}; ${Buffer.byteLength(JSON.stringify(cl))} bytes`);
    const sdk = get(cl, "deploy", "row:bundle_sdk").text;
    assert.equal(sdk, "Bundle SDK build required: Yes \u2014 Yes: CAV-7280, CAV-7284, CAV-7288, CAV-7292 \u00b7 No: CAV-7281, CAV-7282, CAV-7283, CAV-7285, CAV-7286, CAV-7287, CAV-7289, CAV-7290, +1 more");
    assert.ok(get(cl, "branches", "row:code_reviewed").text.length < 700);
    for (const s of cl.sections) assert.ok(s.items.length <= 300);
    assert.ok(Buffer.byteLength(JSON.stringify(cl)) < 400_000);
    assert.deepEqual(decodeSnapshot(encodeSnapshot(cl)), cl);
    // an answer that changes changes the hash
    const changed = build([...jiras.slice(0, 12), jiraN(12)].map((j, i) => (i === 5 ? { ...j, records: [variant(5, (r) => { r.marker.key = j.key; setRow(r, "designations", "done", "Done"); })] } : j)), "prod");
    assert.notEqual(changed.hash, cl.hash);
  });

  it("only one Jira's own disagreeing records are a row_state conflict (legacy per-PR records of one ticket)", () => {
    const mk = (pr: number, state: string, answer: string) => {
      const r = synth({ pr, facts: { releaseRows: [{ n: 4, id: "code_reviewed", label: "Code reviewed, no breakage other LOBs", answer, state: state as "done", text: "" }] } });
      return r;
    };
    const one = build([jira("CAV-1", [mk(1, "done", "Done"), mk(2, "not_done", "Not Done")])]);
    assert.equal(one.conflicts.length, 1);
    assert.deepEqual([one.conflicts[0].kind, one.conflicts[0].title, one.conflicts[0].id], ["row_state", "Release-page answer differs: Code reviewed, no breakage other LOBs", "branches|row:code_reviewed|row_state|CAV-1"]);
    const across = build([jira("CAV-1", [mk(1, "done", "Done")]), jira("CAV-2", [mk(2, "not_done", "Not Done")])]);
    assert.equal(across.conflicts.length, 0);
  });

  it("real conflicts are still raised across Jiras: prod branch, config default, config env value", () => {
    const pb = (pr: number, b: string) => synth({ pr, facts: { prodBranch: { branch: b }, prodBranches: [b] } });
    const cfg = (pr: number, def: string, prod: string) => synth({ pr, facts: { configs: [{ key: "x.y", source: "table", default: def, prod }] } });
    const cl = build([jira("CAV-1", [pb(1, "prod_a"), cfg(11, "on", "on")]), jira("CAV-2", [pb(2, "prod_b"), cfg(12, "off", "off")])], "prod");
    assert.deepEqual(cl.conflicts.map((c) => c.kind).sort(), ["config_default", "config_env_value", "prod_branch"]);
    assert.equal(cl.stats.conflicts, 3);
  });
});

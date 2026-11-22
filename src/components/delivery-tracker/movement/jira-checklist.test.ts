/**
 * The per-Jira checklist (expansion of a Jira row): pure helpers and server renders on the REAL union review comment of CAV-7280 (Jira comment 81643),
 * built into a Checklist for that one Jira, exactly as GET items/<id>/checklist answers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildChecklist } from "@/lib/movement/checklist/build";
import { unionJira } from "@/lib/movement/checklist/testkit";
import { LinkProvider } from "./linkified";
import { JiraChecklistView } from "./jira-checklist-panel";
import { buildJiraChecklistView, jiraChecklistText, parseCoverItem, parseRowItem, RELEASE_ROW_ORDER, rowCounts, splitRows } from "./jira-checklist";

const cl = buildChecklist({ environment: "demo", jiras: [unionJira()], branches: [] });
const v = buildJiraChecklistView(cl);
const render = (over: Partial<Parameters<typeof JiraChecklistView>[0]> = {}) =>
  renderToStaticMarkup(h(LinkProvider, { jiraBaseUrl: "https://example.atlassian.net", children: h(JiraChecklistView, { v, itemKey: "CAV-7280", environment: "demo", ...over }) }));

describe("per-Jira checklist: pure helpers", () => {
  it("rows come in the release page's fixed order (1..23), numbers ascending, and ids the page knows", () => {
    assert.equal(RELEASE_ROW_ORDER.length, 23);
    const ns = v.rows.map((r) => r.n);
    assert.deepEqual(ns, [...ns].sort((a, b) => a - b));
    assert.deepEqual(v.rows.map((r) => r.id), ["meeting", "services_deploy", "code_reviewed", "new_app_old_data", "bundle_sdk", "configs_prod", "services_restart", "automation_run", "automation_updated", "features_old_data", "designations", "scenarios", "cherry_pick"]);
    assert.equal(v.rows.find((r) => r.id === "code_reviewed")?.n, 4);
  });
  it("parseRowItem reads the state word and keeps the details; a state word only counts at the start of the answer", () => {
    const base = { needsAttention: true as const, chips: [] as [] };
    const done = parseRowItem({ key: "row:code_reviewed", text: "Code reviewed, no breakage other LOBs: Done ckcoedemo only", ...base });
    assert.equal(done?.state, "done");
    assert.equal(done?.details, "ckcoedemo only");
    assert.equal(parseRowItem({ key: "row:bundle_sdk", text: "Bundle SDK build required: No", ...base })?.state, "no");
    assert.equal(parseRowItem({ key: "row:meeting", text: "Production meeting: Unknown (release manager)", ...base })?.state, "unknown");
    assert.equal(parseRowItem({ key: "row:configs_prod", text: "Configs: Not done param x", ...base })?.state, "notdone");
    assert.equal(parseRowItem({ key: "row:services_deploy", text: "Services to deploy: Slake Reporting only", ...base })?.state, "other");
    assert.equal(parseRowItem({ key: "svc:deploy:x", text: "x", ...base }), null, "only row: items are rows");
  });
  it("a PR row needs a real repo#number: 'before#1147' and 'inside#1147' are dropped from the PR table", () => {
    assert.equal(parseCoverItem({ key: "cover:before#1147", text: "before#1147 [merged]" }), null);
    assert.equal(parseCoverItem({ key: "cover:by#269", text: "by#269 a3bad92306 (all self-merged by the author, no approval) [merged]" }), null);
    assert.equal(parseCoverItem({ key: "cover:channelkart#1147", text: "channelkart#1147 master 33e8209192 19 Nov APIs [merged]" })?.pr, "channelkart#1147");
  });
  it("splitRows folds every 'Not required' row and the notreq: labels into one list, without duplicates", () => {
    const rows = [
      { id: "a", n: 1, label: "App release", state: "na" as const, details: "", needsAttention: false, chips: [] },
      { id: "b", n: 2, label: "Code reviewed", state: "done" as const, details: "", needsAttention: false, chips: [] },
    ];
    const s = splitRows(rows, ["App release", "DB index queries"]);
    assert.deepEqual(s.shown.map((r) => r.id), ["b"]);
    assert.deepEqual(s.notRequired, ["App release", "DB index queries"]);
    assert.equal(rowCounts(rows, ["App release", "DB index queries"]), "1 done, 2 not required");
    assert.equal(rowCounts([], []), "no rows");
  });
  it("on the real fixture: 13 answered rows (the database rows are one No-database-change line), 6 not-required labels, the PR table has the two merged PRs", () => {
    assert.equal(v.rows.length, 13);
    assert.equal(v.notRequired.length, 6);
    assert.deepEqual(v.prs.map((p) => p.pr).sort(), ["slake-custom-reports#931", "slake-reporting-config#1313"]);
    assert.ok(v.prs.every((p) => p.state === "merged" && !p.noApproval));
    assert.equal(parseCoverItem({ key: "row:x", text: "y" }), null);
    assert.equal(rowCounts(v.rows, v.notRequired), "1 done, 3 not done, 4 unknown, 2 yes, 1 no, 6 not required");
  });
  it("the header: HELD in the DEMO movement, what it does, and that it needs attention", () => {
    assert.equal(v.header.statusWord, "HELD");
    assert.match(v.header.statusText ?? "", /HELD in the DEMO movement/);
    assert.match(v.header.what ?? "", /loading reports honour the selected Loadout Number/);
    assert.equal(v.header.needsAttention, true);
  });
  it("the order: deploy steps in sequence, the rollback and the verify line", () => {
    assert.deepEqual(v.order.steps.map((s) => s.seq), [1, 2]);
    assert.deepEqual(v.order.rollback, ["revert both PRs"]);
    assert.match(v.order.verify[0], /Loading Sheet with one loadout/);
  });
  it("the copy text names the Jira and environment, has every card under its own heading, the Not needed line, and no markup", () => {
    const t = jiraChecklistText("CAV-7280", "demo", v);
    assert.match(t, /^Checklist of CAV-7280 for DEMO/);
    for (const title of ["At a glance", "What to deploy", "Configuration", "Database and data", "App and compatibility", "Testing", "Order of steps", "Rollback and undo", "Verify after deploy", "Open questions and risks", "Pull requests", "Release checklist"]) assert.ok(t.includes(`CAV-7280 — ${title}`), title);
    assert.match(t, /Not needed: .*App release/);
    assert.ok(!/<[a-z]/.test(t));
  });
});

describe("per-Jira checklist: render on the real CAV-7280 comment", () => {
  const html = render({ info: { version: 2, posted: "2026-11-19T06:00:00Z", scope: "union", edited: false, editedBy: null } });
  it("the root has the testid, a title for the environment, a Copy button for the whole Jira and one for every card", () => {
    assert.match(html, /data-testid="movement-jira-checklist-CAV-7280"/);
    assert.match(html, /Checklist of this Jira for Demo/i);
    assert.match(html, /data-testid="movement-jira-copy-CAV-7280"/);
    for (const id of ["glance", "deploy", "config", "data", "app", "testing", "order", "rollback", "verify", "open", "prs", "release"]) {
      assert.match(html, new RegExp(`data-testid="movement-jira-card-${id}"`), id);
      assert.match(html, new RegExp(`data-testid="movement-jira-copy-card-${id}-CAV-7280"`), `copy button of ${id}`);
    }
  });
  it("header strip: version, scope, posted time (IST); the verdict is in the At a glance card", () => {
    const strip = html.slice(html.indexOf('data-testid="movement-jira-header-strip-CAV-7280"'));
    const s = strip.slice(0, strip.indexOf("</div>"));
    assert.match(s, />v2</);
    assert.match(s, /all PRs of the Jira/);
    assert.match(s, /posted .* IST/);
    assert.ok(!html.includes("movement-jira-edited-note-"), "not edited: no edited chip");
    assert.match(tag(html, "movement-jira-status-CAV-7280"), /data-testid="movement-jira-status-CAV-7280"/);
    assert.match(html, />Held<\/span>/);
  });
  it("release checklist: a table with the answered rows; a row a card already shows says where, and a not-needed row is one muted line", () => {
    assert.match(html, /aria-label="Release checklist"/);
    const table = html.slice(html.indexOf('data-testid="movement-jira-release-table"')).split("</table>")[0];
    for (const label of ["Production meeting + everyone invited", "Services to deploy", "Code reviewed, no breakage other LOBs", "Configs to add in prod", "Cherry-pick + re-test effort"]) assert.ok(table.includes(label), label);
    assert.match(table, /Shown under What to deploy/);
    assert.match(table, /Shown under Configuration/);
    assert.match(html, /Not needed: [^<]*Bundle code reviewed/);
    assert.ok(!/<td[^>]*>Bundle code reviewed<\/td>/.test(html), "a not-needed row is not a table row");
  });
  it("PRs table: PR, base, what it does, approval; links come from the Linkified layer", () => {
    const t = html.slice(html.indexOf('data-testid="movement-jira-pr-table"'));
    const table = t.slice(0, t.indexOf("</table>"));
    assert.match(table, /<th[^>]*>PR<\/th><th[^>]*>Base<\/th><th[^>]*>What it does<\/th><th[^>]*>Approval<\/th>/);
    assert.match(table, /href="https:\/\/github\.com\/salescode-ai\/slake-custom-reports\/pull\/931"[^>]*>slake-custom-reports#931<\/a>/);
    assert.match(table, />main</);
    assert.match(table, /689b6d326c/);
    assert.match(table, />executor</);
    assert.match(html, /2 merged/);
  });
  it("order and rollback are shown; open questions are listed by owner", () => {
    assert.match(html, /revert both PRs/);
    assert.match(html, /Loading Sheet with one loadout returns only that loadout/);
    assert.match(html, /aria-label="Open questions"/);
    assert.match(html, />release manager</i);
    assert.match(html, />devops</i);
    assert.match(html, />QA</);
  });
  it("an edited Jira shows the edited chip with who", () => {
    const e = render({ info: { version: 3, posted: null, scope: "union", edited: true, editedBy: "Asha" } });
    assert.match(tag(e, "movement-jira-edited-note-CAV-7280"), /title="Edited in Flux by Asha"/);
  });
  it("text only: Jira text is never turned into HTML", () => {
    const evil = buildJiraChecklistView({ ...cl, sections: cl.sections.map((s, i) => (i === 0 ? { ...s, items: s.items.map((it) => (it.key.startsWith("row:") ? { ...it, text: `${it.text} <img src=x onerror=alert(1)>` } : it)) } : s)) });
    const out = renderToStaticMarkup(h(LinkProvider, { jiraBaseUrl: null, children: h(JiraChecklistView, { v: evil, itemKey: "CAV-7280", environment: "demo" }) }));
    assert.ok(!out.includes("<img"), "no element built from Jira text");
  });
});

function tag(html: string, testid: string): string {
  const at = html.indexOf(`data-testid="${testid}"`);
  assert.ok(at >= 0, `no element with data-testid=${testid}`);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}

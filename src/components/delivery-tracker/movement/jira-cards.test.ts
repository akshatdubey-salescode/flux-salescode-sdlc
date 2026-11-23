/** The plain-language cards of one Jira, on the real CAV-7293 checklist (DEMO movement, 21 Nov 2026) and the CAV-7280 union comment. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChecklist } from "@/lib/movement/checklist/build";
import { unionJira } from "@/lib/movement/checklist/testkit";
import { cav7293 } from "./cav7293.fixture";
import { buildJiraChecklistView, jiraChecklistText } from "./jira-checklist";
import { buildJiraCards, buildServices, cardSentences, cardText, ownerLabel, splitNumberedRun, type Card, type Cell } from "./jira-cards";
import { sentenceKey } from "./plain-text";

const v = buildJiraChecklistView(cav7293());
const cards = buildJiraCards(v);
const byId = (id: string): Card => cards.find((c) => c.id === id) as Card;
const text = jiraChecklistText("CAV-7293", "demo", v);

function cellsOf(card: Card, table: number): Cell[][] {
  const t = card.blocks.filter((b) => b.kind === "table")[table];
  assert.ok(t && t.kind === "table");
  return t.rows.map((r) => r.cells);
}
const flat = (c: Cell): string => (c.kind === "text" ? c.text : c.kind === "answer" ? c.label : c.kind === "plain" ? [c.plain.lead, ...c.plain.bullets, ...c.plain.more].join(" ") : c.kind === "chips" ? c.chips.map((x) => x.text).join("+") : c.kind === "stack" ? c.cells.map(flat).join(" ") : "");

describe("cards of CAV-7293: structure", () => {
  it("twelve cards in the order glance, deploy, config, data, app, testing, order, rollback, verify, open, prs, release", () => {
    assert.deepEqual(cards.map((c) => c.id), ["glance", "deploy", "config", "data", "app", "testing", "order", "rollback", "verify", "open", "prs", "release"]);
    for (const c of cards) assert.ok(c.about.length > 10 && c.title.length > 3, c.id);
  });
  it("At a glance: Held, the reason in plain words, and the nine fact chips", () => {
    const g = byId("glance");
    const verdict = g.blocks[0];
    assert.ok(verdict.kind === "verdict");
    assert.equal(verdict.verdict, "Held");
    assert.equal(verdict.reason.lead, "in the DEMO movement (blocked)");
    assert.deepEqual(verdict.reason.bullets, ["Partly reviewed: prod setting values and ckcoeuat index not in any file"]);
    const facts = g.blocks[1];
    assert.ok(facts.kind === "facts");
    assert.deepEqual(
      facts.chips.map((c) => `${c.label}=${c.value}`),
      ["App release=No", "DB change=No", "Index=No", "Configs=4", "Services=3", "Downtime=none stated", "Bundle SDK=Not required", "Old data fix=Yes", "Backward-compat=Yes"],
    );
  });
});

describe("cards of CAV-7293: each fact once", () => {
  it("What to deploy: each service ONCE with its actions merged and the unknown in words", () => {
    const rows = cellsOf(byId("deploy"), 0).map((r) => r.map(flat));
    assert.deepEqual(rows.map((r) => r[0]), ["Channel Kart", "KPI Dashboard - UI", "Slake Reporting"]);
    assert.deepEqual(rows.map((r) => r[1]), ["Deploy+Restart", "Deploy+Restart", "Deploy+Restart"]);
    assert.equal(rows[2][2], "executor jar + config reload (how: not known yet — devops to confirm)");
    assert.equal(rows[0][2], "code; properties need cache clear only");
    const all = byId("deploy").blocks.map((b) => JSON.stringify(b)).join("");
    assert.equal((all.match(/KPI Dashboard/g) ?? []).length, 1, "the services row of the release page is not repeated");
    assert.ok(byId("deploy").blocks.some((b) => b.kind === "note" && /Not needed: bundle, app/.test(b.text)));
  });
  it("buildServices: restart-only and deploy-only services keep their one action", () => {
    const s = buildServices({ ...v, services: { ...v.services, deploy: ["Alpha (from main)"], restart: ["Beta - reload config"], notes: [] }, rows: [] });
    assert.deepEqual(s.entries.map((e) => [e.name, e.deploy, e.restart, e.notes.join("|")]), [["Alpha", true, false, "from main"], ["Beta", false, true, "reload config"]]);
  });
  it("the whole text says no sentence twice (the same fact in two cards or two rows)", () => {
    const keys = cardSentences(cards).map(sentenceKey).filter((k) => k.length >= 20);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dup, []);
    for (const phrase of ["Order Source column", "row_hash is unchanged", "admin (not limited)", "caller-scope guard"]) assert.equal((text.match(new RegExp(phrase.replace(/[()]/g, "\\$&"), "g")) ?? []).length, 1, phrase);
  });
  it("Previous data fix appears once, in Database and data (not twice there, not again in the release table)", () => {
    const rows = cellsOf(byId("data"), 0).map((r) => r.map(flat));
    assert.equal(rows.filter((r) => /old data/i.test(r[0])).length, 1);
    assert.match(rows[0][2], /after deploy run each of the 3 reports once with full: true/);
    const rel = cellsOf(byId("release"), 0).map((r) => r.map(flat));
    assert.equal(rel.find((r) => /Previous data fix/.test(r[1]))?.[3], "Shown under Database and data");
  });
  it("pointers are gone or one muted line: 'see row 6', 'See rows 19 and 21', 'see LIKELY TO BE MISSED below', 'see the release page'", () => {
    for (const bad of ["see row 6", "See rows 19", "LIKELY TO BE MISSED below", "see the release page", "(row 11)"]) assert.ok(!text.includes(bad), bad);
    const app = cellsOf(byId("app"), 0).map((r) => r.map(flat));
    assert.equal(app.find((r) => /Features work with old data/.test(r[0]))?.[2], "Same as row 6 (New code works with old data)");
  });
  it("Configuration: each key once, with where and value; the four switches intro is a note", () => {
    const rows = cellsOf(byId("config"), 0).map((r) => r.map(flat));
    assert.deepEqual(rows.map((r) => r[0]), ["collections.invoice.order.source.enabled", "invoice.collection.caller.scope.enabled", "showCollectionOrderSource", "order.source.enabled"]);
    assert.deepEqual(rows.map((r) => r[2]), ["true", "true", "true", '"true"']);
    assert.match(rows[0][1], /client property/);
    for (const k of ["collections.invoice.order.source.enabled", "invoice.collection.caller.scope.enabled"]) assert.equal((text.match(new RegExp(`${k.replace(/\./g, "\\.")} —`, "g")) ?? []).length, 1, k);
    assert.ok(byId("config").blocks.some((b) => b.kind === "note" && /Four switches, all default off, per LOB/.test(b.text)));
  });
  it("Order of steps: the run '1 A 2 B ... 7 G' becomes seven numbered steps", () => {
    assert.equal(splitNumberedRun("a 2 b 3 c")?.length, 3);
    assert.equal(splitNumberedRun("run it 2 times"), null);
    assert.deepEqual(splitNumberedRun("net: 1 channelkart #1146 + #1181 (one deploy) 2 index script by the DB owner 3 properties per LOB"), ["net: channelkart #1146 + #1181 (one deploy)", "index script by the DB owner", "properties per LOB"]);
    const order = byId("order").blocks[0];
    assert.ok(order.kind === "list" && order.ordered);
    assert.equal(order.items.length, 7);
    assert.equal(order.items[0].lead, "slake-custom-reports#918");
    assert.equal(order.items[6].lead, "SHOW INDEX gate before step 2 on each tenant");
  });
  it("Pull requests: five real PRs (no before#1147 / inside#1147), the approver named, the stack PR and the open one apart", () => {
    const rows = cellsOf(byId("prs"), 0).map((r) => r.map(flat));
    assert.deepEqual(rows.map((r) => r[0]), ["channelkart#1147", "channelkart#1186", "kpi-dashboard#246", "slake-custom-reports#918", "slake-reporting-config#1294"]);
    assert.match(rows[1][3], /Approved by dev-b/, "the generic 'approved and merged by' line is applied to a PR that has no line of its own");
    assert.match(rows[2][3], /No approval/);
    assert.ok(!text.includes("before#1147") && !text.includes("inside#1147"));
    assert.match(text, /channelkart#1156 — batching fixes, merged into the feature branch \(CAV-7293-collections-order-source, 12c2cd9153, 17 Nov\)/);
  });
  it("a 'still open' list from older stored data does not show 'of#1341' or 'by#1370' as PRs (real CAV-7300 text)", () => {
    const v3 = { ...v, notReleased: [{ kind: "open" as const, text: "Still open (not released): slake-reporting-config#1345; of#1341; by#1370; channelkart#1191; kpi-dashboard#270", prs: [] }] };
    const t3 = jiraChecklistText("CAV-7300", "demo", v3);
    assert.ok(!/of#1341|by#1370/.test(t3));
    for (const pr of ["slake-reporting-config#1345", "channelkart#1191", "kpi-dashboard#270"]) assert.ok(t3.includes(pr), pr);
  });
  it("Open questions: what is not known, for whom, in words; 'Not reviewed' and 'Still open' are told apart from risks", () => {
    const rows = cellsOf(byId("open"), 0).map((r) => r.map(flat));
    assert.deepEqual(rows.map((r) => r[0]), ["Devops", "Devops config compare", "Mobile lead", "QA", "Release manager"]);
    assert.deepEqual(rows.map((r) => r[1]), ["Slake Reporting: executor jar + config reload — how it is done", "Current values on each LOB", "Oldest supported build", "What QA ran", "Production meeting + everyone invited"]);
    assert.equal(ownerLabel("qa"), "QA");
    assert.match(text, /Not reviewed — test files/);
    assert.match(text, /Still open — the ckcoeuat index check/);
  });
  it("Release checklist: 23 rows' worth in page order, claimed rows say where, 'Yes / Not done' is one answer, cherry-pick is one point per repo", () => {
    const rel = cellsOf(byId("release"), 0).map((r) => r.map(flat));
    const nums = rel.map((r) => Number(r[0]));
    assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
    assert.equal(rel.find((r) => /UI code review/.test(r[1]))?.[2], "Yes / Not done");
    const cherry = byId("release").blocks[0];
    assert.ok(cherry.kind === "table");
    const cell = cherry.rows.find((r) => r.id === "rel:cherry_pick")?.cells[3];
    assert.ok(cell && cell.kind === "plain");
    assert.deepEqual([...cell.plain.bullets, ...cell.plain.more].map((b) => b.split(":")[0]), ["channelkart", "kpi-dashboard", "slake-custom-reports", "slake-reporting-config", "Re-test"]);
    assert.ok(byId("release").blocks.some((b) => b.kind === "note" && /Not needed: Bundle SDK build/.test(b.text)));
  });
});

describe("cards of CAV-7293: no leftovers of the raw text", () => {
  it("no evidence or decision tags, no glued 'unknownX', no raw 'unknown (x)', no 'owner to confirm: x'", () => {
    assert.ok(!/\[(?:V|I|author)\b/.test(text));
    assert.ok(!/\(D\d\)/.test(text));
    assert.ok(!/unknown[a-zA-Z]/.test(text));
    assert.ok(!/unknown \(/i.test(text));
    assert.ok(!/owner to confirm:/i.test(text));
    assert.match(text, /not known yet — devops to confirm/);
  });
  it("no sentence ends in a cut-off '…', and every bracket is closed", () => {
    for (const s of cardSentences(cards)) {
      assert.ok(!s.endsWith("…"), s);
      assert.equal((s.match(/\(/g) ?? []).length, (s.match(/\)/g) ?? []).length, s);
    }
  });
  it("every number, key and file name of the long rows survives (nothing is dropped)", () => {
    for (const must of ["1.43 s", "5.2M rows", "UK_tm80okqm5deqt4gap961b5nnc", "idx_sales_inv_ser_no_supplier", "getUnpaidInvoicesByOutletCode", "CustomLoadingCollectionsReportExecutor", "PropertyDefinition.java", "COCA-1651", "ck_orders.source", "SHOW INDEX FROM ck_sales"]) assert.ok(text.includes(must), must);
  });
  it("every sentence of it is short enough to read", () => {
    const longest = Math.max(...cardSentences(cards).map((s) => s.length));
    assert.ok(longest <= 400, `longest sentence ${longest}`);
  });
});

describe("card copy text", () => {
  it("each card copies as '<JIRA> — <title>' followed by its own content and nothing from another card", () => {
    for (const c of cards) {
      const t = cardText("CAV-7293", c);
      assert.ok(t.startsWith(`CAV-7293 — ${c.title}\n`), c.id);
      assert.ok(!t.includes("— Open questions and risks\n") || c.id === "open");
    }
    assert.match(cardText("CAV-7293", byId("deploy")), /- Slake Reporting — Deploy \+ Restart — executor jar \+ config reload \(how: not known yet — devops to confirm\)/);
    assert.match(cardText("CAV-7293", byId("order")), /^CAV-7293 — Order of steps\n1\. slake-custom-reports#918\n2\. slake-reporting-config#1294/);
  });
  it("the whole-Jira text is the cards in order under the environment heading", () => {
    assert.ok(text.startsWith("Checklist of CAV-7293 for DEMO\n"));
    let at = 0;
    for (const c of cards) {
      const i = text.indexOf(`CAV-7293 — ${c.title}`, at);
      assert.ok(i >= at, c.id);
      at = i;
    }
  });
});

describe("cards of CAV-7280 (blocked, partly reviewed)", () => {
  const cl = buildChecklist({ environment: "demo", jiras: [unionJira()], branches: [] });
  const v2 = buildJiraChecklistView(cl);
  const cards2 = buildJiraCards(v2);
  it("one service with deploy and restart merged; the roles line is not repeated under Testing", () => {
    const rows = cellsOf(cards2.find((c) => c.id === "deploy") as Card, 0).map((r) => r.map(flat));
    assert.equal(rows.length, 1);
    assert.equal(rows[0][0], "Slake Reporting");
    assert.equal(rows[0][1], "Deploy+Restart");
    const t = jiraChecklistText("CAV-7280", "demo", v2);
    assert.equal((t.match(/portal users of Loading Sheet, Product Wise, W\/O Batch/g) ?? []).length, 1);
  });
  it("answered 'No' rows without details fold into the Not needed line", () => {
    const t = jiraChecklistText("CAV-7280", "demo", v2);
    assert.match(t, /Not needed: Bundle SDK build required/);
  });
});

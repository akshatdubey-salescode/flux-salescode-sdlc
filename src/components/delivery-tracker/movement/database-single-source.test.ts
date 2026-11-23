/**
 * One entry per database topic, everywhere: the release-page rows (previous data fix, DB change queries, DB index, UI index db versions) are the single
 * source; each Jira's own instruction appears once, grouped with the Jiras that wrote it. Real answers of CAV-7280, 7296, 7299, 7317 and 7324
 * (DEMO movement, 21 Nov 2026; instructions shortened to their first sentences).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChecklist } from "@/lib/movement/checklist/build";
import { buildRollup } from "@/lib/movement/checklist/rollup";
import { jiraServices } from "@/lib/movement/checklist/services";
import type { ChecklistJiraInput } from "@/lib/movement/checklist/types";
import { parseDeploymentRecord } from "@/lib/movement/record";
import { unionJira } from "@/lib/movement/checklist/testkit";
import { buildJiraCards, cardText, type Card, type Cell } from "./jira-cards";
import { buildJiraChecklistView } from "./jira-checklist";
import { plainItems, sectionPlainText } from "./plain-items";

type Rows = { prev: string; q: string; idx: string; ui?: string; qLabel?: string; idxLabel?: string };
const DB: Record<string, Rows> = {
  "CAV-7280": {
    prev: "Yes filters report on ckcoedemo: rows loaded before #1302 have no field6; row_hash is unchanged, so the incremental run never re-emits them. Needs a full run or delete + pointer reset of dms_loadout_items_filters (ckcoedemo)",
    q: "No no SQL, DDL or migration in any PR. The sink writes into the existing generic table rpt_generic_ckcoedemo",
    idx: "No no query changed; only the parameter names the executors read",
    ui: "No no IndexedDB in the diff",
  },
  "CAV-7296": {
    prev: "No numbers already changed stay changed; nothing is backfilled",
    q: "Yes one script, run by hand (not auto-run): channelkart src/main/resources/cav-7296-ck-user-mobile-index.sql. Online ALTER TABLE ck_user ADD INDEX idx_user_mobile (mobile)",
    idx: "Yes where absent: ck_user (mobile). ckcoedemo has none (259,658 rows, about 200 ms per full scan)",
    ui: "No no IndexedDB in the diff",
  },
  "CAV-7299": {
    prev: "Yes slake ckcoedemo, once, after #1305: a full reload (pointer reset) of report_entity_parent_mapping_etl and entity_user_live_filter",
    q: "Yes one script, run by hand per tenant DB (not auto-run): channelkart src/main/resources/cav-7299-delivery-pjp-supplier-date-index.sql. It is guarded and safe to run twice",
    idx: "Yes CREATE INDEX idx_ck_delivery_pjp_supplier_date_status ON ck_delivery_pjp (supplierid, pjp_date, active_status), through the script",
    ui: "No no IndexedDB in the diff",
  },
  "CAV-7317": {
    prev: "No existing channel rows stay as the fallback; nothing migrated or backfilled",
    q: "Yes no DDL, no migration. Two scripts in channelkart-bundle docs/CAV-7317/, run by hand on the ckcoe DB: a) transformer_registration.sql b) otp_outlet_mapping_configuration_report.sql",
    idx: "No new query existsByConfigTypeAndCodeContaining and the report read ck_green_config_profile by config_type; unique key uk_gcp_code is in the entity",
    ui: "No no IndexedDB in the diff",
  },
  "CAV-7324": { prev: "", q: "Done no DDL: loginId, startDate, endDate are transient", idx: "Not done period query is meant to use an index range (test named in #1167)", qLabel: "DB change queries shared", idxLabel: "DB index queries" },
};

function jiraOf(key: string, rows: Rows): ChecklistJiraInput {
  const lines = [
    rows.prev ? ` 5  Previous data fix required?  ${rows.prev}` : "",
    ` 7  ${rows.qLabel ?? "DB change queries required?"}  ${rows.q}`,
    ` 8  ${rows.idxLabel ?? "DB index required?"}  ${rows.idx}`,
    rows.ui ? `14  UI index db versions update required?  ${rows.ui}` : "",
  ].filter(Boolean);
  const body = `DEPLOYMENT-RECORD v2 | ${key} | union of 1 merged PRs | 2026-11-21 09:30 UTC | a\nsupersedes: none\n\nSTATUS   READY\nWHAT     x\nMERGED PRs\n  channelkart#1   master  abcdef1234  one\n\n${lines.join("\n")}\n`;
  const rec = parseDeploymentRecord({ id: key.length, body, created: "2026-11-21T09:30:00.000+0000" });
  assert.ok(rec);
  return { key, included: true, readiness: "ready", records: [rec] };
}
const jiras = Object.entries(DB).map(([k, r]) => jiraOf(k, r));
const cl = buildChecklist({ environment: "demo", jiras, branches: [] });
const section = cl.sections.find((s) => s.id === "database")!;
const count = (needle: string, text: string) => text.split(needle).length - 1;

describe("merged checklist: the database section", () => {
  it("one item per topic: previous data fix, DB change queries, DB index; no db: items, no 'No database change' next to real work; UI index db hidden (everybody says no)", () => {
    assert.deepEqual(section.items.map((i) => i.key), ["row:previous_data", "row:db_queries", "row:db_index"]);
    assert.ok(!section.items.some((i) => i.key.startsWith("db:")));
  });
  it("CAV-7324's own wording ('DB change queries shared', 'DB index queries') is the same topic as the others", () => {
    const q = section.items.find((i) => i.key === "row:db_queries")!;
    const idx = section.items.find((i) => i.key === "row:db_index")!;
    assert.match(q.text, /Done: CAV-7324 — no DDL: loginId, startDate, endDate are transient/);
    assert.match(idx.text, /Not done: CAV-7324 \(period query is meant to use an index range \(test named in #1167\)\)/);
  });
  it("each Jira's instruction appears ONCE, grouped with its Jiras: Yes: CAV-7296 / CAV-7299 / CAV-7317 each with their words, Done: CAV-7324, No: CAV-7280", () => {
    const q = section.items.find((i) => i.key === "row:db_queries")!;
    for (const needle of ["cav-7296-ck-user-mobile-index.sql", "cav-7299-delivery-pjp-supplier-date-index.sql", "transformer_registration.sql", "rpt_generic_ckcoedemo"]) assert.equal(count(needle, q.text), 1, needle);
    assert.deepEqual(q.answers?.map((a) => [a.state, a.jiras.join()]), [["yes", "CAV-7296"], ["yes", "CAV-7299"], ["yes", "CAV-7317"], ["done", "CAV-7324"], ["no", "CAV-7280"]]);
    assert.match(q.answers![0].text, /^one script, run by hand \(not auto-run\): channelkart src\/main\/resources\/cav-7296/);
    const prev = section.items.find((i) => i.key === "row:previous_data")!;
    assert.deepEqual(prev.answers?.map((a) => [a.state, a.jiras.join()]), [["yes", "CAV-7280"], ["yes", "CAV-7299"], ["no", "CAV-7296"], ["no", "CAV-7317"]]);
  });
  it("the plain copy of the section lists each topic once with every instruction once", () => {
    const t = sectionPlainText(section, plainItems(cl));
    assert.equal(count("DB change queries required?", t) + count("DB change queries", t) >= 1, true);
    for (const needle of ["cav-7296-ck-user-mobile-index.sql", "cav-7299-delivery-pjp-supplier-date-index.sql", "otp_outlet_mapping_configuration_report.sql", "idx_ck_delivery_pjp_supplier_date_status"]) assert.equal(count(needle, t), 1, needle);
    assert.equal(count("Previous data fix required?", t), 1);
  });
});

describe("roll-up: the database section", () => {
  const r = buildRollup({ environment: "demo", jiras, branches: [] });
  const entries = r.sections.find((s) => s.id === "database")!.entries;
  it("three entries, one per topic, no per-Jira db: entries; each instruction once in the details", () => {
    assert.deepEqual(entries.map((e) => e.key), ["row:db_queries", "row:db_index", "row:previous_data"].filter((k) => entries.some((e) => e.key === k)).sort((a, b) => entries.findIndex((e) => e.key === a) - entries.findIndex((e) => e.key === b)));
    assert.equal(entries.length, 3);
    assert.ok(!entries.some((e) => e.key.startsWith("db:")));
    const q = entries.find((e) => e.key === "row:db_queries")!;
    const all = (q.details ?? []).map((d) => d.text).join("\n");
    assert.equal(count("cav-7296-ck-user-mobile-index.sql", all), 1);
    assert.equal(q.line.includes("DB change queries"), false);
  });
  it("a Jira whose index test is 'Not done' keeps the DB index entry in the attention view even though 'yes' leads (CAV-7324)", () => {
    const idx = entries.find((e) => e.key === "row:db_index")!;
    assert.equal(idx.needsAttention, true);
    assert.equal(idx.severity, "warn");
  });
});

describe("when nobody needs anything: ONE 'No database change' line", () => {
  const quiet = [jiraOf("CAV-7280", DB["CAV-7280"]), jiraOf("CAV-7296", { prev: "No nothing", q: "No no SQL", idx: "No no index", ui: "No none" })];
  it("merged checklist and roll-up each give a single line, and the four rows are not shown", () => {
    const c2 = buildChecklist({ environment: "demo", jiras: [quiet[1]], branches: [] });
    assert.deepEqual(c2.sections.find((s) => s.id === "database")!.items.map((i) => [i.key, i.text]), [["db:none", "No database change"]]);
    const r2 = buildRollup({ environment: "demo", jiras: [quiet[1]], branches: [] });
    assert.deepEqual(r2.sections.find((s) => s.id === "database")!.entries.map((e) => [e.key, e.line]), [["db:none", "No database change"]]);
  });
  it("the UI index db row shows only when a Jira says more than 'no'", () => {
    const withUi = jiraOf("CAV-7296", { prev: "No nothing", q: "No no SQL", idx: "No no index", ui: "Yes bump the IndexedDB version to 7" });
    const c3 = buildChecklist({ environment: "demo", jiras: [withUi], branches: [] });
    assert.ok(c3.sections.find((s) => s.id === "database")!.items.some((i) => i.key === "row:ui_indexdb"));
  });
});

describe("per-Jira card: one row per topic", () => {
  const flat = (c: Cell): string => (c.kind === "text" ? c.text : c.kind === "plain" ? [c.plain.lead, ...c.plain.bullets, ...c.plain.more].join(" ") : c.kind === "answer" ? c.label : "");
  const card = (key: string): Card => {
    const j = jiraOf(key, DB[key]);
    const c = buildChecklist({ environment: "demo", jiras: [j], branches: [] });
    return buildJiraCards(buildJiraChecklistView(c, jiraServices(j.records))).find((x) => x.id === "data") as Card;
  };
  for (const key of ["CAV-7299", "CAV-7317", "CAV-7296"]) {
    it(`${key}: three rows (previous data fix, queries, index), each instruction once in the card and in its copy`, () => {
      const t = card(key).blocks.find((b) => b.kind === "table");
      assert.ok(t && t.kind === "table");
      assert.deepEqual(t.rows.map((r) => flat(r.cells[0])), ["Fix old data after deploy?", "Database change queries?", "Database index?"]);
      const text = cardText(key, card(key));
      const needle = key === "CAV-7299" ? "cav-7299-delivery-pjp-supplier-date-index.sql" : key === "CAV-7296" ? "cav-7296-ck-user-mobile-index.sql" : "transformer_registration.sql";
      assert.equal(count(needle, text), 1);
    });
  }
  it("CAV-7324 (different wording): the same two topics, answered Done and Not done", () => {
    const t = card("CAV-7324").blocks.find((b) => b.kind === "table");
    assert.ok(t && t.kind === "table");
    assert.deepEqual(t.rows.map((r) => [flat(r.cells[0]), flat(r.cells[1])]), [["Database change queries?", "Done"], ["Database index?", "Not done"]]);
  });
});

describe("audit: a release-page row is never ALSO written as a fact item (every section)", () => {
  const demo = buildChecklist({ environment: "demo", jiras: [unionJira()], branches: [] });
  const items = demo.sections.flatMap((x) => x.items);
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
  it("no db:, deploynote:, restartnote:, app:, role:, sdk, cfgnone: item next to the row that already says it", () => {
    const keys = items.map((i) => i.key);
    for (const prefix of ["db:", "deploynote:", "restartnote:", "app:", "role:", "cfgnone:", "noapproval:"]) assert.ok(!keys.some((k) => k.startsWith(prefix) && !(prefix === "db:" && k === "db:none")), prefix);
    assert.ok(!keys.includes("sdk"));
    assert.ok(keys.includes("row:services_deploy") && keys.includes("row:services_restart") && keys.includes("row:designations") && keys.includes("row:bundle_sdk"));
  });
  it("no two items of the checklist say the same thing (same words, ignoring the row label)", () => {
    const seen = new Map<string, string>();
    for (const i of items) {
      if (i.key.startsWith("rec:") || i.key.startsWith("status:") || i.key === "scope") continue;
      const body = norm(i.text.replace(/^[^:]*: /, ""));
      if (body.length < 25) continue;
      assert.ok(!seen.has(body), `${i.key} repeats ${seen.get(body)}`);
      seen.set(body, i.key);
    }
  });
});

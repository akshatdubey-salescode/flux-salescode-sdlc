/**
 * The "What to deploy" card is built from the server's per-Jira services list (jiraServices: the same helpers as the movement roll-up), not from
 * item texts. Real rows 2 / 12 of the review comments of CAV-7296, 7299, 7304, 7317, 7293 and 7280.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChecklist } from "@/lib/movement/checklist/build";
import { buildRollup } from "@/lib/movement/checklist/rollup";
import { jiraServices } from "@/lib/movement/checklist/services";
import type { ChecklistJiraInput } from "@/lib/movement/checklist/types";
import { parseDeploymentRecord } from "@/lib/movement/record";
import { buildJiraCards, cardText, type Card, type Cell } from "./jira-cards";
import { buildJiraChecklistView } from "./jira-checklist";

const ROWS: Record<string, [string, string]> = {
  "CAV-7296": ["Channel Kart · KPI Dashboard - UI · Flutter app (extra line). No bundle, no Slake", "Channel Kart (code; property needs a cache clear). KPI Dashboard UI: static deploy. App: app-store release. Then the salesrep syncs"],
  "CAV-7299": ["Channel Kart · Slake Reporting (ckcoedemo configs) · Flutter app (extra line) · saleslens-api (extra line). No bundle", "Channel Kart (code; properties need a cache clear). saleslens-api: deploy (the switch reloads hot). Slake Reporting: config reload for ckcoedemo"],
  "CAV-7304": ["Channel Kart · KPI Dashboard - UI · salescode-auth-service (extra line) · Flutter app (extra line). No bundle, no Slake", "Channel Kart and salescode-auth-service (code, Kafka consumer). KPI Dashboard UI: static deploy. App: store release"],
  "CAV-7317": ["Channel Kart · Channelkart Bundle · KPI Dashboard - UI (the report is a DB query row, no jar; no Slake, no Flutter)", "Channel Kart (core deploy; bundle jar load). Transformer registry and report query cache: refresh or restart. KPI Dashboard UI: static deploy, no restart. Bundle: no separate restart"],
  "CAV-7293": ["Channel Kart · KPI Dashboard - UI · Slake Reporting (no bundle, no app)", "Channel Kart (code); properties need cache clear only. Slake Reporting: executor jar + config reload (how: unknown (devops)). KPI Dashboard UI: static deploy, users log in again"],
  "CAV-7295": ["KPI Dashboard - UI only (no backend change, no new network call)", "none (static UI deploy). Users log out and in to pick up the setting"],
  "CAV-7298": ["Channel Kart; Flutter app (extra line)", "Channel Kart. The app is an app-store release, not a restart"],
  "CAV-7300": ["Channel Kart (net). ckcoedemo only, to restore the pre-CAV-7300 state: Channelkart Bundle (jar), Slake Reporting, KPI Dashboard - UI. No app, no stock", "Channel Kart (code; the properties need a cache clear). ckcoedemo: bundle reload after the jar rebuild; Slake Reporting config reload and the temporary reload trigger; KPI UI static deploy"],
  "CAV-7280": ["Slake Reporting only (executor + configs)", "Slake Reporting: executor reload; how: unknown (devops)"],
};

function jiraOf(key: string): ChecklistJiraInput {
  const [d, r] = ROWS[key];
  const body = `DEPLOYMENT-RECORD v2 | ${key} | union of 1 merged PRs | 2026-11-21 09:30 UTC | a\nsupersedes: none\n\nSTATUS   READY\nWHAT     x\nMERGED PRs\n  channelkart#1   master  abcdef1234  one\n\n 2  Services to deploy   ${d}\n12  Services to restart  ${r}\n`;
  const rec = parseDeploymentRecord({ id: key.length, body, created: "2026-11-21T09:30:00.000+0000" });
  assert.ok(rec);
  return { key, included: true, readiness: "ready", records: [rec] };
}
const servicesOf = (key: string) => jiraServices(jiraOf(key).records);
const names = (key: string) => servicesOf(key).services.map((s) => s.name);
const flat = (c: Cell): string => (c.kind === "text" ? c.text : c.kind === "plain" ? [c.plain.lead, ...c.plain.bullets, ...c.plain.more].join(" ") : c.kind === "chips" ? c.chips.map((x) => x.text).join("+") : "");
function cardOf(key: string): Card {
  const j = jiraOf(key);
  const cl = buildChecklist({ environment: "demo", jiras: [j], branches: [] });
  const v = buildJiraChecklistView(cl, jiraServices(j.records));
  return buildJiraCards(v).find((c) => c.id === "deploy") as Card;
}
const tableRows = (card: Card) => {
  const t = card.blocks.find((b) => b.kind === "table");
  return t && t.kind === "table" ? t.rows.map((r) => r.cells.map(flat)) : [];
};

describe("jiraServices: one entry per canonical service", () => {
  it("CAV-7296: Channel Kart, KPI Dashboard - UI, Flutter app (SFA); the app row and 'Flutter app' are ONE service", () => {
    const s = servicesOf("CAV-7296");
    assert.deepEqual(s.services.map((x) => [x.name, x.deploy, x.restart]), [["Channel Kart", true, true], ["KPI Dashboard - UI", true, true], ["Flutter app (SFA)", true, true]]);
    assert.equal(s.services[0].restartNote, "code; property needs a cache clear");
    assert.equal(s.services[1].restartNote, "static deploy");
    assert.equal(s.services[2].restartNote, "app-store release");
    assert.deepEqual(s.also, ["Then the salesrep syncs"]);
    assert.deepEqual(s.notNeeded, ["bundle", "Slake"]);
  });
  it("CAV-7299: Channel Kart, Slake Reporting, Flutter app (SFA), saleslens-api; 'extra line' is not a note; saleslens-api is its own service", () => {
    const s = servicesOf("CAV-7299");
    assert.deepEqual(s.services.map((x) => x.name), ["Channel Kart", "Slake Reporting", "Flutter app (SFA)", "saleslens-api"]);
    const sl = s.services.find((x) => x.name === "saleslens-api");
    assert.deepEqual([sl?.deploy, sl?.restart, sl?.deployNote, sl?.restartNote], [true, true, undefined, "deploy (the switch reloads hot)"]);
    assert.equal(s.services.find((x) => x.name === "Channel Kart")?.restartNote, "code; properties need a cache clear");
    assert.equal(s.services.find((x) => x.name === "Slake Reporting")?.deployNote, "ckcoedemo configs");
    assert.deepEqual(s.notNeeded, ["bundle"]);
    assert.equal(s.services.find((x) => x.name === "Flutter app (SFA)")?.restart, false);
  });
  it("CAV-7304: Channel Kart, KPI Dashboard - UI, salescode-auth-service, Flutter app (SFA)", () => {
    assert.deepEqual([...names("CAV-7304")].sort(), ["Channel Kart", "Flutter app (SFA)", "KPI Dashboard - UI", "salescode-auth-service"]);
    assert.equal(servicesOf("CAV-7304").services.find((x) => x.name === "salescode-auth-service")?.restartNote, "code, Kafka consumer");
    assert.deepEqual(servicesOf("CAV-7304").notNeeded, ["bundle", "Slake"]);
  });
  it("CAV-7317: Channel Kart, Channelkart Bundle, KPI Dashboard - UI; negations leave the note; the registry/cache line is an 'also'; 'no restart' means no restart", () => {
    const s = servicesOf("CAV-7317");
    assert.deepEqual([...names("CAV-7317")].sort(), ["Channel Kart", "Channelkart Bundle", "KPI Dashboard - UI"]);
    const kpi = s.services.find((x) => x.name === "KPI Dashboard - UI");
    assert.deepEqual([kpi?.deploy, kpi?.restart, kpi?.deployNote], [true, false, "the report is a DB query row; static deploy"]);
    const bundle = s.services.find((x) => x.name === "Channelkart Bundle");
    assert.deepEqual([bundle?.deploy, bundle?.restart], [true, false]);
    assert.deepEqual(s.also, ["Transformer registry and report query cache: refresh or restart"]);
    assert.deepEqual(s.notNeeded, ["jar", "Slake", "Flutter"]);
  });
  it("CAV-7293: Channel Kart, KPI Dashboard - UI, Slake Reporting; CAV-7280: Slake Reporting only", () => {
    assert.deepEqual([...names("CAV-7293")].sort(), ["Channel Kart", "KPI Dashboard - UI", "Slake Reporting"]);
    assert.deepEqual(servicesOf("CAV-7293").notNeeded, ["bundle", "app"]);
    assert.deepEqual(names("CAV-7280"), ["Slake Reporting"]);
  });
  it("CAV-7295 / 7298 / 7300: a clause is one 'also' line, never two fragments or a service; descriptors stay in the note", () => {
    const a = servicesOf("CAV-7295");
    assert.deepEqual(a.services.map((x) => [x.name, x.deploy, x.restart, x.deployNote]), [["KPI Dashboard - UI", true, false, "no backend change, no new network call"]]);
    assert.deepEqual(a.also, ["Users log out and in to pick up the setting"]);
    assert.deepEqual(a.notNeeded, []);
    const b = servicesOf("CAV-7298");
    assert.deepEqual(b.services.map((x) => [x.name, x.deploy, x.restart]), [["Channel Kart", true, true], ["Flutter app (SFA)", true, false]]);
    assert.deepEqual(b.also, ["The app is an app-store release, not a restart"]);
    const c = servicesOf("CAV-7300");
    assert.deepEqual([...c.services.map((x) => x.name)].sort(), ["Channel Kart", "KPI Dashboard - UI", "Slake Reporting"]);
    assert.deepEqual(c.notNeeded, ["app", "stock"]);
    assert.ok(c.also.some((x) => /^ckcoedemo: bundle reload after the jar rebuild; Slake Reporting config reload/.test(x)));
  });
  it("a negation never names a service the Jira lists, and every fact is said once", () => {
    for (const k of Object.keys(ROWS)) {
      const s = servicesOf(k);
      const listed = new Set(s.services.map((x) => x.name.toLowerCase()));
      for (const n of s.notNeeded) assert.ok(!listed.has(n.toLowerCase()), `${k}: ${n}`);
      for (const x of s.services) assert.ok(!x.restartNote || !x.deployNote || x.restartNote !== x.deployNote, `${k}: ${x.name}`);
    }
  });
});

describe("the What to deploy card = the roll-up's services for the same Jira", () => {
  for (const key of Object.keys(ROWS)) {
    it(`${key}: same service names in the card, the server list and the movement board`, () => {
      const card = tableRows(cardOf(key)).map((r) => r[0]);
      const board = buildRollup({ environment: "demo", jiras: [jiraOf(key)], branches: [] }).sections.find((s) => s.id === "deploy")!.entries.filter((e) => e.key.startsWith("svc:")).map((e) => e.title);
      assert.deepEqual([...card].sort(), [...board].sort());
      assert.deepEqual([...card].sort(), [...names(key)].sort());
    });
  }
  for (const key of Object.keys(ROWS)) {
    it(`${key}: the services the card restarts are the ones the movement's "Services to restart" board lists`, () => {
      const restartBoard = buildRollup({ environment: "demo", jiras: [jiraOf(key)], branches: [] }).sections.find((s) => s.id === "restart")!.entries.filter((e) => e.key.startsWith("restart:") && e.key !== "restart:none").map((e) => e.title);
      const restartCard = servicesOf(key).services.filter((x) => x.restart).map((x) => x.name);
      assert.deepEqual([...restartCard].sort(), [...restartBoard].sort());
    });
  }
  it("CAV-7296 card: three rows, the app row and the Flutter row merged, 'Also' and 'Not needed' lines, copy text the same", () => {
    const card = cardOf("CAV-7296");
    const rows = tableRows(card);
    assert.deepEqual(rows.map((r) => r[0]), ["Channel Kart", "KPI Dashboard - UI", "Flutter app (SFA)"]);
    assert.equal(rows[2][1], "Deploy+Restart");
    assert.equal(rows[2][2], "app-store release");
    const t = cardText("CAV-7296", card);
    assert.match(t, /Not needed: bundle, Slake/);
    assert.match(t, /Then the salesrep syncs/);
    assert.ok(!/extra line|No bundle, no Slake/.test(t));
    assert.equal((t.match(/Flutter app/g) ?? []).length, 1);
  });
  it("CAV-7317 card: the registry/cache line is under the table as one 'Also' line, not a service row", () => {
    const t = cardText("CAV-7317", cardOf("CAV-7317"));
    assert.ok(!/^- Transformer/m.test(t.split("Also:")[0]));
    assert.match(t, /Also:\n- Transformer registry and report query cache: refresh or restart/);
    assert.match(t, /Not needed: jar, Slake, Flutter/);
  });
});

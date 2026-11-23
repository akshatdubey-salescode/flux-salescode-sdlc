/**
 * The Summary board's wording: whole sentences (never a cut-off "…"), an outcome sentence that adds to the title, no repeated counts, and the plain
 * unknown-owner wording, on the 13-Jira movement, the real fixtures and the real CAV-7293 / CAV-7296 strings.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ParsedRecord } from "../record";
import { RECORD_FIXTURES_V2, loadFixture } from "../record/testkit";
import { parseDeploymentRecord } from "../record";
import { unknownClause } from "./build";
import { capWhole } from "./normalize";
import { buildRollup, fewJiras, fitWhole, serviceParts, shortTitle, type Rollup } from "./rollup";
import { realJiras, unionJira, unionRecord } from "./testkit";
import type { ChecklistInput, ChecklistJiraInput } from "./types";

const input = (jiras: ChecklistJiraInput[], environment: ChecklistInput["environment"] = "prod"): ChecklistInput => ({ environment, jiras, branches: [] });
function setRow(r: ParsedRecord, rowId: string, state: string, answer: string, text = "") {
  const row = (r.facts.releaseRows ?? []).find((x) => x.id === rowId);
  assert.ok(row);
  Object.assign(row, { state, answer, text });
}
function thirteen(): ChecklistJiraInput[] {
  return Array.from({ length: 13 }, (_, i) => {
    const r: ParsedRecord = JSON.parse(JSON.stringify(unionRecord()));
    r.comment.id = String(90000 + i);
    r.marker.key = `CAV-${7280 + i}`;
    (r.facts.covers ?? []).forEach((c, k) => (c.pr = 9000 + i * 10 + k));
    setRow(r, "code_reviewed", i % 6 === 0 ? "not_done" : "done", i % 6 === 0 ? "Not Done: pending approval" : "Done", i % 6 === 0 ? "pending approval" : "");
    setRow(r, "meeting", "unknown", "unknown (release manager)", "(release manager)");
    return { key: `CAV-${7280 + i}`, included: true, readiness: "ready", records: [r] };
  });
}
const all = (r: Rollup) => r.sections.flatMap((s) => s.entries);
const texts = (r: Rollup): string[] => [...all(r).flatMap((e) => [e.title, e.line, ...(e.details ?? []).map((d) => d.text)]), ...r.atAGlance.flatMap((g) => [g.title, g.detail])];

describe("whole sentences: nothing is cut with '…'", () => {
  it("fitWhole keeps whole sentences and counts the rest", () => {
    assert.equal(fitWhole("One. Two. Three.", 100), "One. Two. Three.");
    assert.equal(fitWhole("First sentence here. Second sentence here. Third sentence here.", 45), "First sentence here. Second sentence here. (+1 more)");
    const one = "A single very long sentence without any stop that goes on and on";
    assert.equal(fitWhole(one, 20), one);
  });
  it("shortTitle ends at a clause or a word, never with '…'", () => {
    assert.equal(shortTitle("Previous data fix required? YES reports: after deploy run each of the 3 reports once with full: true per tenant"), "Previous data fix required? YES reports");
    assert.ok(!shortTitle("x ".repeat(100)).endsWith("…"));
    assert.equal(shortTitle("short"), "short");
  });
  it("fewJiras names at most four keys", () => {
    assert.equal(fewJiras(["A-1", "A-2", "A-3", "A-4"]), "A-1, A-2, A-3, A-4");
    assert.equal(fewJiras(["A-1", "A-2", "A-3", "A-4", "A-5", "A-6"]), "A-1, A-2, A-3 +3 more");
  });
  it("no title, line, detail or glance text of the 13-Jira movement, the real fixtures or the union comment ends with '…'", () => {
    const by: Record<string, ChecklistJiraInput> = {};
    for (const n of RECORD_FIXTURES_V2) {
      const rec = parseDeploymentRecord(loadFixture(n));
      assert.ok(rec);
      (by[n.slice(0, 8)] ??= { key: n.slice(0, 8), included: true, readiness: "ready", records: [] }).records.push(rec);
    }
    for (const r of [buildRollup(input(thirteen())), buildRollup(input(realJiras())), buildRollup(input([unionJira()], "demo")), buildRollup(input(Object.values(by)))]) {
      for (const t of texts(r)) assert.ok(!t.endsWith("…"), t.slice(-60));
    }
  });
});

describe("the Summary column is one outcome sentence", () => {
  const r = buildRollup(input(thirteen()));
  const entry = (key: string) => all(r).find((e) => e.key === key) as NonNullable<ReturnType<typeof all>[number]>;
  it("a row says who is not done and how many are done, without repeating the title", () => {
    const e = entry("row:code_reviewed");
    assert.equal(e.line, "3 Jiras not done: CAV-7280, CAV-7286, CAV-7292 · 10 done");
    assert.ok(!e.line.includes(e.title));
  });
  it("an unknown row says how many Jiras still need an answer and from whom, not '13 unknown'", () => {
    assert.equal(entry("row:meeting").line, "All 13 Jiras still need an answer from release manager");
  });
  it("a held review says what it means; the Jiras are in the Jiras column, not in the text", () => {
    const h = all(buildRollup(input([unionJira()], "demo"))).find((e) => e.key === "status:HELD");
    if (h) {
      assert.equal(h.line, "Not ready to release as reviewed");
      assert.ok(!/CAV-\d/.test(h.line));
    }
    const glance = r.atAGlance.find((g) => g.id === "held");
    if (glance) assert.ok(!/CAV-\d/.test(glance.detail));
  });
  it("services, restarts, the app release and the SDK build: a plain action, no 'N Jiras' echo", () => {
    for (const e of all(r).filter((x) => x.key.startsWith("svc:") || x.key.startsWith("restart:"))) assert.ok(!/\d+ Jiras?\b/.test(e.line), e.line);
    assert.equal(entry("app").line, "Not needed");
  });
});

describe("fake services from 'No bundle, no Slake' no longer reach the roll-up", () => {
  it("CAV-7296 / CAV-7294 / CAV-7299 rows give the real services only", () => {
    const mk = (key: string, deploy: string, restart: string): ChecklistJiraInput => {
      const body = `DEPLOYMENT-RECORD v2 | ${key} | union of 1 merged PRs | 2026-11-21 09:30 UTC | a\nsupersedes: none\n\nSTATUS   READY\nWHAT     x\nMERGED PRs\n  channelkart#1   master  abcdef1234  one\n\n 2  Services to deploy   ${deploy}\n12  Services to restart  ${restart}\n`;
      const rec = parseDeploymentRecord({ id: key.length, body, created: "2026-11-21T09:30:00.000+0000" });
      assert.ok(rec);
      return { key, included: true, readiness: "ready", records: [rec] };
    };
    const r = buildRollup(
      input(
        [
          mk("CAV-7296", "Channel Kart · KPI Dashboard - UI · Flutter app (extra line). No bundle, no Slake", "Channel Kart (code; property needs a cache clear). KPI Dashboard UI: static deploy. App: app-store release"),
          mk("CAV-7294", "Slake Reporting only (configs, sinks, schedules). Nothing for Channel Kart, bundle, UI or app", "Slake Reporting: config and schedule reload, plus cache clear. No Channel Kart restart, no app release"),
        ],
        "demo",
      ),
    );
    const deploy = all(r).filter((e) => e.key.startsWith("svc:")).map((e) => e.title);
    assert.deepEqual(deploy.sort(), ["Flutter app (SFA)", "KPI Dashboard - UI", "Channel Kart", "Slake Reporting"].sort());
    for (const bad of ["no Slake", "no UI", "UI or app", "bundle", "No bundle"]) assert.ok(!deploy.some((d) => d.toLowerCase() === bad.toLowerCase()), bad);
  });
});

describe("unknown clauses", () => {
  it("one long row with three owners gives each owner its own whole clause", () => {
    const answer = "Yes four switches, all default off. Current values on each LOB: unknown (devops config compare). Oldest build: unknown (mobile lead). The rest is fine.";
    assert.equal(unknownClause("Configs to add or update", answer, "devops config compare"), "Configs to add or update: Current values on each LOB: unknown (devops config compare).");
    assert.equal(unknownClause("Production meeting + everyone invited", "unknown (release manager)", "release manager"), "Production meeting + everyone invited unknown (release manager)");
  });
});

describe("service names stored by an older reader are tidied on read (real stored names of the DEMO movement)", () => {
  it("'A · B' is two services, 'Name: what is done' is a service and a note, 'no X' is not a service", () => {
    assert.deepEqual(serviceParts({ name: "Channel Kart · Channelkart Bundle", note: "when the stack lands" }), [{ name: "Channel Kart" }, { name: "Channelkart Bundle", note: "when the stack lands" }]);
    assert.deepEqual(serviceParts({ name: "KPI Dashboard UI: static deploy" }), [{ name: "KPI Dashboard UI", note: "static deploy" }]);
    assert.deepEqual(serviceParts({ name: "App: app-store release" }), [{ name: "App", note: "app-store release" }]);
    assert.deepEqual(serviceParts({ name: "no Slake" }), []);
    assert.deepEqual(serviceParts({ name: "no UI" }), []);
    assert.deepEqual(serviceParts({ name: "UI or app" }), []);
    assert.deepEqual(serviceParts({ name: "cache clear. No Channel Kart restart" }), []);
    assert.deepEqual(serviceParts({ name: "in to pick up the setting" }), []);
    assert.deepEqual(serviceParts({ name: "saleslens-api", note: "extra line" }), [{ name: "saleslens-api", note: "extra line" }]);
    assert.deepEqual(serviceParts({ name: "Slake Reporting only", note: "configs" }), [{ name: "Slake Reporting", note: "configs" }]);
  });
  it("clauses about people or the app are not services; 'bundle reload' is the Channelkart Bundle (real names of the DEMO movement)", () => {
    assert.deepEqual(serviceParts({ name: "Users log out" }), []);
    assert.deepEqual(serviceParts({ name: "app is an app-store release" }), []);
    assert.deepEqual(serviceParts({ name: "schedule reload" }), []);
    assert.deepEqual(serviceParts({ name: "Channel Kart · bundle reload" }), [{ name: "Channel Kart" }, { name: "Channelkart Bundle", note: "reload" }]);
  });
  it("a title is shortened at a clause outside brackets", () => {
    assert.equal(shortTitle("DB change queries shared Done (no DDL: loginId, startDate, endDate are transient) and more words after that here", 80), "DB change queries shared Done (no DDL: loginId, startDate, endDate are transient)");
  });
});

describe("capWhole: the checklist keeps whole sentences", () => {
  it("keeps what fits, counts the rest, and cuts a single huge sentence only past 1.5 x the limit", () => {
    assert.equal(capWhole("One. Two.", 50), "One. Two.");
    assert.equal(capWhole("Code reviewed: done. Breakage risk: low, via shared screen. Second part is here.", 60), "Code reviewed: done. Breakage risk: low, via shared screen. (+1 more)");
    const long = `${"word ".repeat(100)}end`;
    const cut = capWhole(long, 100);
    assert.ok(cut.endsWith("…") && cut.length <= 152);
    assert.ok(!capWhole("A. B. C. D. E.", 6).endsWith("…"));
  });
});

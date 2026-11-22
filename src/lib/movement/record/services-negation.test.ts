/**
 * "No bundle, no Slake" / "Nothing for Channel Kart, bundle, UI or app" say what is NOT deployed: they are never services. Real row-2 / row-12 answers of the
 * review comments of CAV-7294, 7296, 7298, 7299, 7304, 7324 and 7346 (DEMO movement, 21 Nov 2026).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDeploymentRecord } from "./parse";

function rowOnly(deploy: string, restart: string) {
  const body = `DEPLOYMENT-RECORD v2 | CAV-7296 | union of 1 merged PRs | 2026-11-21 09:30 UTC | a
supersedes: none

STATUS   READY
WHAT     x
MERGED PRs
  channelkart#1   master  abcdef1234  one

 2  Services to deploy   ${deploy}
12  Services to restart  ${restart}
`;
  const r = parseDeploymentRecord({ id: 1, body, created: "2026-11-21T09:30:00.000+0000" });
  assert.ok(r);
  return r.facts;
}
const names = (l: Array<{ name: string }> | undefined) => (l ?? []).map((s) => s.name);

describe("services of rows 2 and 12: what is left out is not a service", () => {
  it("CAV-7296: 'Channel Kart · KPI Dashboard - UI · Flutter app (extra line). No bundle, no Slake'", () => {
    const f = rowOnly("Channel Kart · KPI Dashboard - UI · Flutter app (extra line). No bundle, no Slake", "Channel Kart (code; property needs a cache clear). KPI Dashboard UI: static deploy. App: app-store release. Then the salesrep syncs");
    assert.deepEqual(names(f.deploy), ["Channel Kart", "KPI Dashboard - UI", "Flutter app"]);
    assert.ok(f.deployNotes?.some((n) => /^No bundle, no Slake$/.test(n)));
    assert.deepEqual(names(f.restart), ["Channel Kart", "KPI Dashboard UI", "App"]);
    assert.equal(f.restart?.[1].note, "static deploy");
    assert.ok(!names(f.deploy).concat(names(f.restart)).some((n) => /^no\b/i.test(n)));
  });
  it("CAV-7294: 'Slake Reporting only (...). Nothing for Channel Kart, bundle, UI or app' has ONE service", () => {
    const f = rowOnly("Slake Reporting only (configs, sinks, schedules). Nothing for Channel Kart, bundle, UI or app", "Slake Reporting: config and schedule reload, plus cache clear. No Channel Kart restart, no app release");
    assert.deepEqual(names(f.deploy), ["Slake Reporting"]);
    assert.equal(f.deploy?.[0].note, "configs, sinks, schedules");
    assert.deepEqual(names(f.restart), ["Slake Reporting"]);
    assert.ok(f.deployNotes?.some((n) => /^Nothing for Channel Kart, bundle, UI or app$/.test(n)));
  });
  it("CAV-7299: 'Channel Kart · Slake Reporting (ckcoedemo configs) · Flutter app (extra line) · saleslens-api (extra line). No bundle, no UI'", () => {
    const f = rowOnly("Channel Kart · Slake Reporting (ckcoedemo configs) · Flutter app (extra line) · saleslens-api (extra line). No bundle, no UI", "Channel Kart (code; properties need a cache clear). saleslens-api: deploy (the switch reloads hot). Slake Reporting: config reload for ckcoedemo. App: app-store release");
    assert.deepEqual(names(f.deploy), ["Channel Kart", "Slake Reporting", "Flutter app", "saleslens-api"]);
    assert.deepEqual(names(f.restart), ["Channel Kart", "saleslens-api", "Slake Reporting", "App"]);
  });
  it("CAV-7324: 'Channel Kart · Channelkart Bundle (when the stack lands)' is two services; CAV-7298 'Channel Kart; Flutter app (extra line)'", () => {
    assert.deepEqual(names(rowOnly("Channel Kart · Channelkart Bundle (when the stack lands)", "Channel Kart · bundle reload").deploy), ["Channel Kart", "Channelkart Bundle"]);
    assert.deepEqual(names(rowOnly("Channel Kart; Flutter app (extra line)", "Channel Kart. The app is an app-store release, not a restart").deploy), ["Channel Kart", "Flutter app"]);
  });
  it("CAV-7304: 'Channel Kart and salescode-auth-service (code, Kafka consumer)' is two services", () => {
    const f = rowOnly("Channel Kart · KPI Dashboard - UI · salescode-auth-service (extra line) · Flutter app (extra line). No bundle, no Slake", "Channel Kart and salescode-auth-service (code, Kafka consumer). KPI Dashboard UI: static deploy. App: store release");
    assert.deepEqual(names(f.restart), ["Channel Kart", "salescode-auth-service", "KPI Dashboard UI", "App"]);
  });
  it("CAV-7317: 'Transformer registry and report query cache: refresh or restart' is ONE note; 'KPI Dashboard UI: static deploy, no restart' and 'Bundle: no separate restart' keep their note", () => {
    const f = rowOnly("Channel Kart · Channelkart Bundle · KPI Dashboard - UI (the report is a DB query row, no jar; no Slake, no Flutter)", "Channel Kart (core deploy; bundle jar load). Transformer registry and report query cache: refresh or restart. KPI Dashboard UI: static deploy, no restart. Bundle: no separate restart");
    assert.deepEqual(names(f.restart), ["Channel Kart", "KPI Dashboard UI", "Bundle"]);
    assert.deepEqual(f.restartNotes, ["Transformer registry and report query cache: refresh or restart"]);
    assert.equal(f.restart?.[1].note, "static deploy, no restart");
    assert.equal(f.restart?.[2].note, "no separate restart");
    assert.equal(f.deploy?.[2].note, "the report is a DB query row, no jar; no Slake, no Flutter");
  });
  it("CAV-7295 / 7298 / 7300: a sentence with no service in it is ONE note, not two fragments", () => {
    const a = rowOnly("KPI Dashboard - UI only (no backend change, no new network call)", "none (static UI deploy). Users log out and in to pick up the setting");
    assert.deepEqual(a.restartNotes, ["none (static UI deploy)", "Users log out and in to pick up the setting"]);
    assert.equal(a.restart, undefined);
    assert.deepEqual(rowOnly("Channel Kart; Flutter app (extra line)", "Channel Kart. The app is an app-store release, not a restart").restartNotes, ["The app is an app-store release, not a restart"]);
    const c = rowOnly("Channel Kart (net). ckcoedemo only, to restore the pre-CAV-7300 state: Channelkart Bundle (jar), Slake Reporting, KPI Dashboard - UI. No app, no stock", "Channel Kart (code; the properties need a cache clear). ckcoedemo: bundle reload after the jar rebuild; Slake Reporting config reload and the temporary reload trigger; KPI UI static deploy");
    assert.deepEqual(names(c.restart), ["Channel Kart"]);
    assert.equal(c.restartNotes?.length, 1);
    assert.deepEqual(names(c.deploy), ["Channel Kart", "Slake Reporting", "KPI Dashboard - UI"]);
  });
  it("rows wrapped over two lines: a bracket cut by the wrap is one text, a '(remark)' line belongs to the service before it", () => {
    const body = `DEPLOYMENT-RECORD v2 | CAV-7317 | union of 1 merged PRs | 2026-11-21 09:30 UTC | a
supersedes: none

STATUS   READY
WHAT     x
MERGED PRs
  channelkart#1   master  abcdef1234  one

 2  Services to deploy   Channel Kart · Channelkart Bundle · KPI Dashboard - UI
                         (the report is a DB query row, no jar; no Slake, no Flutter)
12  Services to restart  Channel Kart (code); properties need cache clear only. Slake Reporting: executor jar + config reload (how: unknown
                         (devops)). KPI Dashboard UI: static deploy, users log in again
`;
    const r = parseDeploymentRecord({ id: 9, body, created: "2026-11-21T09:30:00.000+0000" });
    assert.ok(r);
    const f = r.facts;
    assert.deepEqual(names(f.deploy), ["Channel Kart", "Channelkart Bundle", "KPI Dashboard - UI"]);
    assert.equal(f.deploy?.[2].note, "the report is a DB query row, no jar; no Slake, no Flutter");
    assert.equal(f.deployNotes, undefined);
    assert.deepEqual(f.restart?.map((x) => [x.name, x.note]), [["Channel Kart", "code; properties need cache clear only"], ["Slake Reporting", "executor jar + config reload (how: unknown (devops))"], ["KPI Dashboard UI", "static deploy, users log in again"]]);
    assert.equal(f.restartNotes, undefined);
  });
});

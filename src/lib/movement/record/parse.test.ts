import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDeploymentRecord } from "./parse";
import { approxBytes } from "./pick";
import { loadFixture, RECORD_FIXTURES } from "./testkit";
import type { ParsedRecord } from "./types";

function load(name: string): ParsedRecord {
  const r = parseDeploymentRecord(loadFixture(name));
  assert.ok(r, `${name} must parse`);
  return r;
}

const refKeys = (refs: Array<{ repo: string; pr: number }> | undefined) => (refs ?? []).map((r) => `${r.repo}#${r.pr}`);

describe("real record 81399 (CAV-7346 channelkart#1184)", () => {
  const r = load("CAV-7346-81399");
  it("reads the marker, status and counts", () => {
    assert.deepEqual(
      { v: r.marker.version, key: r.marker.key, repo: r.marker.repo, pr: r.marker.pr, at: r.marker.at, sup: r.marker.supersedes },
      { v: 1, key: "CAV-7346", repo: "channelkart", pr: 1184, at: "2026-11-19T11:30:00.000Z", sup: null },
    );
    assert.equal(r.marker.agent, "Claude (pr-review)");
    assert.equal(r.status, "BLOCKED");
    assert.equal(r.statusText, "BLOCKED for release (4 open Should-fix, 0 Blocking)");
    assert.deepEqual(r.counts, { shouldFix: 4, blocking: 0 });
    assert.equal(r.facts.headReviewed, "87ee77d2b2");
    assert.equal(r.comment.id, "81399");
    assert.deepEqual(r.warnings, []);
  });
  it("has the 14 sections, resolved by number", () => {
    assert.deepEqual(r.sections.map((s) => s.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    assert.ok(r.sections.every((s) => s.canonical !== null));
    // The JSON block is not part of section 14's text.
    assert.doesNotMatch(r.sections[13].text, /"marker"/);
    assert.equal(r.json?.status, "BLOCKED");
  });
  it("reads the 6 config rows by header name with demo/uat/prod columns", () => {
    const cfg = r.facts.configs!;
    assert.equal(cfg.length, 6);
    // The table is held once: its rows live in facts.configs (all columns), not in sections too.
    assert.deepEqual(r.sections[7].tables, []);
    assert.deepEqual(
      { key: cfg[0].key, store: cfg[0].store, def: cfg[0].default, demo: cfg[0].demo, uat: cfg[0].uat, prod: cfg[0].prod },
      { key: "partner.banner.enabled", store: "per-LOB property", def: "off (403 EG243)", demo: "on (ckcoedemo) [author]", uat: "unknown", prod: "unknown" },
    );
    assert.ok(cfg.every((c) => c.source === "table" && c.prod === "unknown"));
    assert.equal(cfg[5].key, "outlet_activity_configuration.partnerBannerEnabled");
  });
  it("finds siblings, PR facts and open unknowns with owners", () => {
    assert.deepEqual(refKeys(r.facts.siblings), ["kpi-dashboard#267", "channelkart-flutter#49"]);
    assert.ok(r.facts.siblings!.every((s) => s.state === "open"));
    assert.deepEqual(
      { branch: r.facts.branch, base: r.facts.baseBranch, state: r.facts.prState, author: r.facts.author, approvers: r.facts.approvers, merged: r.facts.mergedBy, r31: r.facts.rule31 },
      { branch: "CAV-7346-partner-banner-pr", base: "master", state: "open", author: "dev-a", approvers: [], merged: null, r31: "pass" },
    );
    const owners = new Set(r.unknowns.map((u) => u.owner));
    assert.ok(owners.has("devops") && owners.has("author") && owners.has("deployer"));
    assert.ok(owners.has(null)); // "owner to confirm" with nobody named
    const devops = r.unknowns.find((u) => u.owner === "devops")!;
    assert.equal(devops.section, 3);
    assert.match(devops.text, /prod branch: unknown/);
    assert.equal(r.facts.downtime, "unknown");
    assert.equal(r.facts.bundleSdkBuild, "no");
  });
  it("keeps the JSON steps (4) and reads gates, rollback and risks with severity", () => {
    const o = r.facts.order!;
    assert.equal(o.jsonSteps!.length, 4);
    assert.equal(o.steps.length, 4);
    assert.equal(o.stepsSource, "text");
    assert.equal(o.gates.length, 3);
    assert.match(o.rollback!, /property off/);
    assert.deepEqual(r.facts.risks!.filter((x) => x.severity === "Should-fix").length, 4);
    assert.equal(r.facts.risks!.filter((x) => x.severity === "Nitpick").length, 3);
    assert.equal(r.facts.testing!.testCount, 92);
    assert.equal(r.facts.testing!.noCi, true);
    assert.equal(r.facts.roles!.length, 3);
    assert.equal(r.facts.roles![2].negative, true);
    assert.equal(r.facts.verification!.length, 4);
    // Evidence tags are kept per section.
    assert.ok(r.sections[7].tags.some((t) => t.tag === "author"));
    assert.ok(r.sections[0].tags.some((t) => t.tag === "V"));
  });
});

describe("real record 81422 (CAV-7304 channelkart#1185)", () => {
  const r = load("CAV-7304-81422");
  it("reads the moved head, the replaced PR and the config from table and JSON", () => {
    assert.equal(r.facts.headReviewed, "f249c2be9c");
    assert.equal(r.facts.headMovedTo, "e2ad816ab0");
    assert.equal(r.facts.headMovedUnreviewed, true);
    assert.deepEqual(r.facts.replaces, [{ pr: 1160, state: "closed" }]);
    assert.equal(r.facts.mergeable, true);
    assert.deepEqual(refKeys(r.facts.siblings), ["salescode-auth-service#332", "kpi-dashboard#269", "channelkart-flutter#50"]);
    const cfg = r.facts.configs!;
    assert.equal(cfg.length, 1);
    // JSON `defaultWhenAbsent` merged with the table's longer text; no disagreement raised.
    assert.deepEqual({ key: cfg[0].key, src: cfg[0].source, def: cfg[0].default }, { key: "verify.active.session.enabled", src: "both", def: "off (nothing changes)" });
    assert.deepEqual(r.warnings, []);
  });
  it("reads a numbered deploy order with gates and rollback", () => {
    const o = r.facts.order!;
    assert.equal(o.steps.length, 5);
    assert.deepEqual(o.steps[0].refs, [{ repo: "channelkart", pr: 1185 }]);
    assert.match(o.steps[4].text, /^per tenant/);
    assert.equal(o.gates.length, 4);
    assert.equal(o.rollback, "properties off");
    assert.equal(r.facts.risks!.length, 6);
    assert.equal(r.facts.backwardCompat!.undo, "property off");
  });
});

describe("real record 81423 (CAV-7304 salescode-auth-service#332)", () => {
  const r = load("CAV-7304-81423");
  it("reads the three account.lock.* configs and the protected-logins default text", () => {
    const cfg = r.facts.configs!;
    assert.deepEqual(cfg.map((c) => c.key), ["account.lock.enabled", "account.lock.grace.seconds", "account.lock.protected.logins"]);
    assert.match(cfg[1].default!, /^120 \(ticket said 300\)/);
    assert.match(cfg[2].default!, /^empty \(nobody protected; CAVIN must be listed/);
    assert.ok(cfg.every((c) => c.source === "both")); // the JSON lists the same three keys
    assert.equal(r.marker.repo, "salescode-auth-service");
    assert.deepEqual(r.facts.replaces, [{ pr: 330, state: "closed" }]);
  });
  it("treats the JSON's longer step list as the steps when the text is prose (no false warning)", () => {
    const o = r.facts.order!;
    assert.equal(o.stepsSource, "json");
    assert.equal(o.steps.length, 4);
    assert.equal(r.warnings.length, 0);
    assert.deepEqual(r.facts.prodBranch, { branch: null, unknown: true });
    assert.equal(r.facts.database!.section, 7);
  });
});

describe("real record 81424 (CAV-7304 kpi-dashboard#269)", () => {
  const r = load("CAV-7304-81424");
  it("section 8 says none in this PR: no config rows, but it points at the siblings", () => {
    assert.equal(r.facts.configsNone, true);
    assert.deepEqual(r.facts.configs, []);
    assert.deepEqual(refKeys(r.facts.configsSeeRefs), ["channelkart#1185", "salescode-auth-service#332"]);
    assert.equal(r.sections[7].tables.length, 0);
    assert.match(r.sections[7].text, /^none in this PR/);
  });
  it("reads prod branch prod-17-july-blue, PARTIAL status and portal-only facts", () => {
    assert.equal(r.facts.prodBranch!.branch, "prod-17-july-blue");
    assert.equal(r.facts.prodBranch!.isPattern, undefined);
    assert.equal(r.status, "PARTIAL");
    assert.deepEqual(r.counts, { blocking: 0, shouldFix: 0, nitpick: 1 });
    assert.equal(r.facts.restartNone, true);
    assert.equal(r.facts.downtime, "no");
    assert.equal(r.facts.appRelease!.applicable, false);
    assert.equal(r.facts.risks![0].severity, "Nitpick");
    assert.equal(r.facts.risks![0].text, "the 90 s cap is a new rule not yet in Jira");
  });
});

describe("real records 81400, 81421, 81425", () => {
  it("81400 kpi-dashboard#267: three configs, gate and rollback", () => {
    const r = load("CAV-7346-81400");
    assert.equal(r.marker.pr, 267);
    assert.equal(r.status, "PARTIAL");
    assert.deepEqual(r.facts.configs!.map((c) => c.key), [
      "partnerBanner in *_portal_feature_configuration",
      "partnerBanner sidebar option",
      "channelkart partner.banner.enabled",
    ]);
    assert.equal(r.facts.configs![2].demo, "on");
    assert.match(r.facts.order!.gates[0], /server validates imageUrl/);
    assert.equal(r.facts.order!.rollback, "remove the keys / redeploy");
  });
  it("81421 channelkart-flutter#49: app build, mobile lead owner, config rows", () => {
    const r = load("CAV-7346-81421");
    assert.equal(r.marker.repo, "channelkart-flutter");
    assert.equal(r.facts.deploy![0].name, "Flutter app build");
    assert.equal(r.facts.appRelease!.applicable, true);
    assert.ok(r.unknowns.some((u) => u.owner === "mobile lead" && u.section === 6));
    assert.equal(r.facts.configs!.length, 2);
    assert.equal(r.facts.configs![0].default, '"false" (no banner, no call)');
    assert.equal(r.facts.prodBranch!.branch, null);
  });
  it("81425 channelkart-flutter#50: replaces #45, no configs, TC_43 gate", () => {
    const r = load("CAV-7304-81425");
    assert.equal(r.marker.pr, 50);
    assert.deepEqual(r.facts.replaces, [{ pr: 45, state: "closed" }]);
    assert.equal(r.facts.configsNone, true);
    assert.ok(r.facts.order!.gates.some((g) => g.startsWith("TC_43")));
    assert.equal(r.facts.order!.rollback, "next app release");
  });
});

describe("whole-set properties", () => {
  it("parses all 7 fast, with no warnings, and bounded size", () => {
    const t0 = performance.now();
    const recs = RECORD_FIXTURES.map(load);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `${ms.toFixed(1)} ms for 7`);
    for (const r of recs) {
      assert.deepEqual(r.warnings, [], r.comment.id);
      const b = approxBytes(r);
      assert.ok(b > 2_000 && b < 40_000, `${r.comment.id}: ${b} bytes`);
      // No information lost: every section's raw text is kept.
      assert.equal(r.sections.length, 14);
    }
  });
});

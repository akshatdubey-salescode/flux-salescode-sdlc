import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChecklist } from "./build";
import { jira, realJiras, synth } from "./testkit";
import type { Checklist, ChecklistItem, SectionId } from "./types";

const sec = (cl: Checklist, id: SectionId) => (cl.sections.find((s) => s.id === id) as Checklist["sections"][number]).items;
const item = (cl: Checklist, id: SectionId, key: string): ChecklistItem => {
  const hit = sec(cl, id).find((i) => i.key === key);
  assert.ok(hit, `${id}/${key} missing; have ${sec(cl, id).map((i) => i.key).join(" | ")}`);
  return hit;
};
const prs = (i: ChecklistItem) => i.sources.map((s) => s.pr);
const build = (env: "demo" | "uat" | "prod", jiras = realJiras(), branches: Array<{ repo: string; branch: string }> = []) => buildChecklist({ environment: env, jiras, branches });

describe("real records: CAV-7346 (3 PRs) + CAV-7304 (4 PRs)", () => {
  const t0 = performance.now();
  const prod = build("prod");
  const ms = performance.now() - t0;

  it("lists Channel Kart once under deploy with the sources of both Jiras, in release-page order", () => {
    const deploy = sec(prod, "deploy");
    assert.equal(deploy.filter((i) => i.key === "svc:channel kart").length, 1);
    const ck = item(prod, "deploy", "svc:channel kart");
    assert.ok(prs(ck).includes("channelkart#1184") && prs(ck).includes("channelkart#1185"));
    assert.deepEqual([...new Set(ck.sources.map((s) => s.jira))].sort(), ["CAV-7304", "CAV-7346"]);
    const names = deploy.filter((i) => i.key.startsWith("svc:")).map((i) => i.key);
    assert.deepEqual(names, ["svc:channel kart", "svc:kpi dashboard - ui", "svc:flutter app (sfa)", "svc:salescode-auth-service"]);
    assert.match(item(prod, "deploy", "svc:salescode-auth-service").label ?? "", /extra line/);
  });

  it("de-dupes partner.banner.enabled across 81399/81400/81421 and keeps all sources, with no conflict", () => {
    const keys = sec(prod, "configs").filter((i) => i.key === "cfg:partner.banner.enabled");
    assert.equal(keys.length, 1);
    const c = keys[0];
    for (const p of ["channelkart#1184", "kpi-dashboard#267", "channelkart-flutter#49"]) assert.ok(prs(c).includes(p), p);
    assert.equal(c.conflict, undefined);
    assert.match(c.config?.default ?? "", /^off/);
    assert.match(c.env?.values.demo ?? "", /^on/);
    // the siblings' prefixed rows ("channelkart partner.banner.enabled and mappings") did not make extra items
    assert.equal(sec(prod, "configs").filter((i) => /partner\.banner\.enabled/.test(i.key)).length, 1);
  });

  it("marks unknown PROD values as needing attention, and a demo movement does not for the same key", () => {
    const p = item(prod, "configs", "cfg:partner.banner.enabled");
    assert.equal(p.needsAttention, true);
    assert.equal(p.severity, "warn");
    assert.equal(p.env?.target, "prod");
    assert.equal(p.env?.targetValue, null);
    assert.match(p.env?.values.demo ?? "", /^on/); // other environments stay visible

    const demo = build("demo");
    const d = item(demo, "configs", "cfg:partner.banner.enabled");
    assert.equal(d.needsAttention, undefined);
    assert.match(d.env?.targetValue ?? "", /^on/);
    // a key that is unknown in demo too is still flagged there
    assert.equal(item(demo, "configs", "cfg:account.lock.enabled").needsAttention, true);
    assert.ok(prod.stats.needsAttention > demo.stats.needsAttention);
  });

  it("groups every 'owner to confirm' under devops / author / deployer / mobile lead, with sources, deduped", () => {
    const owners = prod.unknownsByOwner.map((g) => g.owner);
    for (const o of ["devops", "author", "deployer", "mobile lead"]) assert.ok(owners.includes(o), o);
    const devops = prod.unknownsByOwner.find((g) => g.owner === "devops");
    const shared = devops?.items.find((i) => /ckcoe's own prod branch/.test(i.text));
    assert.ok(shared);
    assert.deepEqual(shared.sources.map((s) => s.pr).sort(), ["channelkart#1184", "channelkart#1185"]);
    // the same sentence appears once
    assert.equal(devops?.items.filter((i) => /ckcoe's own prod branch/.test(i.text)).length, 1);
  });

  it("merges the CAV-7304 order into channelkart#1185 -> auth-service#332 -> kpi-dashboard#269 -> flutter#50, independent of CAV-7346", () => {
    const seq = (k: string) => item(prod, "order", `step:pr:${k}`).seq as number;
    assert.ok(seq("channelkart#1185") < seq("salescode-auth-service#332"));
    assert.ok(seq("salescode-auth-service#332") < seq("kpi-dashboard#269"));
    assert.ok(seq("kpi-dashboard#269") < seq("channelkart-flutter#50"));
    assert.ok(seq("channelkart#1184") < seq("kpi-dashboard#267"));
    assert.ok(seq("kpi-dashboard#267") < seq("channelkart-flutter#49"));
    assert.equal(prod.conflicts.filter((c) => c.kind === "order_cycle").length, 0);
    // "app build" of the two Jiras are different nodes (free-text steps are per Jira)
    assert.equal(sec(prod, "order").filter((i) => i.key.startsWith("step:t:") && /\|app build$/.test(i.key)).length, 2);
    // gates and rollback are grouped per Jira
    assert.ok(sec(prod, "order").some((i) => i.key.startsWith("gate:CAV-7346:") && i.group === "CAV-7346"));
    assert.ok(sec(prod, "order").some((i) => i.key.startsWith("rollback:CAV-7304:") && i.group === "CAV-7304"));
  });

  it("keeps free text so nothing is lost, risks ordered Should-fix before Nitpick, and shows sign-offs", () => {
    const risks = sec(prod, "risks");
    const firstNit = risks.findIndex((i) => i.label === "Nitpick");
    const lastShould = risks.map((i) => i.label).lastIndexOf("Should-fix");
    assert.ok(firstNit > lastShould);
    assert.ok(sec(prod, "compat").some((i) => i.raw && i.text.length > 100));
    assert.ok(sec(prod, "testing").some((i) => /92 test cases/.test(i.text)));
    assert.deepEqual(
      prod.signoffs.map((s) => [s.jira, s.dev === "missing", s.tester === "missing", s.anyMissing]),
      [["CAV-7304", false, true, true], ["CAV-7346", true, true, true]],
    );
  });

  it("flags a picked branch that differs from the record's prod branch, with both values; patterns match", () => {
    const mis = build("prod", realJiras(), [
      { repo: "channelkart", branch: "master" },
      { repo: "kpi-dashboard", branch: "prod-17-july-blue" },
    ]);
    const c = mis.conflicts.filter((x) => x.kind === "branch_mismatch");
    assert.equal(c.length, 1);
    assert.match(c[0].variants.map((v) => v.text).join(" / "), /picked: master.*record: prod_blue_\*/);
    assert.equal(item(mis, "prodBranch", "pick:channelkart").severity, "warn");
    const ok = build("prod", realJiras(), [{ repo: "channelkart", branch: "prod_blue_21_sep_2026_branch" }]);
    assert.equal(ok.conflicts.length, 0);
    assert.equal(item(ok, "prodBranch", "prod:channelkart").needsAttention, true); // hint is still unconfirmed
  });

  it("holds an unticked Jira out of the union and lists it with its readiness", () => {
    const jiras = realJiras();
    jiras[1] = { ...jiras[1], included: false, readiness: "blocked" };
    const cl = build("prod", jiras);
    assert.deepEqual(cl.held.map((h) => [h.jira, h.readiness]), [["CAV-7304", "blocked"]]);
    for (const s of cl.sections) for (const i of s.items) assert.ok(!i.sources.some((x) => x.jira === "CAV-7304"), `${s.id}/${i.key}`);
    assert.equal(cl.stats.records, 3);
    assert.equal(sec(cl, "order").some((i) => i.key.includes("1185")), false);
    assert.ok(cl.unknownsByOwner.every((g) => g.items.every((u) => u.sources.every((x) => x.jira !== "CAV-7304"))));
  });

  it("is quick and small for the 7 real records", () => {
    const bytes = Buffer.byteLength(JSON.stringify(prod));
    console.log(`  [P4] 7 real records: build ${ms.toFixed(1)} ms, ${bytes} bytes JSON, ${prod.stats.items} items`);
    assert.ok(bytes < 150_000, `${bytes}`);
    assert.ok(prod.stats.records === 7 && prod.stats.items > 150);
    assert.ok(ms < 1000);
  });
});

describe("conflicts are surfaced, not merged away", () => {
  const A = (o: Parameters<typeof synth>[0]) => synth({ repo: "channelkart", ...o });

  it("two different prod branches for one repo; a glob and a concrete branch are compatible", () => {
    const cl = buildChecklist({
      environment: "prod",
      branches: [],
      jiras: [
        jira("CAV-1", [A({ pr: 1, facts: { prodBranch: { branch: "prod_blue_21_sep" }, prodBranches: ["prod_blue_21_sep"] } })]),
        jira("CAV-2", [A({ pr: 2, facts: { prodBranch: { branch: "prod_green_2" }, prodBranches: ["prod_green_2"] } })]),
        jira("CAV-3", [synth({ repo: "kpi-dashboard", pr: 3, facts: { prodBranch: { branch: "prod_blue_*", isPattern: true }, prodBranches: ["prod_blue_*"] } }), synth({ repo: "kpi-dashboard", pr: 4, facts: { prodBranch: { branch: "prod_blue_9" }, prodBranches: ["prod_blue_9"] } })]),
      ],
    });
    const c = cl.conflicts.filter((x) => x.kind === "prod_branch");
    assert.equal(c.length, 1);
    assert.deepEqual(c[0].variants.map((v) => v.text).sort(), ["prod_blue_21_sep", "prod_green_2"]);
    assert.ok(c[0].variants.every((v) => v.sources.length === 1));
    assert.ok(item(cl, "prodBranch", "prod:channelkart").conflict);
  });

  const cfg = (pr: number, key: string, row: Record<string, string>) =>
    A({ pr, facts: { configs: [{ key, source: "table", ...row }] } });

  it("config default: 'off (403 EG243)' vs 'off' is no conflict, 'off' vs 'on' is", () => {
    const same = buildChecklist({ environment: "prod", branches: [], jiras: [jira("CAV-1", [cfg(1, "x.y", { default: "off (403 EG243)" }), cfg(2, "x.y", { default: "off" })]), jira("CAV-2", [cfg(3, "x.y", { default: '"false" (no call)' })])] });
    assert.equal(same.conflicts.length, 0);
    const diff = buildChecklist({ environment: "prod", branches: [], jiras: [jira("CAV-1", [cfg(1, "x.y", { default: "off" })]), jira("CAV-2", [cfg(2, "x.y", { default: "on (ckcoe)" })])] });
    assert.deepEqual(diff.conflicts.map((c) => c.kind), ["config_default"]);
    assert.equal(item(diff, "configs", "cfg:x.y").conflict?.variants.length, 2);
  });

  it("same config with different per-env values conflicts; unknown beside a value does not and the known value wins", () => {
    const cl = buildChecklist({
      environment: "prod",
      branches: [],
      jiras: [
        jira("CAV-1", [cfg(1, "a.b", { prod: "on", uat: "unknown" }), cfg(2, "c.d", { prod: "unknown" })]),
        jira("CAV-2", [cfg(3, "a.b", { prod: "off", uat: "on" }), cfg(4, "c.d", { prod: "set (ckcoe) [author]" })]),
      ],
    });
    assert.deepEqual(cl.conflicts.map((c) => `${c.kind}:${c.itemKey}`), ["config_env_value:cfg:a.b"]);
    const cd = item(cl, "configs", "cfg:c.d");
    assert.equal(cd.env?.targetValue, "set (ckcoe) [author]");
    assert.equal(cd.needsAttention, undefined);
    assert.equal(item(cl, "configs", "cfg:a.b").env?.values.uat, "on");
  });

  it("downtime, bundle SDK and deploy-from branches that differ between Jiras are aggregated, not conflicts", () => {
    const cl = buildChecklist({
      environment: "prod",
      branches: [],
      jiras: [
        jira("CAV-1", [A({ pr: 1, facts: { restart: [{ name: "Channel Kart" }], downtime: "yes", bundleSdkBuild: "yes", deploy: [{ name: "Channel Kart" }] }, json: { deploy: [{ service: "Channel Kart", fromBranch: "prod_blue_1" }] } })]),
        jira("CAV-2", [A({ pr: 2, facts: { restart: [{ name: "channelkart" }], downtime: "no", bundleSdkBuild: "no", deploy: [{ name: "channelkart" }] }, json: { deploy: [{ service: "channelkart", fromBranch: "hotfix/x" }] } })]),
      ],
    });
    assert.equal(cl.conflicts.length, 0);
    assert.equal(sec(cl, "deploy").filter((i) => i.key === "svc:channel kart").length, 1);
    assert.equal(item(cl, "restart", "downtime:channel kart").text, "Downtime required for Channel Kart: Yes (CAV-1); No (CAV-2)");
    assert.equal(item(cl, "deploy", "sdk").text, "Bundle SDK build: required (CAV-1); not required (CAV-2)");
    assert.match(item(cl, "deploy", "svc:channel kart").text, /\(from prod_blue_1 \(CAV-1\) \/ hotfix\/x \(CAV-2\)\)$/);
  });

  it("a deploy-order cycle is reported with the offending steps, never silently broken", () => {
    const edge = (before: string, after: string) => ({ before, after });
    const cl = buildChecklist({
      environment: "prod",
      branches: [],
      jiras: [
        jira("CAV-1", [A({ pr: 1, facts: { order: { steps: [], stepsSource: "json", structured: false, gates: [], edges: [edge("channelkart#1", "kpi-dashboard#2"), edge("kpi-dashboard#2", "channelkart#3")] } } })]),
        jira("CAV-2", [A({ pr: 3, facts: { order: { steps: [], stepsSource: "json", structured: false, gates: [], edges: [edge("channelkart#3", "channelkart#1"), edge("channelkart#3", "stock#9")] } } })]),
      ],
    });
    const c = cl.conflicts.filter((x) => x.kind === "order_cycle");
    assert.equal(c.length, 1);
    assert.equal(c[0].severity, "blocker");
    assert.match(c[0].variants[0].text, /channelkart#1/);
    assert.match(c[0].variants[0].text, /kpi-dashboard#2/);
    assert.match(c[0].variants[0].text, /channelkart#3/);
    // all nodes are still listed (nothing dropped), the downstream node flagged too
    const steps = sec(cl, "order").filter((i) => i.key.startsWith("step:"));
    assert.equal(steps.length, 4);
    assert.ok(steps.every((s) => s.severity === "blocker"));
  });

  it("two Jiras that share a PR are ordered together; free-text steps of different Jiras stay apart", () => {
    const step = (text: string, repo?: string, pr?: number) => ({ text, refs: repo ? [{ repo, pr: pr as number }] : [] });
    const o = (steps: ReturnType<typeof step>[]) => ({ steps, stepsSource: "json" as const, structured: true, gates: [], edges: [] });
    const cl = buildChecklist({
      environment: "prod",
      branches: [],
      jiras: [
        jira("CAV-1", [A({ pr: 10, facts: { order: o([step("channelkart#10", "channelkart", 10), step("kpi-dashboard#20", "kpi-dashboard", 20), step("flip flag")]) } })]),
        jira("CAV-2", [A({ pr: 30, facts: { order: o([step("kpi-dashboard#20", "kpi-dashboard", 20), step("channelkart#30", "channelkart", 30), step("flip flag")]) } })]),
      ],
    });
    const steps = sec(cl, "order").filter((i) => i.key.startsWith("step:"));
    assert.equal(steps.filter((s) => /flip flag/.test(s.text)).length, 2);
    const seq = (k: string) => steps.find((s) => s.key === `step:pr:${k}`)?.seq as number;
    assert.ok(seq("channelkart#10") < seq("kpi-dashboard#20") && seq("kpi-dashboard#20") < seq("channelkart#30"));
    assert.deepEqual(prs(steps.find((s) => s.key === "step:pr:kpi-dashboard#20") as ChecklistItem).sort(), ["channelkart#10", "channelkart#30"]);
  });
});

describe("free text and bounds", () => {
  it("falls back to the record's own section text (marked raw) when no fact was structured", () => {
    const sections = [
      { number: 7, title: "Database", canonical: "database" as const, text: "Run the odd SQL by hand on every LOB.", tables: [], tags: [], unknowns: [] },
      { number: 15, title: "Extras", canonical: null, text: "a section this version never heard of", tables: [], tags: [], unknowns: [] },
    ];
    const cl = buildChecklist({ environment: "uat", branches: [], jiras: [jira("CAV-1", [synth({ sections })])] });
    const db = sec(cl, "database").find((i) => i.raw);
    assert.equal(db?.text, "Run the odd SQL by hand on every LOB.");
    assert.ok(sec(cl, "risks").some((i) => i.raw && /never heard of/.test(i.text)));
  });

  it("caps a section at 300 items, keeping flagged ones and counting the rest", () => {
    const risks = Array.from({ length: 450 }, (_, i) => ({ severity: i < 5 ? ("Blocking" as const) : ("Nitpick" as const), text: `risk number ${i}`, source: "text" as const }));
    const cl = buildChecklist({ environment: "prod", branches: [], jiras: [jira("CAV-1", [synth({ facts: { risks } })])] });
    const items = sec(cl, "risks");
    assert.equal(items.length, 300);
    const more = items[items.length - 1];
    assert.equal(more.key, "more:risks");
    assert.equal(more.count, 151);
    assert.equal(items.filter((i) => i.severity === "blocker").length, 5);
    assert.deepEqual(items.slice(0, 5).map((i) => i.label), ["Blocking", "Blocking", "Blocking", "Blocking", "Blocking"]);
  });
});

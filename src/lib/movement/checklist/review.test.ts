import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { buildChecklist } from "./build";
import { diffChecklists, hashChecklist, MAX_DIFF_BYTES } from "./diff";
import { excelSafe, renderText, toRows } from "./render";
import { decodeSnapshot, encodeSnapshot, safeDecodeSnapshot, SnapshotError } from "./snapshot";
import { jira, realJiras, realRecords, synth, uniqueClone } from "./testkit";
import type { Checklist, ChecklistInput, ChecklistItem, ChecklistJiraInput, SectionId } from "./types";
import { MAX_CONFLICTS, MAX_ITEMS_PER_SECTION, MAX_WARNINGS } from "./types";

const sec = (cl: Checklist, id: SectionId) => (cl.sections.find((s) => s.id === id) as Checklist["sections"][number]).items;
const byKey = (cl: Checklist, id: SectionId, key: string): ChecklistItem => {
  const hit = sec(cl, id).find((i) => i.key === key);
  assert.ok(hit, `${id}/${key}`);
  return hit;
};
const build = (jiras: ChecklistJiraInput[], extra: Partial<ChecklistInput> = {}) => buildChecklist({ environment: "prod", jiras, branches: [], ...extra });
const wellFormed = (x: string) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(x);

describe("nothing real is dropped (fix round 1)", () => {
  it("keeps prose that no fact represents, e.g. 81422 s8, 81399 s8 and s4 sentences", () => {
    const cl = build(realJiras());
    const all = cl.sections.flatMap((s) => s.items).filter((i) => i.raw).map((i) => i.text).join("\n");
    assert.match(all, /Turning it on also starts 5-minute auth-service checks for portal traffic\./);
    assert.match(all, /Key storage sign-off \(ticket question 13\): not recorded\./);
    assert.match(all, /Reports, Stock, Promo, Claims, Rewards: not touched \[I\]\./);
    const lo = sec(cl, "configs").find((i) => /Key storage sign-off/.test(i.text));
    assert.deepEqual(lo?.sources.map((x) => `${x.pr}#${x.section}`), ["channelkart#1184#8"]);
  });

  it("an on/off difference with extra scope words, numbers and non-Latin values are conflicts; unknown beside a value is not", () => {
    const cfg = (pr: number, key: string, row: Record<string, string>) => synth({ pr, facts: { configs: [{ key, source: "table", ...row }] } });
    const cl = build([
      jira("CAV-1", [cfg(1, "a", { default: "set 120", prod: "on" }), cfg(2, "b", { default: "off" }), cfg(3, "c", { prod: "[IN, VN]" }), cfg(4, "d", { prod: "日本" })]),
      jira("CAV-2", [cfg(5, "a", { default: "set 300", prod: "unknown" }), cfg(6, "b", { default: "off for ckcoe, on elsewhere" }), cfg(7, "c", { prod: "[ID, TH]" }), cfg(8, "d", { prod: "中国" })]),
    ]);
    assert.deepEqual(cl.conflicts.map((c) => c.id).sort(), ["configs|cfg:a|config_default", "configs|cfg:b|config_default", "configs|cfg:c|config_env_value|prod", "configs|cfg:d|config_env_value|prod"]);
    assert.equal(byKey(cl, "configs", "cfg:a").env?.targetValue, "on"); // unknown did not hide the value
  });

  it("keeps the config alias and the other columns in the item text and in Copy / Excel rows", () => {
    const cl = build([jira("CAV-1", [synth({ pr: 1, facts: { configs: [{ key: "KEY_A (or property key.a)", source: "table", store: "env", default: "off", prod: "on", extra: { "Who sets": "deployer" } }] } })])]);
    const it = byKey(cl, "configs", "cfg:KEY_A");
    assert.match(it.text, /KEY_A \(also: key\.a\)/);
    assert.match(it.text, /Who sets: deployer/);
    assert.match(renderText(cl), /KEY_A \(also: key\.a\)/);
    assert.match(toRows(cl).find((r) => r.item === "cfg:KEY_A")?.text ?? "", /\(also: key\.a\)/);
  });

  it("a PR shared by two Jiras shows every distinct status (worst first); the newest record of a PR is used", () => {
    const blocked = synth({ pr: 5, status: "BLOCKED", id: 10 });
    blocked.statusText = "BLOCKED for release (1 open Should-fix)";
    const ready = synth({ pr: 5, status: "READY", id: 11 });
    ready.statusText = "READY";
    const cl = build([jira("CAV-1", [ready]), jira("CAV-2", [blocked])]);
    const h = byKey(cl, "header", "rec:channelkart#5");
    assert.equal(h.severity, "blocker");
    assert.ok(h.text.indexOf("BLOCKED") < h.text.indexOf("READY"), h.text);
    assert.deepEqual(h.sources.map((x) => x.jira), ["CAV-1", "CAV-2"]);
    // same PR twice in one Jira: the newest version wins whatever the id order
    const v1 = synth({ pr: 9, id: 900, facts: { risks: [{ severity: "Nitpick", text: "old risk", source: "text" }] } });
    const v2 = synth({ pr: 9, id: 100, facts: { risks: [{ severity: "Nitpick", text: "new risk", source: "text" }] } });
    v2.marker.version = 2;
    const cl2 = build([jira("CAV-3", [v1, v2])]);
    assert.ok(sec(cl2, "risks").some((i) => /new risk/.test(i.text)) && !sec(cl2, "risks").some((i) => /old risk/.test(i.text)));
  });

  it("warns when the order names a PR that has no record in the movement (a held Jira's PR)", () => {
    const o = { steps: [], stepsSource: "json" as const, structured: false, gates: [], edges: [{ before: "channelkart#1", after: "kpi-dashboard#2" }] };
    const jiras = [jira("CAV-1", [synth({ pr: 1, facts: { order: o } })]), jira("CAV-2", [synth({ repo: "kpi-dashboard", pr: 2 })], { included: false })];
    const w = build(jiras).warnings.filter((x) => x.code === "order_ref_not_in_movement").map((x) => x.message);
    assert.equal(w.length, 1);
    assert.ok(w[0].startsWith("kpi-dashboard#2 "), w[0]);
    jiras[1].included = true;
    assert.equal(build(jiras).warnings.some((x) => x.code === "order_ref_not_in_movement"), false);
    assert.equal(build(realJiras()).warnings.some((x) => x.code === "order_ref_not_in_movement"), false);
  });

  it("order steps carry their Jira, prefer the short human label and normalise '#01'", () => {
    const cl = build(realJiras());
    const step = byKey(cl, "order", "step:pr:channelkart#1185");
    assert.deepEqual(step.jiras, ["CAV-7304"]);
    assert.equal(step.text, "channelkart #1185 (property off)");
    const o = { steps: [], stepsSource: "json" as const, structured: false, gates: [], edges: [{ before: "channelkart#01", after: "channelkart#1 (note)" }, { before: "channelkart#1", after: "kpi#2" }] };
    const c2 = build([jira("CAV-1", [synth({ pr: 1, facts: { order: o } })])]);
    assert.equal(sec(c2, "order").filter((i) => i.key === "step:pr:channelkart#1").length, 1);
    assert.ok(c2.warnings.some((w) => w.code === "order_self_loop"));
  });
});

describe("per-environment value conflicts outside the target environment are information only", () => {
  const row = (pr: number, r: Record<string, string>) => synth({ pr, facts: { configs: [{ key: "partner.banner.enabled", source: "table", ...r }] } });
  const two = (a: Record<string, string>, b: Record<string, string>) => [jira("CAV-1", [row(1, a)]), jira("CAV-2", [row(2, b)])];

  it("prod movement: a demo-only conflict is listed as info and is not counted; the item is not raised", () => {
    const cl = build(two({ demo: "on (ckcoe)", prod: "on" }, { demo: "on (ckcoedemo)", prod: "on" }));
    assert.equal(cl.conflicts.length, 1);
    assert.equal(cl.conflicts[0].kind, "config_env_value");
    assert.equal(cl.conflicts[0].severity, "info");
    assert.match(cl.conflicts[0].title, /demo, not the target environment/);
    assert.equal(cl.stats.conflicts, 0);
    assert.deepEqual(cl.stats.bySeverity.conflicts, { blocker: 0, warn: 0, info: 1 });
    assert.match(cl.summary, /, 0 conflicts \(\+1 in other environments\),/);
    assert.equal(byKey(cl, "configs", "cfg:partner.banner.enabled").severity, undefined);
    assert.ok(byKey(cl, "configs", "cfg:partner.banner.enabled").conflict); // still marked, never dropped
    // the hash and the diff still see it
    const none = build(two({ demo: "on (ckcoe)", prod: "on" }, { demo: "on (ckcoe)", prod: "on" }));
    assert.equal(none.conflicts.length, 0);
    assert.notEqual(none.hash, cl.hash);
    assert.ok(diffChecklists(none, cl).added.some((x) => x.section === "conflict"));
  });

  it("a conflict in the target environment is still counted (warn); the target one stays on the item", () => {
    const cl = build(two({ demo: "on (ckcoe)", prod: "on" }, { demo: "on (ckcoedemo)", prod: "off" }));
    assert.deepEqual(cl.conflicts.map((c) => [c.id.split("|").pop(), c.severity]), [["prod", "warn"], ["demo", "info"]]); // real ones first
    assert.equal(cl.stats.conflicts, 1);
    assert.match(cl.summary, /, 1 conflict \(\+1 in other environments\),/);
    assert.equal(byKey(cl, "configs", "cfg:partner.banner.enabled").severity, "warn");
    assert.equal(byKey(cl, "configs", "cfg:partner.banner.enabled").conflict?.variants[0].text.startsWith("prod:"), true);
  });

  it("demo movement: a prod-only conflict is information; a demo one counts", () => {
    const prodOnly = build(two({ demo: "on", prod: "on" }, { demo: "on", prod: "off" }), { environment: "demo" });
    assert.equal(prodOnly.conflicts[0].severity, "info");
    assert.equal(prodOnly.stats.conflicts, 0);
    const demoDiff = build(two({ demo: "on" }, { demo: "off" }), { environment: "demo" });
    assert.equal(demoDiff.conflicts[0].severity, "warn");
    assert.equal(demoDiff.stats.conflicts, 1);
    assert.match(demoDiff.summary, /1 conflict,/);
  });

  it("the real CAV-7346 + CAV-7304 records: 0 conflicts in prod and demo", () => {
    for (const environment of ["prod", "demo"] as const) assert.match(build(realJiras(), { environment }).summary, /^7 PRs, 0 conflicts, \d+ need attention, 23 unknowns$/);
  });
});

describe("environment-aware prod branches and branch picks", () => {
  const facts = { prodBranch: { branch: "prod_blue_*", isPattern: true, unknown: true }, prodBranches: ["prod_blue_*"] };
  it("flags an unconfirmed prod branch only on the prod movement; a store build gets a neutral note", () => {
    const recs = [jira("CAV-1", [synth({ pr: 1, facts }), synth({ repo: "channelkart-flutter", pr: 2, facts: { prodBranch: { branch: null, unknown: true } } })])];
    const prod = build(recs);
    assert.equal(byKey(prod, "prodBranch", "prod:channelkart").needsAttention, true);
    assert.match(byKey(prod, "prodBranch", "prod:channelkart-flutter").text, /built as a store release/);
    assert.equal(byKey(prod, "prodBranch", "prod:channelkart-flutter").needsAttention, undefined);
    for (const env of ["demo", "uat"] as const) {
      const cl = build(recs, { environment: env });
      assert.equal(cl.stats.needsAttention, 0, env);
      assert.equal(byKey(cl, "prodBranch", "prod:channelkart").severity, undefined);
    }
  });

  it("two different picks for one repo are both shown and warned about, not silently reduced to one", () => {
    const cl = build([jira("CAV-1", [synth({ pr: 1, facts })])], { branches: [{ repo: "channelkart", branch: "origin/prod_blue_21" }, { repo: "channelkart", branch: "master" }] });
    assert.match(byKey(cl, "prodBranch", "pick:channelkart").text, /master \/ prod_blue_21 \(two different picks\)/);
    assert.ok(cl.warnings.some((w) => w.code === "branch_pick_conflict"));
    assert.deepEqual(cl.scope.branches.map((b) => b.branch), ["master", "prod_blue_21"]);
    assert.equal(cl.conflicts.filter((c) => c.kind === "branch_mismatch").length, 1); // master is off, prod_blue_21 is fine
  });
});

describe("caps always say so, and the right things survive", () => {
  const cfgJira = (i: number, def: string, extra: ChecklistJiraInput["records"] = []) => jira(`CAV-${i}`, [synth({ pr: 1000 + i, facts: { configs: [{ key: `k${i}`, source: "table", default: def }] } }), ...extra]);

  it("lists blockers first when conflicts exceed the cap, keeps the order cycle, reports the true count", () => {
    const a = Array.from({ length: 250 }, (_, i) => cfgJira(i + 1, "on"));
    const b = Array.from({ length: 250 }, (_, i) => jira(`CAV-${i + 1000}`, [synth({ pr: 5000 + i, facts: { configs: [{ key: `k${i + 1}`, source: "table", default: "off" }] } })]));
    const edge = (x: string, y: string) => ({ before: x, after: y });
    const o = (e: ReturnType<typeof edge>[]) => ({ steps: [], stepsSource: "json" as const, structured: false, gates: [], edges: e });
    const cyc = [jira("CAV-9998", [synth({ pr: 9998, facts: { order: o([edge("channelkart#1", "channelkart#2")]) } })]), jira("CAV-9999", [synth({ pr: 9999, facts: { order: o([edge("channelkart#2", "channelkart#1")]) } })])];
    const cl = build([...a, ...b, ...cyc]);
    assert.equal(cl.conflicts.length, MAX_CONFLICTS);
    assert.equal(cl.conflicts[0].kind, "order_cycle");
    assert.equal(cl.stats.conflicts, 251);
    assert.equal(cl.stats.bySeverity.conflicts.blocker, 1);
    assert.ok(cl.warnings.some((w) => w.code === "conflicts_truncated" && /51 more conflicts/.test(w.message)));
    assert.match(cl.summary, /251 conflicts/);
  });

  it("checklist-level warnings survive a flood of record warnings; the rest is counted", () => {
    const flood = Array.from({ length: 150 }, (_, i) => {
      const r = synth({ pr: 100 + i, facts: { headMovedTo: "abc", headReviewed: "def" } });
      r.warnings.push({ code: "json_missing", message: `warning ${i}` });
      return r;
    });
    const cl = build([jira("CAV-1", flood), jira("CAV-2", [], {}), { ...jira("CAV-3", []), readiness: "override", override: { reason: "go", by: "admin" } }]);
    const codes = cl.warnings.map((w) => w.code);
    assert.ok(codes.includes("no_records") && codes.includes("override"));
    assert.equal(cl.warnings.length, MAX_WARNINGS);
    assert.equal(cl.warnings[cl.warnings.length - 1].code, "warnings_truncated");
    assert.ok((cl.warnings[cl.warnings.length - 1].count ?? 0) > 100);
  });

  it("condensed output says so and still shows store, default and the target value of a config", () => {
    const cl = buildChecklist({ environment: "prod", branches: [], jiras: realJiras() }, { startLevel: 2 });
    assert.ok(cl.warnings.some((w) => w.code === "checklist_condensed"));
    assert.equal(cl.warnings[0].code, "checklist_condensed");
    const c = byKey(cl, "configs", "cfg:partner.banner.enabled");
    assert.match(c.text, /store: per-LOB property/);
    assert.match(c.text, /default: off/);
    assert.match(c.text, /prod: unknown/);
  });

  it("every checklist the builder produces round-trips through encode/decode (sizes, overrides, unicode)", () => {
    const base = Object.values(realRecords());
    const make = (jiraCount: number, overrides: number) => {
      const jiras: ChecklistJiraInput[] = [];
      let n = 0;
      for (let j = 0; j < jiraCount; j++) {
        const recs = [];
        for (let k = 0; k < 4; k++) recs.push(uniqueClone(base[(j + k) % base.length], ++n, `CAV-${9000 + j}`));
        const ov = j < overrides ? { readiness: "override" as const, override: { reason: `reason ${j} 日本`, by: "admin" } } : {};
        jiras.push(jira(`CAV-${9000 + j}`, recs, ov));
      }
      return jiras;
    };
    for (const [jiras, overrides] of [[10, 0], [60, 60], [75, 0], [200, 30]] as const) {
      const cl = build(make(jiras, overrides));
      for (const s of cl.sections) assert.ok(s.items.length <= MAX_ITEMS_PER_SECTION, `${s.id}: ${s.items.length}`);
      const back = decodeSnapshot(encodeSnapshot(cl));
      assert.equal(hashChecklist(back), hashChecklist(cl), `${jiras} jiras`);
      assert.deepEqual(back, cl);
      if (overrides) assert.ok(sec(cl, "header").some((i) => i.key.startsWith("override:") || i.count), "overrides shown or counted");
    }
  });
});

describe("API for the service and the UI", () => {
  const cl = build(realJiras());
  it("has stable item and conflict ids, a per-item hash that follows the content, severity counts, a summary and the hash", () => {
    for (const s of cl.sections) for (const i of s.items) assert.equal(i.id, `${s.id}|${i.key}`);
    assert.equal(cl.hash, hashChecklist(cl));
    assert.match(cl.summary, /^7 PRs, 0 conflicts, 14 need attention, 23 unknowns$/);
    const s = cl.stats.bySeverity;
    assert.equal(s.items.blocker + s.items.warn + s.items.info, cl.stats.items);
    const j = JSON.parse(JSON.stringify(realJiras())) as ChecklistJiraInput[];
    (j[0].records[0].facts.configs ?? [])[1].default = "never";
    const other = build(j);
    const k = "cfg:PARTNER_BANNER_SSO_PRIVATE_KEY_PATH";
    assert.notEqual(byKey(other, "configs", k).ih, byKey(cl, "configs", k).ih);
    assert.equal(byKey(other, "configs", "cfg:partner.banner.enabled").ih, byKey(cl, "configs", "cfg:partner.banner.enabled").ih);
    const withConflict = build([jira("CAV-1", [synth({ pr: 1, facts: { configs: [{ key: "x", source: "table", default: "on" }, { key: "x", source: "table", default: "off" }] } })])]);
    assert.equal(withConflict.conflicts[0].id, "configs|cfg:x|config_default");
  });

  it("diff: bytes not chars (CJK, emoji), no lone surrogates, warnings and conflicts included, full diff for the UI, onlyMeta", () => {
    const mk = (prefix: string, n: number) =>
      build([jira("CAV-1", Array.from({ length: n }, (_, i) => synth({ pr: i + 1, facts: { risks: [{ severity: "Nitpick", text: `${prefix} 日本語 \u{1F600}\u{1F680} ${"中".repeat(60)} ${i}`, source: "text" }] } }))), jira("CAV-2", [synth({ pr: 900, key: "CAV-2" })])]);
    const a = mk("alpha", 120);
    const b = mk("beta", 120);
    const d = diffChecklists(a, b);
    const json = JSON.stringify(d);
    assert.ok(Buffer.byteLength(json) <= MAX_DIFF_BYTES, `${Buffer.byteLength(json)} bytes`);
    assert.ok(d.truncated > 0 && wellFormed(json));
    assert.deepEqual(JSON.parse(json), d);
    const full = diffChecklists(a, b, { maxBytes: Infinity });
    assert.equal(full.truncated, 0);
    assert.equal(full.changed.length, full.counts.changed);
    assert.ok(Buffer.byteLength(JSON.stringify(full)) > MAX_DIFF_BYTES);
    // warnings and conflicts are part of the diff
    const w1 = build([jira("CAV-1", [synth({ pr: 1 })])]);
    const w2 = build([jira("CAV-1", [synth({ pr: 1, facts: { headMovedTo: "x" } })])]);
    assert.ok(diffChecklists(w1, w2).added.some((x) => x.section === "warning"));
    // a hash difference without any item difference is reported as meta
    const meta = { ...w1, scope: { ...w1.scope, branches: [{ repo: "channelkart", branch: "x" }] } };
    const dm = diffChecklists(w1, meta);
    assert.equal(dm.onlyMeta, false); // branch pick is in the flattened scope, so it is a visible added entry
    assert.equal(dm.counts.added, 1);
    const hidden = { ...w1, held: [{ jira: "CAV-X", readiness: "blocked" as const }] };
    assert.equal(diffChecklists(w1, hidden).counts.added, 1);
    assert.equal(diffChecklists(w1, { ...w1, summary: "x" }).onlyMeta, false);
  });

  it("excelSafe neutralises the 7 formula payloads in every string cell", () => {
    const payloads = ["=1+1", "+1+1", "-1+1", "@SUM(1+1)", "\t=1+1", "\r=1+1", "=HYPERLINK(\"http://x\",\"y\")"];
    for (const p of payloads) assert.equal(excelSafe(p), `'${p}`, JSON.stringify(p));
    assert.equal(excelSafe("1. channelkart"), "1. channelkart");
    const evil = build([jira("CAV-1", [synth({ pr: 1, facts: { risks: [{ severity: "Nitpick", text: "=cmd|' /C calc'!A0", source: "text" }], verification: ["@x", "+1", "-2"] }, unknowns: [{ text: "=1+1 unknown, owner to confirm: -x", owner: "-x", section: 5 }] })])]);
    for (const r of toRows(evil)) for (const v of [r.section, r.item, r.text, r.sources, r.envValue, r.flags]) assert.ok(!/^[=+\-@\t\r]/.test(v), `${JSON.stringify(v)} in ${r.kind}`);
  });

  it("safeDecodeSnapshot returns null on anything wrong; decode deep-validates crafted inputs", () => {
    const ok = encodeSnapshot(cl);
    assert.deepEqual(safeDecodeSnapshot(ok), cl);
    assert.equal(safeDecodeSnapshot(Buffer.from("junk")), null);
    assert.equal(safeDecodeSnapshot(null), null);
    const craft = (mut: (c: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const c = JSON.parse(JSON.stringify(cl));
      mut(c);
      return gzipSync(Buffer.from(JSON.stringify(c)));
    };
    const bad: Array<[string, (c: Record<string, any>) => void]> = [ // eslint-disable-line @typescript-eslint/no-explicit-any
      ["unknownsByOwner", (c) => (c.unknownsByOwner = [{ owner: "x" }])],
      ["conflict.variants", (c) => (c.conflicts = [{ id: "i", kind: "prod_branch", section: "deploy", itemKey: "k", title: "t", severity: "warn", variants: 5 }])],
      ["sources:[null]", (c) => (c.sections[3].items[0].sources = [null])],
      ["scope.jiras:[1]", (c) => (c.scope.jiras = [1])],
      ["item env", (c) => (c.sections[7].items[0].env = { target: "nowhere" })],
      ["stats", (c) => (c.stats.items = "7")],
      ["too many items", (c) => (c.sections[0].items = Array.from({ length: 301 }, () => ({ key: "k", text: "t", sources: [] })))],
    ];
    for (const [name, mut] of bad) {
      assert.throws(() => decodeSnapshot(craft(mut)), SnapshotError, name);
      assert.equal(safeDecodeSnapshot(craft(mut)), null, name);
    }
    const huge = { ...cl, warnings: [{ code: "x", message: randomBytes(1_700_000).toString("base64"), sources: [] }] };
    assert.throws(() => encodeSnapshot(huge), SnapshotError);
  });
});

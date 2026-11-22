import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { buildChecklist } from "./build";
import { diffChecklists, hashChecklist, MAX_DIFF_BYTES } from "./diff";
import { renderText, toRows } from "./render";
import { decodeSnapshot, encodeSnapshot, MAX_DECODED_SNAPSHOT_BYTES, SnapshotError } from "./snapshot";
import { jira, realJiras, realRecords, synth, uniqueClone } from "./testkit";
import { MAX_CHECKLIST_BYTES, MAX_ITEMS_PER_SECTION, type Checklist, type ChecklistInput, type ChecklistJiraInput } from "./types";
import { MAX_SNAPSHOT_BYTES } from "../values";

const input = (jiras = realJiras(), extra: Partial<ChecklistInput> = {}): ChecklistInput => ({ environment: "prod", jiras, branches: [], ...extra });

describe("hashChecklist", () => {
  const base = hashChecklist(buildChecklist(input()));

  it("is identical under reordering of Jiras and records and under a re-post of the same text", () => {
    const jiras = realJiras().reverse().map((j) => ({ ...j, records: [...j.records].reverse() }));
    assert.equal(hashChecklist(buildChecklist(input(jiras))), base);
    const reposted = realJiras().map((j) => ({
      ...j,
      records: j.records.map((r) => ({ ...r, comment: { id: String(Number(r.comment.id) + 5000), created: "2026-11-20T00:00:00.000+0000", updated: "2026-11-20T00:00:00.000+0000" } })),
    }));
    assert.equal(hashChecklist(buildChecklist(input(reposted))), base);
    // a renamed ticket is not a content change; sign-offs are not part of the content either
    const renamed = realJiras().map((j) => ({ ...j, summary: "renamed", signoffs: undefined }));
    assert.equal(hashChecklist(buildChecklist(input(renamed))), base);
  });

  it("changes when a config default, the order, an unknown, the included set, the env, a branch pick or an override changes", () => {
    const h = (mut: (j: ChecklistJiraInput[]) => void, extra: Partial<ChecklistInput> = {}) => {
      const j = JSON.parse(JSON.stringify(realJiras())) as ChecklistJiraInput[];
      mut(j);
      return hashChecklist(buildChecklist(input(j, extra)));
    };
    const hashes = new Set([
      base,
      h((j) => ((j[0].records[0].facts.configs ?? [])[0].default = "on")), // default of partner.banner.enabled
      h((j) => {
        const o = j[1].records[0].facts.order;
        if (o) o.edges.push({ before: "channelkart-flutter#50", after: "channelkart#1185" }); // order (and a cycle)
      }),
      h((j) => j[0].records[0].unknowns.push({ text: "new thing: unknown, owner to confirm: devops", owner: "devops", section: 5 })),
      h((j) => (j[1].included = false)),
      h(() => undefined, { environment: "demo" }),
      h(() => undefined, { branches: [{ repo: "channelkart", branch: "prod_blue_x" }] }),
      h((j) => ((j[0].override = { reason: "ok", by: "admin" }), (j[0].readiness = "override"))),
    ]);
    assert.equal(hashes.size, 8);
  });
});

describe("diffChecklists", () => {
  it("reports added / removed / changed by (section, key) in a small structure", () => {
    const a = buildChecklist(input());
    const j = JSON.parse(JSON.stringify(realJiras())) as ChecklistJiraInput[];
    (j[0].records[0].facts.configs ?? [])[0].default = "on";
    const d = diffChecklists(a, buildChecklist(input(j)));
    const cfg = d.changed.find((c) => c.key === "cfg:partner.banner.enabled");
    assert.ok(cfg && /default: off/.test(cfg.from) && /default: on/.test(cfg.to), JSON.stringify(d.changed));
    // the new on/off disagreement is itself reported (conflict pseudo-section), nothing else is added
    assert.ok(d.added.length >= 1 && d.added.every((x) => x.section === "conflict" || x.section === "warning"), JSON.stringify(d.added));
    // the whole Jira going away is "removed", keyed by section and item key
    const gone = diffChecklists(a, buildChecklist(input(realJiras().slice(0, 1))));
    assert.ok(gone.removed.some((r) => r.section === "scope" && r.key === "jira:CAV-7304"));
    assert.deepEqual(diffChecklists(a, a).counts, { added: 0, removed: 0, changed: 0 });
  });

  it("stays under 4 KB for a huge change and counts what it left out", () => {
    const empty = buildChecklist(input([]));
    const full = buildChecklist(input());
    const d = diffChecklists(empty, full);
    assert.ok(Buffer.byteLength(JSON.stringify(d)) <= MAX_DIFF_BYTES);
    assert.ok(d.counts.added > 100 && d.truncated > 50);
    assert.equal(d.added.length + d.changed.length + d.removed.length + d.truncated, d.counts.added + d.counts.changed + d.counts.removed);
  });
});

describe("renderText and toRows", () => {
  const cl = buildChecklist(input(realJiras(), { branches: [{ repo: "channelkart", branch: "master" }] }));
  it("puts conflicts and unknowns first, marks the target env and shows sources in brackets", () => {
    const t = renderText(cl);
    assert.ok(t.indexOf("## CONFLICTS") < t.indexOf("## UNKNOWNS") && t.indexOf("## UNKNOWNS") < t.indexOf("## 1. Header"));
    assert.match(t, /PROD \(target\): UNKNOWN/);
    assert.match(t, /\[CAV-7346: channelkart#1184, channelkart-flutter#49, kpi-dashboard#267\]/);
    assert.match(t, /Sign-off missing: CAV-7304 \(tester\), CAV-7346 \(dev \+ tester\)/);
    assert.match(t, /^1\. channelkart #1185/m);
  });
  it("gives flat rows with env value and flags for the Excel writer", () => {
    const rows = toRows(cl);
    const row = rows.find((r) => r.kind === "item" && r.item === "cfg:partner.banner.enabled");
    assert.equal(row?.envValue, "UNKNOWN");
    assert.match(row?.flags ?? "", /NEEDS ATTENTION/);
    assert.ok(rows.some((r) => r.kind === "conflict") && rows.some((r) => r.kind === "unknown"));
    assert.equal(rows.filter((r) => r.kind === "item").length, cl.stats.items);
  });
});

describe("snapshot", () => {
  const cl = buildChecklist(input());
  it("round-trips through gzip", () => {
    const buf = encodeSnapshot(cl);
    assert.ok(buf.length < JSON.stringify(cl).length / 3);
    assert.deepEqual(decodeSnapshot(buf), cl);
    assert.equal(hashChecklist(decodeSnapshot(buf)), hashChecklist(cl));
  });

  it("refuses to encode past MAX_SNAPSHOT_BYTES", () => {
    const big: Checklist = { ...cl, warnings: [{ code: "x", message: randomBytes(1_700_000).toString("base64"), sources: [] }] };
    assert.throws(() => encodeSnapshot(big), SnapshotError);
  });

  it("aborts a zip bomb at the decompressed cap and rejects garbage and wrong shapes", () => {
    const bomb = gzipSync(Buffer.alloc(MAX_DECODED_SNAPSHOT_BYTES * 12, 97)); // 48 MB of 'a' in a few KB
    assert.ok(bomb.length < MAX_SNAPSHOT_BYTES);
    const t0 = performance.now();
    assert.throws(() => decodeSnapshot(bomb), /expands past the size limit/);
    assert.ok(performance.now() - t0 < 1000);
    assert.throws(() => decodeSnapshot(Buffer.from("not gzip")), SnapshotError);
    assert.throws(() => decodeSnapshot(gzipSync(Buffer.from("{}"))), /wrong shape/);
    assert.throws(() => decodeSnapshot(gzipSync(Buffer.from(JSON.stringify({ ...cl, sections: cl.sections.slice(1) })))), /wrong shape/);
    assert.throws(() => decodeSnapshot(Buffer.alloc(MAX_SNAPSHOT_BYTES + 1)), /too large/);
  });
});

describe("bounds: 60 Jiras x 4 PRs of worst-case (nothing collapses) content", () => {
  it("stays under the size limit, per-section caps and in good time", () => {
    const base = Object.values(realRecords());
    const jiras: ChecklistJiraInput[] = [];
    let n = 0;
    for (let j = 0; j < 60; j++) {
      const recs = [];
      for (let k = 0; k < 4; k++) recs.push(uniqueClone(base[(j + k) % base.length], ++n, `CAV-${9000 + j}`));
      jiras.push(jira(`CAV-${9000 + j}`, recs));
    }
    const t0 = performance.now();
    const cl = buildChecklist(input(jiras));
    const ms = performance.now() - t0;
    const bytes = Buffer.byteLength(JSON.stringify(cl));
    const gz = encodeSnapshot(cl).length;
    const h0 = performance.now();
    hashChecklist(cl);
    console.log(`  [P4] 60 Jiras x 4 PRs (240 unique records): build ${ms.toFixed(0)} ms, hash ${(performance.now() - h0).toFixed(0)} ms, ${bytes} bytes JSON, ${gz} bytes gzipped snapshot, ${cl.stats.items} items`);
    assert.equal(cl.stats.records, 240);
    assert.ok(bytes < MAX_CHECKLIST_BYTES, `${bytes} bytes`);
    assert.ok(cl.warnings.some((w) => w.code === "checklist_condensed"));
    for (const s of cl.sections) assert.ok(s.items.length <= MAX_ITEMS_PER_SECTION);
    assert.ok(ms < 8000); // ~180 ms alone, ~1 s when the whole suite runs in parallel
  });

  it("a realistic movement (shared services, keys, prod branches) is not condensed", () => {
    const base = Object.values(realRecords());
    const jiras: ChecklistJiraInput[] = [];
    for (let j = 0; j < 60; j++) jiras.push(jira(`CAV-${9000 + j}`, [synth({ pr: 100 + j, key: `CAV-${9000 + j}`, facts: { ...base[0].facts, configs: [{ key: `feature.${j}.enabled`, source: "table", default: "off", prod: "unknown" }] } })]));
    const cl = buildChecklist(input(jiras));
    assert.equal(cl.warnings.some((w) => w.code === "checklist_condensed"), false);
    assert.equal(cl.sections.find((s) => s.id === "deploy")?.items.filter((i) => i.key.startsWith("svc:")).length, 3);
  });
});

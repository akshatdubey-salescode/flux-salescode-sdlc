import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { envOfHeader } from "./facts";
import { parseDeploymentRecord } from "./parse";
import { loadFixture, RECORD_FIXTURES } from "./testkit";
import type { ConfigRow, ParsedRecord } from "./types";

function fixture(name: string): ParsedRecord {
  const r = parseDeploymentRecord(loadFixture(name));
  assert.ok(r);
  return r;
}
const rows = (name: string): ConfigRow[] => fixture(name).facts.configs!;

/** A record whose section 8 is the given markdown table. */
function configs(table: string): ConfigRow[] {
  const r = parseDeploymentRecord({ id: 1, body: `DEPLOYMENT-RECORD v1 | K-1 | r#2 | 2026-11-19 10:00 | bot\n\n**8 Configs to move to prod:**\n\n${table}` });
  assert.ok(r);
  return r.facts.configs!;
}

describe("environment column recognition", () => {
  it("maps headers to an environment dynamically", () => {
    const cases: Array<[string, string | null, string | null]> = [
      ["Demo", "demo", null],
      ["UAT", "uat", null],
      ["Prod", "prod", null],
      ["PROD", "prod", null],
      ["Production", "prod", null],
      ["Staging", "uat", null],
      ["QA", "uat", null],
      ["ckcoedemo", "demo", "ckcoe"],
      ["ckcoeuat", "uat", "ckcoe"],
      ["ckcoeprod", "prod", "ckcoe"],
      ["hfcoeuat", "uat", "hfcoe"],
      ["ckcoe demo", "demo", "ckcoe"],
      ["ckcoe prod", "prod", "ckcoe"],
      ["hfcoe uat", "uat", "hfcoe"],
      ["Prod (ckcoe)", "prod", "ckcoe"],
      ["Prod / ckcoe", "prod", "ckcoe"],
      ["ckcoe_prod", "prod", "ckcoe"],
      ["ckcoe-demo", "demo", "ckcoe"],
      // not environments
      ["ckcoe", null, null],
      ["hfcoe", null, null],
      ["Tenants today", null, null],
      ["Owner", null, null],
      ["Product notes", null, null],
      ["Reproduction steps", null, null],
      ["Preprod", null, null],
      ["Default", null, null],
    ];
    for (const [h, env, tenant] of cases) {
      const e = envOfHeader(h);
      assert.deepEqual([e?.env ?? null, e?.tenant ?? null], [env, tenant], h);
    }
  });
});

describe("real v2 records: LOB-prefixed env columns", () => {
  it("CAV-7346 channelkart#1184 (81431): demo/uat/prod come from ckcoedemo/ckcoeuat/ckcoe prod", () => {
    const c = rows("CAV-7346-81431");
    assert.equal(c.length, 5);
    assert.deepEqual({ key: c[0].key, def: c[0].default, demo: c[0].demo, uat: c[0].uat, prod: c[0].prod }, { key: "partner.banner.enabled", def: "off (403 EG243)", demo: "set 19 Nov", uat: "not set", prod: "not set" });
    assert.deepEqual({ ...c[0].byTenant }, { ckcoedemo: "set 19 Nov", ckcoeuat: "not set", "ckcoe prod": "not set" });
    assert.equal(c[0].extra, undefined); // the env columns are not left behind as extras
    assert.equal(c[1].prod, "not set (infra)");
    assert.equal(c[2].prod, "unknown");
    assert.deepEqual([c[4].key, c[4].demo, c[4].uat, c[4].prod], ["green.config.distributor.designations", "set", "supplier,subd,ss", "supplier,subd,ss"]);
  });

  it("CAV-7346 kpi-dashboard#267 (81432) has no Default column; flutter#49 (81433)", () => {
    const k = rows("CAV-7346-81432");
    assert.equal(k.length, 4);
    assert.deepEqual([k[0].key, k[0].store, k[0].default, k[0].demo, k[0].uat, k[0].prod], ["partner.banner.enabled", "client/properties", undefined, "set 19 Nov", "not set", "not set"]);
    const f = rows("CAV-7346-81433");
    assert.deepEqual([f[1].key, f[1].default, f[1].demo, f[1].uat, f[1].prod], ["channelkart partner.banner.enabled and mappings", "off", "on", "not set", "not set"]);
  });

  it("CAV-7304 channelkart#1185 (81434): only ckcoedemo and ckcoe prod exist; JSON values agree", () => {
    const r = fixture("CAV-7304-81434");
    const c = r.facts.configs!;
    assert.deepEqual([c[0].key, c[0].source, c[0].demo, c[0].uat, c[0].prod], ["verify.active.session.enabled", "both", "absent (off), read 19 Nov [author]", undefined, "absent (off)"]);
    assert.deepEqual([c[1].demo, c[1].prod], ["unknown", "unknown"]);
    assert.equal(r.warnings.some((w) => w.code === "json_disagrees"), false);
  });

  it("CAV-7304 auth-service#332 (81435): 'Tenants today' is not an env; its text is kept as extra AND tenants", () => {
    const c = rows("CAV-7304-81435");
    assert.deepEqual(c.map((x) => x.key), ["account.lock.enabled", "account.lock.grace.seconds", "account.lock.protected.logins"]);
    for (const row of c) {
      assert.equal(row.demo, undefined);
      assert.equal(row.uat, undefined);
      assert.equal(row.prod, undefined);
    }
    assert.equal(c[0].extra!["Tenants today"], "already true (owner, 19 Nov) [author]");
    assert.deepEqual({ ...c[0].tenants }, { "Tenants today": "already true (owner, 19 Nov) [author]" });
    assert.equal(c[1].tenants!["Tenants today"], "no value until this PR is deployed; 120 verified locally [author]");
    assert.equal(c[2].default, "empty (nobody protected)");
  });

  it("the v1 records (plain Demo/UAT/Prod headers) read exactly as before", () => {
    const c = rows("CAV-7346-81399");
    assert.deepEqual([c[0].demo, c[0].uat, c[0].prod, c[0].byTenant], ["on (ckcoedemo) [author]", "unknown", "unknown", undefined]);
    for (const n of RECORD_FIXTURES) for (const row of fixture(n).facts.configs ?? []) assert.equal(row.tenants, undefined, n);
  });
});

describe("synthetic env headers", () => {
  const T = (header: string, ...cells: string[]) => `| ${header} |\n|${header.split("|").map(() => "---").join("|")}|\n| ${cells.join(" | ")} |`;

  it("'ckcoeprod', 'hfcoe uat', 'PROD', 'Prod (ckcoe)', 'Prod / ckcoe' each fill their environment", () => {
    const a = configs(T("Key | ckcoeprod | hfcoe uat", "a.b", "1", "2"))[0];
    assert.deepEqual([a.demo, a.uat, a.prod], [undefined, "2", "1"]);
    for (const h of ["PROD", "Prod (ckcoe)", "Prod / ckcoe", "ckcoe prod", "Production"]) {
      const r = configs(T(`Key | Store | ${h}`, "a.b", "prop", "on"))[0];
      assert.deepEqual([r.store, r.prod], ["prop", "on"], h);
    }
    const q = configs(T("Key | Prod (ckcoe)", "a.b", "on"))[0];
    assert.deepEqual({ ...q.byTenant }, { "Prod (ckcoe)": "on" });
  });

  it("several tenants for one environment keep every value; prod is the first non-empty", () => {
    const r = configs(T("Key | ckcoe prod | hfcoe prod | ckcoeprod | tgo demo | ckcoedemo", "a.b", " ", "off", "on", "x", "y"))[0];
    assert.equal(r.prod, "off");
    assert.deepEqual({ ...r.byTenant }, { "ckcoe prod": "", "hfcoe prod": "off", ckcoeprod: "on", "tgo demo": "x", ckcoedemo: "y" });
    assert.equal(r.demo, "x");
  });

  it("a plain 'Demo' next to 'ckcoedemo' is kept in byTenant too", () => {
    const r = configs(T("Key | Demo | ckcoedemo", "a.b", "1", "2"))[0];
    assert.deepEqual([r.demo, { ...r.byTenant }], ["1", { Demo: "1", ckcoedemo: "2" }]);
  });

  it("tenant-only and unknown columns are kept as extra; only tenant-like ones are `tenants`", () => {
    const r = configs(T("Key | Prod | ckcoe | Owner | Tenants today", "a.b", "on", "yes", "ops", "all"))[0];
    assert.equal(r.prod, "on");
    assert.deepEqual({ ...r.extra }, { ckcoe: "yes", Owner: "ops", "Tenants today": "all" });
    assert.deepEqual({ ...r.tenants }, { ckcoe: "yes", "Tenants today": "all" });
    const only = configs(T("Key | Owner", "a.b", "ops"))[0];
    assert.equal(only.tenants, undefined);
    assert.equal(only.prod, undefined);
  });

  it("look-alikes are not environments (Preprod, Product notes)", () => {
    const r = configs(T("Key | Preprod | Product notes | Prod", "a.b", "p1", "n1", "on"))[0];
    assert.equal(r.prod, "on");
    assert.deepEqual({ ...r.extra }, { Preprod: "p1", "Product notes": "n1" });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { branchesCompatible, canonicalService, cap, normBranch, repoService, sig, splitConfigKeys, textKey, tidy, valuesCompatible, valueSig } from "./normalize";

describe("normalisation", () => {
  it("maps written service names to the release-page names and keeps unknown ones as extra lines", () => {
    const cases: Array<[string, string, boolean]> = [
      ["channelkart", "Channel Kart", true],
      ["Channel Kart", "Channel Kart", true],
      ["kpi-dashboard", "KPI Dashboard - UI", true],
      ["portal build", "KPI Dashboard - UI", true],
      ["Flutter app build", "Flutter app (SFA)", false],
      ["Promo service", "Promo", true],
      ["slake-custom-reports", "Reports Jar", true],
      ["Some New Thing", "Some New Thing", false],
    ];
    for (const [raw, name, cc] of cases) {
      const s = canonicalService(raw);
      assert.deepEqual([s.name, s.cc], [name, cc], raw);
    }
    assert.equal(repoService("salescode-ai/channelkart-flutter")?.name, "Flutter app (SFA)");
    assert.equal(repoService("unknown-repo"), null);
  });

  it("normalises config keys: backticks, 'a / b', '(or property x)', sibling prefixes; case is kept", () => {
    assert.deepEqual(splitConfigKeys("`Account.Lock.Enabled`"), [{ key: "Account.Lock.Enabled", aliases: [] }]);
    assert.deepEqual(splitConfigKeys("a.one / b.two").map((k) => k.key), ["a.one", "b.two"]);
    assert.deepEqual(splitConfigKeys("environment variable / property").map((k) => k.key), ["environment variable / property"]);
    assert.deepEqual(splitConfigKeys("PARTNER_KEY_PATH (or property partner.key-path)"), [{ key: "PARTNER_KEY_PATH", aliases: ["partner.key-path"] }]);
    assert.deepEqual(splitConfigKeys("channelkart partner.banner.enabled and mappings").map((k) => k.key), ["partner.banner.enabled"]);
    assert.deepEqual(splitConfigKeys("partnerBanner in *_portal_feature_configuration").map((k) => k.key), ["partnerBanner in *_portal_feature_configuration"]);
  });

  it("compares values by meaning: same-meaning pairs are compatible, different values are not (both directions)", () => {
    const ok = (a: string, b: string) => valuesCompatible(valueSig(a), valueSig(b)) && valuesCompatible(valueSig(b), valueSig(a));
    // same meaning
    for (const [a, b] of [
      ["off (403 EG243)", "off"],
      ['"false" (no call)', "off"],
      ["off (nothing changes)", "off (screen shows the server's refusal)"],
      ["on (ckcoedemo) [author]", "set"],
      ["on (ckcoedemo) [author]", "on"], // a bare `on` says nothing about where
      ["off.", "off"],
      ["120", "120 seconds"],
      ["120 s", "120 seconds"],
      ["ckcoe, hfcoe", "hfcoe, ckcoe"],
      ["n/a", "not applicable"],
      ["unknown", "on"],
      ["unknown, owner to confirm: devops", "set 300"],
      ["`off`", "OFF"],
    ] as const) assert.ok(ok(a, b), `${a} ~ ${b}`);
    // different meaning: the remainder, the scope, the number and the text all stay significant
    for (const [a, b] of [
      ["off", "on"],
      ["set 120", "set 300"],
      ["120 s", "120 ms"],
      ["enabled for ckcoe", "enabled for all"],
      ["on", "on except ckcoe"],
      ["off", "off for ckcoe, on elsewhere"],
      ["on (ckcoe)", "on (ckcoedemo)"],
      ["120 (ticket said 300)", "300"],
      ["[IN, VN]", "[ID, TH]"],
      ["[inactive, active]", "[active]"],
      ["\u65e5\u672c", "\u4e2d\u56fd"],
      ["\u0645\u0635\u0631", "\u0627\u0644\u0647\u0646\u062f"],
    ] as const) assert.ok(!ok(a, b), `${a} !~ ${b}`);
    for (const u of ["unknown", "unknown, owner to confirm: devops", "", "  "]) assert.equal(valueSig(u).unknown, true, u);
    assert.equal(valueSig(null).unknown, true);
    assert.equal(valueSig("[IN, VN]").unknown, false);
  });

  it("only [V] [I] [author] [author's ...] are tags; other brackets are values; non-Latin text is kept", () => {
    assert.equal(sig("on [V] [I] [author] [author's call]"), "on");
    assert.equal(sig("[IN, VN]"), "in vn");
    assert.notEqual(sig("\u65e5\u672c\u8a9e\u306e\u30ad\u30fc"), sig("\u4e2d\u6587\u7684\u952e"));
    assert.notEqual(textKey("risk", "\u0627\u062e\u062a\u0628\u0627\u0631 \u0623"), textKey("risk", "\u0627\u062e\u062a\u0628\u0627\u0631 \u0628"));
    assert.equal(sig("\u0939\u093f\u0928\u094d\u0926\u0940 \u0915\u0941\u0902\u091c\u0940"), "\u0939\u093f\u0928\u094d\u0926\u0940 \u0915\u0941\u0902\u091c\u0940"); // combining marks stay inside words
    assert.deepEqual(splitConfigKeys("\u8bbe\u7f6e.\u5f00\u5173").map((k) => k.key), ["\u8bbe\u7f6e.\u5f00\u5173"]);
  });

  it("normalises config-key and branch variants to one key / one branch", () => {
    for (const v of ["a.b.c.", "a.b.c (per-LOB property)", "property a.b.c", "a.b.c = true", "`a.b.c`", "a.b\u200b.c", "a.b.c: true"]) {
      assert.deepEqual(splitConfigKeys(v).map((k) => k.key), ["a.b.c"], v);
    }
    assert.equal(splitConfigKeys("a.b.c (per-LOB property)")[0].note, "per-LOB property");
    for (const b of ["origin/prod_x", "refs/heads/prod_x", "`prod_x`", "prod_x."]) assert.equal(normBranch(b), "prod_x");
    assert.ok(branchesCompatible("prod_blue_*", "origin/prod_blue_21") && branchesCompatible("Master", "master"));
    assert.ok(!branchesCompatible("prod_blue_*", "prod_green_1") && !branchesCompatible("prod_blue_*", "prod_green_*"));
  });

  it("cap never splits a surrogate pair", () => {
    const s = "a".repeat(9) + "\u{1F600}".repeat(5);
    for (let n = 1; n < s.length; n++) assert.equal(isWellFormed(cap(s, n)), true, `n=${n}`);
    assert.equal(isWellFormed(tidy("x\ud800y")), true);
  });
});

const isWellFormed = (x: string) => JSON.parse(JSON.stringify(x)) === x && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(x);

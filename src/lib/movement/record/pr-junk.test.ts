/**
 * Words that stand in front of a bare "#1147" in a sentence ("before #1147", "reverted by #269", "merge #1181") are not repositories: they must
 * never become PR rows. The text is the real MERGED PRs block of the CAV-7293 review comment (81663) and the reverted block of CAV-7300 (81669).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDialect } from "./dialect";
import { refsIn } from "./util";

const CAV_7293 = [
  "MERGED PRs",
  "  channelkart#1147             master  33e8209192  19 Nov  APIs, guard, 2 properties  (approved and merged by dev-b)",
  "  channelkart#1156             branch CAV-7293-collections-order-source  12c2cd9153  17 Nov  batching fixes, merged into the feature branch",
  "                               before #1147, so it is inside #1147  (self-merged by the author, no approval)",
  "  channelkart#1186             master  47dbf2b259  19 Nov  test-only Sonar fix for InvoiceCollectionOrderSourceTest; main CAV-7317 PR",
  "                               (approved and merged by dev-b)",
  "  kpi-dashboard#246            master  9fa6bbcb09  19 Nov  columns + filter on 3 screens  (merged by dev-b, no formal approval)",
  "  slake-custom-reports#918     main    f70b8fde80  19 Nov  Order Source in 3 executors  (approved and merged by dev-b)",
  "  slake-reporting-config#1294  main    78c5a2e1f3  19 Nov  ckcoedemo + ckcoeuat report configs  (approved and merged by dev-b)",
  "STILL OPEN  channelkart#1182 (CAV-7037 Sonar new-code issues; names CAV-7293, 7296, 7299, 7300; not in this union)",
].join("\n");

const CAV_7300 = [
  "MERGED THEN REVERTED (net zero against prod; do NOT deploy as features)",
  "  channelkart-bundle   ckcoe   #256 f37fb4d9fd, #260 a909930cb0  reverted by #269 a3bad92306  (all self-merged by the author, no approval)",
  "  kpi-dashboard        master  #265 ad365333fa, #278 87dbf79d72  reverted by #288 97293944ea  (all self-merged, no approval)",
  "STILL OPEN  slake-reporting-config#1345 (older revert of #1341 only; superseded by #1370, can be closed)",
].join("\n");

describe("PR references: words in front of #n are not repositories", () => {
  it("the sentence under the CAV-7293 MERGED PRs list yields no 'before#1147' / 'inside#1147'", () => {
    assert.deepEqual(refsIn("before #1147, so it is inside #1147  (self-merged by the author, no approval)"), []);
    assert.deepEqual(refsIn("reverted by #269 a3bad92306 and merged after #1181; close #1345, merge #1181, of #1341"), []);
  });
  it("real references with a repo-like name are still found, in the same line as prose words", () => {
    assert.deepEqual(refsIn("merged before channelkart#1147, so it is inside kpi-dashboard#246").map((r) => `${r.repo}#${r.pr}`), ["channelkart#1147", "kpi-dashboard#246"]);
    assert.deepEqual(refsIn("slake-reporting-config #1294 (and stockservice#44)").map((r) => `${r.repo}#${r.pr}`), ["slake-reporting-config#1294", "stockservice#44"]);
  });
  it("parseDialect on the CAV-7293 block: exactly the five merged PRs, the stack-branch PR apart, the open one named", () => {
    const d = parseDialect(CAV_7293);
    assert.deepEqual(d.covers.map((c) => `${c.repo}#${c.pr}`), ["channelkart#1147", "channelkart#1186", "kpi-dashboard#246", "slake-custom-reports#918", "slake-reporting-config#1294"]);
    assert.deepEqual(d.stackOnly.map((c) => `${c.repo}#${c.pr}`), ["channelkart#1156"]);
    assert.deepEqual(d.stillOpen.map((c) => `${c.repo}#${c.pr}`), ["channelkart#1182"]);
    const all = [...d.covers, ...d.stackOnly, ...d.stillOpen, ...d.reverted].map((c) => c.repo);
    assert.ok(!all.includes("before") && !all.includes("inside"), "no sentence word is a repo");
  });
  it("parseDialect on the CAV-7300 reverted block: no 'by#269', 'by#288', 'of#1341'", () => {
    const d = parseDialect(CAV_7300);
    const all = [...d.covers, ...d.stackOnly, ...d.stillOpen, ...d.reverted].map((c) => `${c.repo}#${c.pr}`);
    assert.deepEqual(all, ["slake-reporting-config#1345"]);
  });
});

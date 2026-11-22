import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveBranchPicks, repoUsage, type ItemRow } from "./core";

const ref = (repo: string, pr: number) => ({ repo, pr, commentId: String(pr), version: 1, updated: null, status: "READY" });
const row = (key: string, repos: string[], o: Partial<ItemRow> = {}): ItemRow => ({
  issueId: key,
  key,
  summary: "",
  included: true,
  tickSet: false,
  readiness: "ready",
  overrideReason: null,
  overrideBy: null,
  overrideByName: null,
  overrideAt: null,
  result: "pending",
  resultComment: null,
  warnings: [],
  recordRefs: repos.map((r, i) => ref(r, i + 1)),
  ...o,
});

describe("branch picks follow the ticks", () => {
  const rows = [row("A", ["channelkart", "kpi-dashboard"]), row("B", ["salescode-auth-service", "channelkart"], { included: false })];

  it("affected repos come from the effectively included Jiras only (unticked or blocked Jiras do not count)", () => {
    assert.deepEqual([...repoUsage(rows).included].sort(), ["channelkart", "kpi-dashboard"]);
    assert.deepEqual([...repoUsage(rows).all].sort(), ["channelkart", "kpi-dashboard", "salescode-auth-service"]);
    const blocked = [row("A", ["channelkart"]), row("B", ["salescode-auth-service"], { readiness: "blocked" })];
    assert.deepEqual([...repoUsage(blocked).included], ["channelkart"], "ticked but blocked is out too");
    const overridden = [row("B", ["salescode-auth-service"], { readiness: "override" })];
    assert.deepEqual([...repoUsage(overridden).included], ["salescode-auth-service"]);
  });

  it("a pick for a repo only held Jiras use is left out of the checklist input; a pick nobody names (a tracked repo added on purpose) stays", () => {
    const picks = [
      { repo: "channelkart", branch: "prod" },
      { repo: "salescode-auth-service", branch: "prod_auth" },
      { repo: "some-tracked-repo", branch: "main" },
    ];
    assert.deepEqual(effectiveBranchPicks(picks, rows).map((p) => p.repo), ["channelkart", "some-tracked-repo"]);
    // ticking B brings its pick back
    assert.deepEqual(effectiveBranchPicks(picks, [rows[0], { ...rows[1], included: true }]).map((p) => p.repo), ["channelkart", "salescode-auth-service", "some-tracked-repo"]);
  });
});

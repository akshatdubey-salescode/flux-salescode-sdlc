import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDeploymentRecord, type ParsedRecord } from "../record";
import { loadFixture, RECORD_FIXTURES_V2 } from "../record/testkit";
import { buildChecklist } from "./build";
import { buildRollup, MAX_GLANCE, MAX_ROLLUP_ENTRIES, type Rollup, type RollupEntry } from "./rollup";
import { applySummary, buildSummaryRequest, MAX_SUMMARY_USER_CHARS, rulesHeadline, summaryFromResponse, summaryHash, SUMMARY_INSTRUCTIONS, SUMMARY_TOOL_NAME } from "./summary-ai";
import { jira, realJiras, synth, unionJira, unionRecord } from "./testkit";
import type { ChecklistInput, ChecklistJiraInput, SectionId } from "./types";

const entries = (r: Rollup, id: SectionId): RollupEntry[] => (r.sections.find((s) => s.id === id) as Rollup["sections"][number]).entries;
const find = (r: Rollup, id: SectionId, key: string): RollupEntry => {
  const e = entries(r, id).find((x) => x.key === key);
  assert.ok(e, `${id}/${key} missing; have ${entries(r, id).map((x) => x.key).join(" | ")}`);
  return e;
};
const input = (jiras: ChecklistJiraInput[], environment: ChecklistInput["environment"] = "prod"): ChecklistInput => ({ environment, jiras, branches: [] });

function variant(id: number, mutate: (r: ParsedRecord) => void): ParsedRecord {
  const r: ParsedRecord = JSON.parse(JSON.stringify(unionRecord()));
  r.comment.id = String(id);
  mutate(r);
  return r;
}
function setRow(r: ParsedRecord, rowId: string, state: string, answer: string, text = "") {
  const row = (r.facts.releaseRows ?? []).find((x) => x.id === rowId);
  assert.ok(row);
  Object.assign(row, { state, answer, text });
}

/** The user's movement shape: one union review comment per Jira, answers varied. Jira 0 requires the app release. */
function thirteen(): ChecklistJiraInput[] {
  return Array.from({ length: 13 }, (_, i) => {
    const key = `CAV-${7280 + i}`;
    const r = variant(90000 + i, (x) => {
      x.marker.key = key;
      (x.facts.covers ?? []).forEach((c, k) => (c.pr = 9000 + i * 10 + k));
      if (i === 0) setRow(x, "app_release", "yes", "Yes: new build", "new build");
      setRow(x, "code_reviewed", i % 3 === 0 ? "not_done" : "done", i % 3 === 0 ? "Not Done: pending approval" : "Done", i % 3 === 0 ? "pending approval" : "");
      setRow(x, "bundle_sdk", i % 4 === 0 ? "yes" : "no", i % 4 === 0 ? "Yes" : "No");
      setRow(x, "designations", i % 5 === 0 ? "not_done" : "done", i % 5 === 0 ? "Not Done: portal users" : "Done", i % 5 === 0 ? "portal users" : "");
    });
    return { key, included: true, readiness: "ready", records: [r] };
  });
}

describe("rollup: one entry per thing, union semantics", () => {
  const jiras13 = thirteen();
  const r13 = buildRollup(input(jiras13));

  it("lists a service once with every Jira that deploys it (13 Jiras: Slake Reporting)", () => {
    const e = find(r13, "deploy", "svc:slake reporting");
    assert.equal(e.jiras.length, 13);
    assert.equal(e.line, "Deploy — executor + configs");
    assert.equal(entries(r13, "deploy").filter((x) => x.key.startsWith("svc:")).length, 1);
    assert.equal(find(r13, "restart", "restart:slake reporting").jiras.length, 13);
  });

  it("App release is REQUIRED when one Jira requires it and the others say not required, with the list shown", () => {
    const app = find(r13, "appRelease", "app");
    assert.deepEqual([app.badge, app.severity], ["REQUIRED", "warn"]);
    assert.equal(app.line, "Required by CAV-7280 · 12 not needed");
    assert.deepEqual(app.details?.map((d) => [d.text, d.jiras.length]), [["Required", 1], ["Not required", 12]]);
    // none requires it: NOT REQUIRED with a count; only unknowns: UNKNOWN
    const none = buildRollup(input(thirteen().slice(1)));
    assert.deepEqual([find(none, "appRelease", "app").badge, find(none, "appRelease", "app").line], ["NOT REQUIRED", "Not needed"]);
    const unk = variant(5, (x) => {
      setRow(x, "app_release", "unknown", "unknown (mobile lead)", "(mobile lead)");
      x.facts.appRelease = { applicable: null, refs: [], section: 3 };
    });
    assert.equal(find(buildRollup(input([unionJira({ records: [unk] })])), "appRelease", "app").badge, "UNKNOWN");
  });

  it("Bundle SDK build: REQUIRED if any Jira says so, naming them; release-page rows: counts and the worst badge", () => {
    const sdk = find(r13, "deploy", "sdk");
    assert.deepEqual([sdk.badge, sdk.line], ["REQUIRED", "Required by CAV-7280, CAV-7284, CAV-7288, CAV-7292 · 9 not needed"]);
    const cr = find(r13, "branches", "row:code_reviewed");
    assert.deepEqual([cr.badge, cr.counts, cr.needsAttention], ["NOT DONE", { done: 8, notDone: 5, unknown: 0, notRequired: 0, yes: 0, no: 0 }, true]);
    assert.equal(cr.line, "5 Jiras not done: CAV-7280, CAV-7283, CAV-7286 +2 more · 8 done");
    assert.equal(r13.headline.notDone, 5 + 3 /* designations */ + 13 /* configs_prod */ + 13 /* scenarios */);
    // rows answered 'Not required' by everyone are one collapsed entry per section
    assert.equal(find(r13, "appRelease", "notreq:appRelease").jiras.length, 13);
  });

  it("legacy and v2 records: configs entries with PROD attention, DB entries, the merged order and the undo path", () => {
    const rr = buildRollup(input(realJiras()));
    const c = find(rr, "configs", "cfg:partner.banner.enabled");
    assert.deepEqual([c.badge, c.needsAttention, c.env?.target, c.env?.targetValue], ["ATTENTION", true, "prod", null]);
    assert.match(c.env?.values.demo ?? "", /^on/);
    assert.deepEqual(c.jiras, ["CAV-7346"]);
    assert.ok(entries(rr, "database").some((e) => /UI IndexedDB version bump/.test(e.title) && e.jiras.join() === "CAV-7304,CAV-7346"));
    const order = find(rr, "order", "order");
    const seq = (s: string) => order.details?.findIndex((d) => d.text.includes(s)) as number;
    assert.ok(seq("channelkart #1185") >= 0 && seq("channelkart #1185") < seq("auth-service#332") && seq("auth-service#332") < seq("kpi-dashboard#269"));
    assert.equal(entries(rr, "order")[0].key, "order");
    assert.ok(find(rr, "order", "undo").details?.length);
    // v2 re-posts
    const by: Record<string, ChecklistJiraInput> = {};
    for (const n of RECORD_FIXTURES_V2) {
      const rec = parseDeploymentRecord(loadFixture(n));
      assert.ok(rec);
      (by[n.slice(0, 8)] ??= { key: n.slice(0, 8), included: true, readiness: "ready", records: [] }).records.push(rec);
    }
    const v2 = buildRollup(input(Object.values(by)));
    assert.ok(entries(v2, "configs").some((e) => e.needsAttention));
    // a movement with no DB action says "No DB change"
    assert.equal(find(buildRollup(input([unionJira()])), "database", "db:none").line, "No database change");
  });

  it("every Jira's answer is kept: the mixed movement (legacy + union) has entries for all three Jiras", () => {
    const mixed = buildRollup(input([...realJiras(), unionJira()]));
    assert.deepEqual(mixed.jiraKeys, ["CAV-7280", "CAV-7304", "CAV-7346"]);
    assert.equal(mixed.headline.reviewComments, 8);
    assert.equal(mixed.headline.prs, 9);
    assert.equal(find(mixed, "deploy", "svc:channel kart").jiras.join(), "CAV-7304,CAV-7346");
    assert.deepEqual(find(mixed, "header", "status:HELD").jiras, ["CAV-7280"]);
    assert.equal(find(mixed, "branches", "repo:channelkart").details?.length, 2);
  });
});

describe("rollup: at a glance and bounds", () => {
  it("ranks the glance by severity (blockers first), at most 10, deterministic", () => {
    const mixed = buildRollup(input([...realJiras(), unionJira()]));
    const g = mixed.atAGlance;
    assert.ok(g.length >= 5 && g.length <= MAX_GLANCE);
    const rank = { blocker: 2, warn: 1, info: 0 } as const;
    for (let i = 1; i < g.length; i++) assert.ok(rank[g[i - 1].severity] >= rank[g[i].severity], g.map((x) => x.severity).join());
    assert.deepEqual([g[0].id, g[0].severity], ["held", "blocker"]);
    assert.deepEqual(g.slice(0, 4).map((x) => x.id), ["held", "configs", "app-release", "db"]);
    assert.match(g[1].title, /^\d+ configs without a PROD value$/);
    assert.ok(g.every((x) => x.title.length <= 80 && x.detail.length <= 400));
    assert.deepEqual(buildRollup(input([...realJiras(), unionJira()])).atAGlance, g);
  });

  it("is bounded: 100 Jiras with distinct risks give <= 60 entries per section, <= 40 Jira keys per entry", () => {
    const jiras = Array.from({ length: 100 }, (_, i) => jira(`CAV-${1000 + i}`, [synth({ pr: 100 + i, facts: { risks: [{ severity: "Nitpick", text: `risk number ${i}`, source: "text" }], verification: ["/hckeck shows the merged commit"], deploy: [{ name: "Channel Kart" }] } })]));
    const r = buildRollup(input(jiras));
    for (const s of r.sections) assert.ok(s.entries.length <= MAX_ROLLUP_ENTRIES, s.id);
    const risks = r.sections.find((s) => s.id === "risks");
    assert.equal(risks?.more, 41);
    assert.equal(risks?.entries[risks.entries.length - 1].key, "more:risks");
    const ck = find(r, "deploy", "svc:channel kart");
    assert.deepEqual([ck.jiras.length, ck.moreJiras], [40, 60]);
    assert.ok(Buffer.byteLength(JSON.stringify(r)) < 300_000);
  });

  it("the 13-Jira rollup is small", () => {
    const r = buildRollup(input(thirteen()));
    const bytes = Buffer.byteLength(JSON.stringify(r));
    console.log(`  [P4] 13-Jira rollup: ${bytes} bytes, ${r.sections.reduce((n, s) => n + s.entries.length, 0)} entries, glance ${r.atAGlance.length}`);
    assert.ok(bytes < 120_000);
  });
});

describe("summary-ai: request, strict merge, hash", () => {
  const r13 = buildRollup(input(thirteen()));
  const g0 = r13.atAGlance;

  it("builds a request with the instructions, a forced tool and a prompt under 24k chars", () => {
    const req = buildSummaryRequest(r13);
    assert.equal(req.system, SUMMARY_INSTRUCTIONS);
    assert.ok(req.user.length < 24_000 && req.user.length > 1000, `${req.user.length}`);
    assert.equal(req.request.forceTool, SUMMARY_TOOL_NAME);
    assert.equal(req.request.tools?.[0].name, SUMMARY_TOOL_NAME);
    assert.deepEqual((req.tool.input_schema as { required: string[] }).required, ["headline", "glance"]);
    assert.ok(req.user.includes("CAV-7280") && req.user.includes("App release REQUIRED"));
    // a very large rollup is trimmed deterministically and says what it omitted
    const big = buildRollup(input(Array.from({ length: 100 }, (_, i) => jira(`CAV-${1000 + i}`, [synth({ pr: 100 + i, facts: { risks: [{ severity: "Should-fix", text: `risk number ${i} ${"long text ".repeat(12)}`, source: "text" }], roles: [{ who: `role ${i}`, what: "check ".repeat(20), negative: false }], verification: [`verify ${i} ${"x".repeat(100)}`] } })]))));
    const bigReq = buildSummaryRequest(big);
    assert.ok(bigReq.user.length <= MAX_SUMMARY_USER_CHARS + 600, `${bigReq.user.length}`);
    assert.ok(bigReq.omittedEntries > 0);
    assert.equal(buildSummaryRequest(big).user, bigReq.user);
    assert.ok(rulesHeadline(r13).length <= 160);
  });

  it("merges a valid answer: wording from the model, facts (Jiras, counts, env cells) from the rollup", () => {
    const appBefore = JSON.stringify(find(r13, "appRelease", "app").jiras);
    const out = {
      headline: "13 Jiras to PROD: an app build, 5 rows not done, no downtime",
      glance: [
        { id: "app-release", badge: "REQUIRED", severity: "warn", title: "REQUIRE app build for CAV-7280", detail: "Only CAV-7280 needs it", jiras: ["CAV-9999"] },
        { badge: "INFO", severity: "info", title: "DEPLOY Slake Reporting once for 13 Jiras", detail: "One executor + 4 configs", jiras: ["CAV-7280", "CAV-7281"] },
      ],
      entries: [{ sectionId: "deploy", key: "svc:slake reporting", title: "Slake Reporting (13)", line: "Deploy Slake Reporting once", badge: "DONE" }],
    };
    const m = applySummary(r13, out);
    assert.equal(m.source, "ai");
    assert.equal(m.headline, out.headline);
    const app = m.glance.find((g) => g.id === "app-release");
    assert.deepEqual([app?.title, app?.jiras, app?.badge], ["REQUIRE app build for CAV-7280", ["CAV-7280"], "REQUIRED"]); // Jiras from the rollup, not the model
    const added = m.glance.find((g) => g.title.startsWith("DEPLOY Slake"));
    assert.deepEqual(added?.jiras, ["CAV-7280", "CAV-7281"]);
    const e = m.sections.find((s) => s.id === "deploy")?.entries.find((x) => x.key === "svc:slake reporting");
    assert.deepEqual([e?.title, e?.line, e?.badge, e?.jiras.length], ["Slake Reporting (13)", "Deploy Slake Reporting once", "DONE", 13]);
    assert.equal(JSON.stringify(m.sections.find((s) => s.id === "appRelease")?.entries.find((x) => x.key === "app")?.jiras), appBefore);
    assert.equal(find(r13, "deploy", "svc:slake reporting").title, "Slake Reporting"); // the input rollup is untouched
  });

  it("drops a hallucinated Jira key and unknown sections / entries; the notes say so", () => {
    const m = applySummary(r13, {
      headline: "x",
      glance: [{ badge: "INFO", severity: "info", title: "NOTE something", detail: "d", jiras: ["CAV-7280", "CAV-0000", "NOPE-1"] }],
      entries: [
        { sectionId: "deploy", key: "svc:made up service", title: "Invented" },
        { sectionId: "nowhere", key: "x", title: "Invented" },
      ],
    });
    assert.deepEqual(m.glance.find((g) => g.title === "NOTE something")?.jiras, ["CAV-7280"]);
    assert.ok(m.notes.some((n) => /unknown Jira key CAV-0000/.test(n)) && m.notes.some((n) => /unknown entry/.test(n)) && m.notes.some((n) => /unknown section/.test(n)));
    assert.equal(JSON.stringify(m.sections).includes("Invented"), false);
  });

  it("never lets the model remove or downgrade an entry that needs attention, nor drop a blocker bullet", () => {
    const mixed = buildRollup(input([...realJiras(), unionJira()]));
    const attention = entries(mixed, "configs").find((e) => e.needsAttention && e.key.startsWith("cfg:")) as RollupEntry;
    const m = applySummary(mixed, {
      headline: "all fine",
      glance: [{ badge: "INFO", severity: "info", title: "ALL GOOD nothing to do", detail: "-", jiras: [] }],
      entries: [{ sectionId: "configs", key: attention.key, badge: "DONE", severity: "info", title: "fine" }],
    });
    const kept = m.sections.find((s) => s.id === "configs")?.entries.find((e) => e.key === attention.key);
    assert.deepEqual([kept?.badge, kept?.severity, kept?.needsAttention, kept?.title], ["ATTENTION", "warn", true, "fine"]);
    // every deterministic entry is still there
    for (const s of mixed.sections) assert.deepEqual(m.sections.find((x) => x.id === s.id)?.entries.map((e) => e.key), s.entries.map((e) => e.key));
    // the deterministic blocker / ATTENTION bullets survive an answer that does not mention them
    for (const g of mixed.atAGlance.filter((x) => x.severity === "blocker" || x.badge === "ATTENTION")) assert.ok(m.glance.some((x) => x.id === g.id), g.id);
    assert.equal(m.glance[0].severity, "blocker");
    // the model cannot add a blocker of its own
    const sneaky = applySummary(mixed, { headline: "h", glance: [{ badge: "ATTENTION", severity: "blocker", title: "STOP everything", detail: "", jiras: [] }] });
    assert.ok(sneaky.glance.find((g) => g.title === "STOP everything")?.severity === "warn");
  });

  it("falls back to the rule-based summary on empty or invalid output", () => {
    for (const bad of [null, undefined, "not json {", "[]", "42", {}, { headline: "" }, { glance: [] }, { glance: [{ badge: "SHINY", severity: "warn", title: "x" }] }]) {
      const m = applySummary(r13, bad);
      assert.equal(m.source, "rules", JSON.stringify(bad));
      assert.deepEqual(m.glance, g0);
      assert.equal(m.headline, rulesHeadline(r13));
      assert.deepEqual(m.sections, r13.sections);
    }
    // JSON text (with a code fence) is accepted
    assert.equal(applySummary(r13, "```json\n" + JSON.stringify({ headline: "ok", glance: [{ badge: "INFO", severity: "info", title: "DEPLOY x" }] }) + "\n```").source, "ai");
    // only a headline is enough to be "ai", the glance stays deterministic
    const h = applySummary(r13, { headline: "just a headline" });
    assert.deepEqual([h.source, h.headline, h.glance], ["ai", "just a headline", g0]);
  });

  it("truncates over-long text and strips markup; reads the tool call out of a response", () => {
    const m = applySummary(r13, { headline: "H".repeat(500), glance: [{ badge: "INFO", severity: "info", title: "<b>T</b>".repeat(60), detail: "d".repeat(900), jiras: [] }], entries: [{ sectionId: "deploy", key: "svc:slake reporting", title: "t".repeat(300), line: "<script>x</script> " + "l".repeat(400) }] });
    assert.ok(m.headline.length <= 160);
    const t = m.glance.find((g) => g.id.startsWith("ai-"));
    assert.ok(t && t.title.length <= 80 && t.detail.length <= 200 && !/[<>]/.test(t.title));
    const e = m.sections.find((s) => s.id === "deploy")?.entries.find((x) => x.key === "svc:slake reporting");
    assert.ok(e && e.title.length <= 80 && e.line.length <= 140 && !/[<>]/.test(e.line));
    const resp = { blocks: [{ type: "text" as const, text: "thinking" }, { type: "tool_use" as const, id: "1", name: SUMMARY_TOOL_NAME, input: { headline: "from tool", glance: [] } }], stopReason: null, inputTokens: 0, outputTokens: 0, model: "m" };
    assert.deepEqual(summaryFromResponse(resp), { headline: "from tool", glance: [] });
    assert.equal(summaryFromResponse(null), null);
  });

  it("the cache hash is stable under input order and changes when an answer changes", () => {
    const a = summaryHash(r13);
    const reversed = buildRollup(input([...thirteen()].reverse().map((j) => ({ ...j, records: [...j.records].reverse() }))));
    assert.equal(summaryHash(reversed), a);
    const changed = thirteen();
    changed[3] = { ...changed[3], records: [variant(3, (x) => { x.marker.key = changed[3].key; setRow(x, "designations", "not_done", "Not Done: all", "all"); })] };
    assert.notEqual(summaryHash(buildRollup(input(changed))), a);
    // a different checklist object with the same content gives the same rollup
    assert.equal(summaryHash(buildRollup(input(thirteen()), { checklist: buildChecklist(input(thirteen())) })), a);
  });
});

/**
 * The Checklist tab's summary: pure helpers (glance order, badges, status line wording, copy text) and server renders of the glance board and the
 * per-section tables from a rollup built from a 13-Jira synthetic movement (union review comments, answers varied) and from the real CAV-7280 comment.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ParsedRecord } from "@/lib/movement/record";
import { buildChecklist } from "@/lib/movement/checklist/build";
import { buildRollup, type Rollup } from "@/lib/movement/checklist/rollup";
import { applySummary, rulesSummary } from "@/lib/movement/checklist/summary-ai";
import { unionJira, unionRecord } from "@/lib/movement/checklist/testkit";
import type { ChecklistInput, ChecklistJiraInput } from "@/lib/movement/checklist/types";
import type { Glance, SummaryView } from "./api-types";
import { LinkProvider } from "./linkified";
import { MovementChecklist } from "./movement-checklist";
import { BadgeView, SummaryPanel, SummarySection } from "./summary-panel";
import { badgeLook, entryExpandable, generateErrorText, orderGlance, statsStrip, summaryCopyText, summaryStatusLine } from "./summary";
import type { SummaryState } from "./use-summary";

function setRow(r: ParsedRecord, rowId: string, state: string, answer: string, text = "") {
  const row = (r.facts.releaseRows ?? []).find((x) => x.id === rowId);
  assert.ok(row);
  Object.assign(row, { state, answer, text });
}
/** One union review comment per Jira, 13 Jiras, answers varied; Jira 0 requires an app release. */
function thirteen(): ChecklistJiraInput[] {
  return Array.from({ length: 13 }, (_, i) => {
    const key = `CAV-${7280 + i}`;
    const r: ParsedRecord = JSON.parse(JSON.stringify(unionRecord()));
    r.comment.id = String(90000 + i);
    r.marker.key = key;
    (r.facts.covers ?? []).forEach((c, k) => (c.pr = 9000 + i * 10 + k));
    if (i === 0) setRow(r, "app_release", "yes", "Yes: new build", "new build");
    setRow(r, "code_reviewed", i % 3 === 0 ? "not_done" : "done", i % 3 === 0 ? "Not Done: pending approval" : "Done", i % 3 === 0 ? "pending approval" : "");
    setRow(r, "bundle_sdk", i % 4 === 0 ? "yes" : "no", i % 4 === 0 ? "Yes" : "No");
    setRow(r, "designations", i % 5 === 0 ? "not_done" : "done", i % 5 === 0 ? "Not Done: portal users" : "Done", i % 5 === 0 ? "portal users" : "");
    return { key, included: true, readiness: "ready", records: [r] } as ChecklistJiraInput;
  });
}
const input = (jiras: ChecklistJiraInput[], environment: ChecklistInput["environment"] = "prod"): ChecklistInput => ({ environment, jiras, branches: [] });

const rollup13: Rollup = buildRollup(input(thirteen()));
const rollup1: Rollup = buildRollup(input([unionJira()], "demo"));
const view = (rollup: Rollup, over: Partial<SummaryView> = {}): SummaryView => ({
  summary: rulesSummary(rollup),
  rollup,
  status: "none",
  hash: "h",
  source: "rules",
  generatedAt: null,
  generatedBy: null,
  model: null,
  note: null,
  ai: { available: true, reason: null },
  ...over,
});
const state = (v: SummaryView | null, over: Partial<SummaryState> = {}): SummaryState => ({ data: v, loading: false, error: null, stale: false, generating: false, genError: null, ...over });
const noop = () => {};
const panel = (st: SummaryState, over: { canGenerate?: boolean; needsRefresh?: boolean; allOpen?: boolean } = {}) =>
  renderToStaticMarkup(h(LinkProvider, { jiraBaseUrl: "https://example.atlassian.net", children: h(SummaryPanel, { state: st, canGenerate: over.canGenerate ?? true, needsRefresh: over.needsRefresh ?? false, onGenerate: noop, onRetry: noop, allOpen: over.allOpen ?? true, epoch: 0 }) }));
const tag = (html: string, testid: string): string => {
  const at = html.indexOf(`data-testid="${testid}"`);
  assert.ok(at >= 0, `no element with data-testid=${testid}`);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};
const isDisabled = (t: string) => /\sdisabled(=|\s|>)/.test(t) || /aria-disabled="true"/.test(t);
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("summary: pure helpers", () => {
  const g = (id: string, severity: Glance["severity"]): Glance => ({ id, badge: "INFO", severity, title: id, detail: "", jiras: [] });
  it("glance cards: blockers, then warnings, then info; the server's order is kept inside a group; the input is not mutated", () => {
    const input = [g("a", "info"), g("b", "warn"), g("c", "blocker"), g("d", "warn"), g("e", "blocker")];
    assert.deepEqual(orderGlance(input).map((x) => x.id), ["c", "e", "b", "d", "a"]);
    assert.deepEqual(input.map((x) => x.id), ["a", "b", "c", "d", "e"]);
  });
  it("badges: state words look like state words everywhere, REQUIRED / ATTENTION / INFO are chips", () => {
    assert.deepEqual(badgeLook("DONE"), { kind: "state", state: "done" });
    assert.deepEqual(badgeLook("NOT DONE"), { kind: "state", state: "notdone" });
    assert.deepEqual(badgeLook("NOT REQUIRED"), { kind: "state", state: "na" });
    assert.deepEqual(badgeLook("YES"), { kind: "state", state: "yesno" });
    assert.deepEqual(badgeLook("UNKNOWN"), { kind: "state", state: "unknown" });
    assert.deepEqual(badgeLook("ATTENTION"), { kind: "chip", tone: "danger" });
    assert.deepEqual(badgeLook("REQUIRED"), { kind: "chip", tone: "warn" });
    assert.deepEqual(badgeLook("INFO"), { kind: "chip", tone: "muted" });
  });
  it("the stats strip carries the headline numbers and goes muted at zero", () => {
    const s = statsStrip(rollup13.headline);
    assert.deepEqual(s.map((x) => x.label), ["Jiras", "PRs", "Review comments", "Need attention", "Unknowns", "Not done"]);
    assert.equal(s[0].value, 13);
    assert.equal(statsStrip({ ...rollup13.headline, needAttention: 0, unknowns: 0, notDone: 0 }).filter((x) => x.tone === "muted").length, 3);
  });
  it("status line wording by status and ai.available", () => {
    const base = { generatedAt: "2026-11-20T06:00:00Z", model: "MiniMax-M2", note: null as string | null };
    const fresh = summaryStatusLine({ ...base, status: "fresh", source: "ai", ai: { available: true, reason: null } }, true);
    assert.match(fresh.text, /^Summary: AI-written .* IST \(MiniMax-M2\)$/);
    assert.equal(fresh.button.label, "Regenerate");
    assert.equal(fresh.button.disabledReason, null);
    const stale = summaryStatusLine({ ...base, status: "stale", source: "rules", ai: { available: true, reason: null } }, true);
    assert.match(stale.text, /^Summary: stale: /);
    assert.equal(stale.tone, "warn");
    assert.equal(stale.button.label, "Regenerate");
    const none = summaryStatusLine({ ...base, status: "none", source: "rules", ai: { available: true, reason: null } }, true);
    assert.equal(none.text, "Summary: rules only (not generated yet)");
    assert.equal(none.button.label, "Generate with AI");
    const noAi = summaryStatusLine({ ...base, status: "none", source: "rules", ai: { available: false, reason: "no API key" } }, true);
    assert.equal(noAi.text, "Summary: rules only (AI not available: no API key)");
    assert.equal(noAi.button.disabledReason, "AI is not available: no API key");
    const failed = summaryStatusLine({ ...base, status: "none", source: "rules", note: "The AI answer was not usable; showing the rules summary", ai: { available: true, reason: null } }, true);
    assert.match(failed.text, /The AI answer was not usable/);
  });
  it("the button is off, with a reason, for non-managers and while the stored data must be re-read", () => {
    const v = { generatedAt: null, model: null, note: null, status: "none" as const, source: "rules" as const, ai: { available: true, reason: null } };
    assert.equal(summaryStatusLine(v, false).button.disabledReason, "Only delivery managers can generate the summary");
    assert.equal(summaryStatusLine(v, true, true).button.disabledReason, "The stored data must be re-read first");
    assert.equal(summaryStatusLine(v, true).button.disabledReason, null);
  });
  it("a refused generation says the server's own sentence; a 429 has a plain default", () => {
    assert.equal(generateErrorText(429, "Wait 20 s"), "Wait 20 s");
    assert.match(generateErrorText(429, null), /try again/);
    assert.equal(generateErrorText(500, null), "Could not generate the summary");
  });
  it("the copy text: a title, the headline, the at-a-glance bullets and every non-empty section with its Jiras", () => {
    const sm = rulesSummary(rollup13);
    const t = summaryCopyText({ environment: "prod", deliveryName: "Release 7", summary: sm, source: "rules" });
    assert.match(t, /^Summary for PROD movement: Release 7 \(rules only\)\n/);
    assert.ok(t.includes(sm.headline));
    assert.match(t, /\nAt a glance\n- \[/);
    assert.ok(t.includes("CAV-7280"));
    for (const s of sm.sections.filter((x) => x.entries.length)) assert.ok(t.includes(`\n${s.title}\n`), s.title);
    for (const s of sm.sections.filter((x) => !x.entries.length)) assert.ok(!t.includes(`\n${s.title}\n`), `${s.title} is empty and left out`);
    assert.ok(!/<[a-z]/.test(t), "plain text");
    assert.match(summaryCopyText({ environment: "uat", deliveryName: "D", summary: sm, source: "ai" }), /\(AI-written\)/);
  });
  it("an entry expands only when it has details or per-environment cells", () => {
    assert.equal(entryExpandable({}), false);
    assert.equal(entryExpandable({ details: [] }), false);
    assert.equal(entryExpandable({ details: [{ text: "x", jiras: [] }] }), true);
  });
});

describe("summary: glance board and tables (13-Jira movement)", () => {
  const html = panel(state(view(rollup13)));
  it("the rollup has 13 Jiras; the panel shows the headline, the status line, the stats strip", () => {
    assert.equal(rollup13.headline.jiras, 13);
    assert.ok(html.includes('data-testid="movement-summary-headline"'));
    assert.match(text(html.slice(html.indexOf('data-testid="movement-summary-headline"'))), /13 Jiras/);
    assert.match(tag(html, "movement-summary-status"), /movement-summary-status/);
    assert.match(html.slice(html.indexOf('data-testid="movement-summary-status"')), /^[^>]*>Summary: rules only \(not generated yet\)</);
    assert.match(text(html.slice(html.indexOf('data-testid="movement-summary-stats"'))), /13 Jiras .*Review comments/);
  });
  it("At a glance: one card per glance item, blockers first, each with a severity bar and a badge; cards are numbered from 0", () => {
    const glance = orderGlance(rollup13.atAGlance);
    assert.ok(glance.length > 0 && glance.length <= 10, `${glance.length} cards`);
    assert.ok(html.includes('data-testid="movement-glance"'));
    for (let i = 0; i < glance.length; i++) assert.ok(html.includes(`data-testid="movement-glance-card-${i}"`), `card ${i}`);
    assert.ok(!html.includes(`data-testid="movement-glance-card-${glance.length}"`));
    const sev = [...html.matchAll(/data-testid="movement-glance-card-\d+" data-severity="(\w+)"/g)].map((m) => m[1]);
    const rank = { blocker: 0, warn: 1, info: 2 } as Record<string, number>;
    assert.deepEqual(sev, [...sev].sort((a, b) => rank[a] - rank[b]), "ordered by severity");
    assert.match(html.slice(html.indexOf('data-testid="movement-glance-card-0"')), /^[^>]*>.*?bg-(red|amber|sky)-/);
  });
  it("one table per section that has entries, with Entry / Badge / Summary / Jiras columns; 13 Jira chips are reachable from the entries", () => {
    for (const s of rollup13.sections) assert.ok(html.includes(`data-testid="movement-summary-table-${s.id}"`), s.id);
    const withEntries = rollup13.sections.find((s) => s.entries.length > 0)!;
    const sec = html.slice(html.indexOf(`data-testid="movement-summary-table-${withEntries.id}"`));
    const table = sec.slice(0, sec.indexOf("</table>"));
    assert.match(table, /<th[^>]*>Entry<\/th><th[^>]*>Badge<\/th><th[^>]*>Summary<\/th><th[^>]*>Jiras<\/th>/);
    assert.equal((table.match(/data-testid="movement-summary-entry-/g) ?? []).length, withEntries.entries.length);
    assert.ok(rollup13.sections.some((s) => s.entries.some((e) => e.jiras.length > 1)), "union semantics: one entry names many Jiras");
  });
  it("the same item in many Jiras is ONE entry: the code-review row of 13 Jiras says 5 not done, 8 done and lists who is behind it", () => {
    const rows = rollup13.sections.flatMap((s) => s.entries).filter((x) => x.key === "row:code_reviewed");
    assert.equal(rows.length, 1);
    const e = rows[0];
    assert.equal(e.badge, "NOT DONE");
    assert.match(e.line, /^5 Jiras not done: CAV-7280, CAV-7283, CAV-7286 \+2 more · 8 done$/);
    assert.ok(!e.line.includes("Code reviewed"), "the line does not echo the title");
    assert.equal(e.jiras.length, 13);
    assert.equal(entryExpandable(e), true, "the per-answer details expand");
    assert.deepEqual(e.details?.find((d) => /^Not done/.test(d.text))?.jiras, ["CAV-7280", "CAV-7283", "CAV-7286", "CAV-7289", "CAV-7292"]);
    const html = text(renderToStaticMarkup(h(LinkProvider, { jiraBaseUrl: null, children: h(SummarySection, { section: rollup13.sections.find((s) => s.entries.includes(e))!, defaultOpen: true }) })));
    assert.match(html, /Code reviewed, no breakage other LOBs/);
    assert.match(html, /5 Jiras not done: CAV-7280, CAV-7283, CAV-7286 \+2 more · 8 done/);
  });
  it("the button: 'Generate with AI' when there is none; off for a non-manager, when AI is unavailable and while it re-reads", () => {
    assert.match(html.slice(html.indexOf('data-testid="movement-summary-generate"')), /^[^>]*>Generate with AI</);
    assert.ok(!isDisabled(tag(html, "movement-summary-generate")));
    const viewer = panel(state(view(rollup13)), { canGenerate: false });
    assert.ok(isDisabled(tag(viewer, "movement-summary-generate")));
    const noAi = panel(state(view(rollup13, { ai: { available: false, reason: "no key" } })));
    assert.ok(isDisabled(tag(noAi, "movement-summary-generate")));
    assert.match(text(noAi), /AI not available: no key/);
    assert.ok(isDisabled(tag(panel(state(view(rollup13)), { needsRefresh: true }), "movement-summary-generate")));
  });
  it("fresh AI: written line with the model and 'Regenerate'; the AI headline replaces the rules one", () => {
    const ai = applySummary(rollup13, { headline: "Thirteen Jiras; five still wait for code review.", glance: [], sections: [] });
    const v = view(rollup13, { status: "fresh", source: "ai", generatedAt: "2026-11-20T06:00:00Z", model: "MiniMax-M2", summary: ai });
    const out = panel(state(v));
    assert.match(out, /Summary: AI-written .* IST \(MiniMax-M2\)/);
    assert.match(out.slice(out.indexOf('data-testid="movement-summary-generate"')), /^[^>]*>Regenerate</);
    assert.ok(text(out).includes(ai.headline));
  });
  it("generating: the button says so and is off; a failed generation shows the message", () => {
    const g = panel(state(view(rollup13), { generating: true }));
    assert.ok(isDisabled(tag(g, "movement-summary-generate")));
    assert.match(g, />Generating…</);
    const f = panel(state(view(rollup13), { genError: "Generated a moment ago; try again soon" }));
    assert.match(f, /role="alert"[^>]*data-testid="movement-summary-generate-error"[^>]*>Generated a moment ago/);
  });
  it("loading, error and stale-input states; nothing blocks on the AI", () => {
    assert.match(panel(state(null, { loading: true })), /Loading the summary…/);
    assert.match(panel(state(null, { error: "Could not load the summary" })), /role="alert"[^>]*>Could not load the summary/);
    assert.match(panel(state(null, { error: "x", stale: true })), /The stored data must be re-read first; use Refresh\./);
    assert.ok(!panel(state(null, { error: "x", stale: true })).includes(">Retry<"), "no Retry when a Refresh is what fixes it");
  });
  it("a section is collapsible (aria-expanded) and closed sections have no table", () => {
    const open = panel(state(view(rollup13)), { allOpen: true });
    const closed = panel(state(view(rollup13)), { allOpen: false });
    const id = rollup13.sections.find((s) => s.entries.length)!.id;
    assert.match(tag(open, `movement-summary-toggle-${id}`), /aria-expanded="true"/);
    assert.match(tag(closed, `movement-summary-toggle-${id}`), /aria-expanded="false"/);
    assert.ok(!closed.includes("<table"), "no table while closed");
    assert.ok(open.includes("<table"));
    const empty = rollup13.sections.find((s) => !s.entries.length);
    if (empty) assert.match(text(renderToStaticMarkup(h(SummarySection, { section: empty, defaultOpen: true }))), /Nothing recorded\./);
  });
  it("Jira keys in the text become links through the page's provider; no HTML from Jira text", () => {
    assert.match(html, /href="https:\/\/example\.atlassian\.net\/browse\/CAV-7280"/);
    const evil = structuredClone(rollup13);
    evil.atAGlance[0].title = "<img src=x onerror=alert(1)>";
    const out = panel(state(view(evil)));
    assert.ok(!out.includes("<img"));
  });
  it("the badge view uses the state fonts for state words and a chip for ATTENTION", () => {
    assert.match(renderToStaticMarkup(h(BadgeView, { badge: "NOT DONE" })), /data-state="notdone"/);
    assert.match(renderToStaticMarkup(h(BadgeView, { badge: "ATTENTION" })), /movement-badge-attention/);
  });
});

describe("summary: the real CAV-7280 comment", () => {
  it("one Jira (demo): the glance board and every section table render", () => {
    const out = panel(state(view(rollup1)));
    assert.ok(out.includes('data-testid="movement-glance-card-0"'));
    assert.ok(out.includes("CAV-7280"));
    for (const s of rollup1.sections) assert.ok(out.includes(`data-testid="movement-summary-table-${s.id}"`));
  });
});

describe("the Checklist tab: Summary | All items", () => {
  const checklist = buildChecklist(input(thirteen()));
  const tab = (summary: Parameters<typeof MovementChecklist>[0]["summary"]) =>
    renderToStaticMarkup(h(LinkProvider, { jiraBaseUrl: null, children: h(MovementChecklist, { checklist, loading: false, error: null, onRetry: noop, exportBase: "/api/x/export", summary }) }));
  const sum = { state: state(view(rollup13)), canGenerate: true, onGenerate: noop, onRetry: noop };
  it("with a summary the tab opens on 'Summary': the switch, the glance board and the summary tables; the item list is one click away", () => {
    const html = tab(sum);
    assert.ok(html.includes('data-testid="movement-view-switch"'));
    assert.match(tag(html, "movement-view-summary"), /aria-pressed="true"/);
    assert.match(tag(html, "movement-view-all"), /aria-pressed="false"/);
    assert.ok(html.includes('data-testid="movement-glance"'));
    assert.ok(!html.includes('data-testid="movement-sections"'), "the per-section item list is the other view");
    assert.ok(html.includes('data-testid="movement-export"'), "export stays in the header");
  });
  it("without a summary (older callers) only the item list shows, with no switch", () => {
    const html = tab(undefined);
    assert.ok(!html.includes("movement-view-switch"));
    assert.ok(html.includes('data-testid="movement-sections"'));
  });
});

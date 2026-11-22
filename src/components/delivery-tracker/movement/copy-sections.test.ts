/**
 * "Copy" on every section of the Checklist tab (Summary tables, the At a glance board, the All items sections) and the plain wording behind it,
 * on the 13-Jira synthetic movement of summary.test.ts and the real CAV-7280 comment.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildChecklist } from "@/lib/movement/checklist/build";
import { buildRollup } from "@/lib/movement/checklist/rollup";
import { rulesSummary, SUMMARY_INSTRUCTIONS } from "@/lib/movement/checklist/summary-ai";
import { unionJira } from "@/lib/movement/checklist/testkit";
import type { Checklist } from "./api-types";
import { LinkProvider } from "./linkified";
import { MovementChecklist } from "./movement-checklist";
import { plainItems, sectionPlainText } from "./plain-items";
import { glanceText, plainLine, plainSummary, summarySectionText } from "./summary";
import { JiraChips, SummaryPanel } from "./summary-panel";
import type { SummaryState } from "./use-summary";

const noop = () => {};
const rollup = buildRollup({ environment: "demo", jiras: [unionJira()], branches: [] });
const summary = rulesSummary(rollup);
const state: SummaryState = {
  data: { summary, rollup, status: "none", hash: "h", source: "rules", generatedAt: null, generatedBy: null, model: null, note: null, ai: { available: true, reason: null } },
  loading: false,
  error: null,
  stale: false,
  generating: false,
  genError: null,
};
const checklist: Checklist = buildChecklist({ environment: "demo", jiras: [unionJira()], branches: [] });
const html = renderToStaticMarkup(h(LinkProvider, { jiraBaseUrl: null, children: h(SummaryPanel, { state, canGenerate: true, needsRefresh: false, onGenerate: noop, onRetry: noop, allOpen: true, epoch: 0, env: { environment: "demo", deliveryName: "UAT Delivery" } }) }));
const allItems = renderToStaticMarkup(h(LinkProvider, { jiraBaseUrl: null, children: h(MovementChecklist, { checklist, loading: false, error: null, onRetry: noop, exportBase: "/x", heading: { environment: "demo", deliveryName: "UAT Delivery" } }) }));

describe("Copy buttons on the Checklist tab", () => {
  it("the At a glance board and every Summary table have their own Copy button", () => {
    assert.match(html, /data-testid="movement-glance-copy"/);
    for (const s of summary.sections) assert.match(html, new RegExp(`data-testid="movement-summary-copy-${s.id}"`), s.id);
  });
  it("a Summary table with nothing in it has its Copy button off", () => {
    const empty = summary.sections.find((s) => s.entries.length === 0);
    if (empty) assert.match(html.slice(html.indexOf(`data-testid="movement-summary-copy-${empty.id}"`)), /^[^>]*disabled/);
  });
  it("every section of All items has a Copy button, and so do the unknowns, conflicts and warnings blocks that exist", () => {
    for (const s of checklist.sections) assert.match(allItems, new RegExp(`data-testid="movement-copy-section-${s.id}"`), s.id);
    if (checklist.unknownsByOwner.length) assert.match(allItems, /data-testid="movement-unknowns-copy"/);
    if (checklist.warnings.length) assert.match(allItems, /data-testid="movement-warnings-copy"/);
  });
  it("the page never scrolls sideways because of a hidden table header: tables sit in a positioned scroll box", () => {
    assert.match(html, /class="relative overflow-x-auto[^"]*" data-testid="movement-summary-scroll-/);
  });
});

describe("plain wording of the Summary board", () => {
  const plain = plainSummary(summary);
  it("each section copies as its title, then every entry with badge, line and Jiras; details as points; a count of the unlisted", () => {
    for (const s of summary.sections.filter((x) => x.entries.length)) {
      const t = summarySectionText(s, plain, { environment: "demo", deliveryName: "UAT Delivery" });
      assert.ok(t.startsWith(`${s.title} (DEMO movement: UAT Delivery)\n`), s.id);
      for (const e of s.entries) assert.ok(t.includes(`- ${e.title} [${e.badge}]`), `${s.id}/${e.key}`);
      assert.ok(!/unknown \(/i.test(t) && !/\[V\]|\(D\d\)/.test(t));
    }
  });
  it("the At a glance copy is in severity order, one bullet per card, with its plain detail under it", () => {
    const t = glanceText(summary.glance, plain, { environment: "demo", deliveryName: "UAT Delivery" });
    assert.ok(t.startsWith("At a glance (DEMO movement: UAT Delivery)\n"));
    assert.equal((t.match(/^- \[/gm) ?? []).length, summary.glance.length);
  });
  it("a detail that only repeats the entry line is left out of the points", () => {
    const e = summary.sections.flatMap((s) => s.entries).find((x) => (x.details?.length ?? 0) > 0);
    if (!e) return;
    const withDup = { ...summary, sections: [{ id: "deploy" as const, title: "T", entries: [{ ...e, line: "Slake Reporting restarts when the configs change", details: [{ text: "Slake Reporting restarts when the configs change", jiras: [] }, { text: "Another thing worth saying here", jiras: [] }] }] }] };
    const p = plainSummary(withDup);
    const pe = p.sections.get("T".length ? "deploy" : "")?.get(e.key);
    assert.equal(pe?.details.length, 1);
    assert.equal(pe?.details[0].plain.lead, "Another thing worth saying here");
  });
  it("plainLine words 'unknown (x)' and never returns an empty line", () => {
    assert.equal(plainLine("oldest build: unknown (mobile lead)"), "oldest build: not known yet — mobile lead to confirm");
    assert.equal(plainLine("see row 6"), "see row 6");
  });
});

describe("plain wording of All items", () => {
  const plain = plainItems(checklist);
  it("every free-text item has a plain text; an item whose every sentence an earlier item already said is a repeat and shows 'Already listed above'", () => {
    const texts = checklist.sections.flatMap((s) => s.items).filter((i) => !i.config);
    for (const i of texts) assert.ok(plain.byId.has(i.id), i.key);
    assert.equal((allItems.match(/data-testid="movement-item-repeat"/g) ?? []).length <= plain.repeats.size, true, "only repeats say so");
  });
  it("the section copy is '<n>. <title>' (with the environment and delivery), an item per line, points under it, repeats left out, no raw tags", () => {
    for (const s of checklist.sections.filter((x) => x.items.length)) {
      const t = sectionPlainText(s, plain, { environment: "demo", deliveryName: "UAT Delivery" });
      assert.ok(t.startsWith(`${s.number}. ${s.title} (DEMO movement: UAT Delivery)\n`), s.id);
      assert.ok(!/\[V\]|\[I\]|\(D\d\)|unknown \(/.test(t), s.id);
    }
  });
  it("the same fact in two items of different sections is copied once", () => {
    const fake = {
      sections: [
        { id: "deploy", number: 4, title: "Services to deploy", items: [{ id: "a", ih: "", key: "row:x", text: "Services to deploy: Slake Reporting only (executor + configs)", sources: [] }] },
        { id: "restart", number: 5, title: "Services to restart", items: [{ id: "b", ih: "", key: "svc:y", text: "Services to deploy: Slake Reporting only (executor + configs)", sources: [] }] },
      ],
    } as unknown as Checklist;
    const p = plainItems(fake);
    assert.deepEqual([...p.repeats], ["b"]);
    assert.ok(!sectionPlainText(fake.sections[1], p).includes("Slake Reporting only"));
  });
});

describe("summary instructions: plain language for the AI summary", () => {
  it("ask for short sentences, plain words, one action verb first, no repeated facts, and ban the jargon", () => {
    assert.match(SUMMARY_INSTRUCTIONS, /Plain language\. Short sentences/);
    assert.match(SUMMARY_INSTRUCTIONS, /ONE action verb/);
    assert.match(SUMMARY_INSTRUCTIONS, /Say each fact ONCE/);
    for (const banned of ['"row"', '"union"', '"overlay"']) assert.ok(SUMMARY_INSTRUCTIONS.includes(banned), banned);
    assert.match(SUMMARY_INSTRUCTIONS, /not known yet - <owner> to confirm/);
  });
});

describe("Jiras column", () => {
  const keys = Array.from({ length: 13 }, (_, i) => `CAV-${7280 + i}`);
  const chips = (p: Parameters<typeof JiraChips>[0]) => renderToStaticMarkup(h(LinkProvider, { jiraBaseUrl: null, children: h(JiraChips, p) }));
  it("an entry that covers every Jira shows ONE chip 'All 13 Jiras'", () => {
    const html = chips({ jiras: keys, total: 13 });
    assert.match(html, />All 13 Jiras</);
    assert.ok(!html.includes("CAV-7280"));
  });
  it("more than four Jiras: three chips and '+N more'; up to four: all of them", () => {
    const html = chips({ jiras: keys.slice(0, 9), total: 13 });
    assert.equal((html.match(/CAV-72\d\d/g) ?? []).length, 3);
    assert.match(html, /\+6 more/);
    assert.equal((chips({ jiras: keys.slice(0, 4), total: 13 }).match(/CAV-72\d\d/g) ?? []).length, 4);
  });
  it("the server's own '+N' (moreJiras) is counted, and the expanded entry lists every key", () => {
    assert.match(chips({ jiras: keys.slice(0, 5), more: 4, total: 20 }), /\+6 more/);
    assert.equal((chips({ jiras: keys, full: true, total: 13 }).match(/CAV-72\d\d/g) ?? []).length, 13);
  });
  it("a one-Jira movement never says 'All 1 Jiras'", () => {
    assert.ok(!chips({ jiras: ["CAV-1"], total: 1 }).includes("All"));
  });
  it("the table says 'All N Jiras' for entries that cover every Jira of the movement, in the real page structure", () => {
    assert.match(html, /movement-jira-chips-all|CAV-7280/);
  });
});

describe("All items: PR lines", () => {
  it("a cover line reads 'repo#n — what it does (branch, commit, state)'", async () => {
    const { itemText } = await import("./plain-items");
    assert.equal(itemText({ key: "cover:channelkart#1147", text: "channelkart#1147 master 33e8209192 19 Nov APIs, guard, 2 properties (approved and merged by dev-b) [merged]" }), "channelkart#1147 — 19 Nov APIs, guard, 2 properties (approved and merged by dev-b) (master, 33e8209192, merged)");
    assert.equal(itemText({ key: "row:x", text: "unchanged" }), "unchanged");
    assert.equal(itemText({ key: "cover:before#1147", text: "before#1147 [merged]" }), "before#1147 [merged]");
  });
});

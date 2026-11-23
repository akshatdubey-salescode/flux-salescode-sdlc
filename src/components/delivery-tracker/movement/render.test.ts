/**
 * Server-render smoke tests of the movement components on the 7 real records: they must render
 * without throwing, keep every checklist section collapsed (no item rows), expose the data-testid
 * hooks the QA click-through relies on, and never turn Jira text into HTML.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildChecklist } from "@/lib/movement/checklist/build";
import { realJiras } from "@/lib/movement/checklist/testkit";
import type { ItemView, MovementView } from "./api-types";
import { checklistWanted } from "./logic";
import { CompletionBanner } from "./movement-page";
import { CreateFooter } from "./movement-create-dialog";
import { createDialogUi } from "./view-model";
import { BranchRow, BranchTable, HeldOnlyFlag, HeldOnlyNote } from "./movement-branches";
import { MovementChecklist } from "./movement-checklist";
import { MovementHeader } from "./movement-header";
import { CopyMenu, copyMenuModel } from "./copy-menu";
import { JiraDetailBody, MovementJiras } from "./movement-jiras";
import { SignoffBar } from "./movement-signoff-bar";
import { MovementEvents } from "./movement-events";
import { NeedsRefreshBanner, RefreshNotice } from "./movement-notices";

/** The whole opening tag that carries `data-testid="<id>"` (so an attribute is checked on THAT element, not in a loose window of text). */
function tagOf(html: string, testid: string): string {
  const at = html.indexOf(`data-testid="${testid}"`);
  assert.ok(at >= 0, `no element with data-testid=${testid}`);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}
const isDisabled = (tag: string) => /\sdisabled(=|\s|>)/.test(tag);

const checklist = buildChecklist({ environment: "prod", jiras: realJiras(), branches: [] });
const allowed = { allowed: true, reason: null };
const denied = { allowed: false, reason: "Only delivery managers can do this" };

const noSign = { dev: null, tester: null };
const base = { ticked: false, tickSet: false, recordCount: 0, reviews: 0, prs: { covered: 0 }, repos: [] as string[], reposMore: 0, warningsMore: 0, signoffs: noSign, result: "pending", resultComment: null, override: null, records: [], blockers: [], softWarnings: [] };
const NO_COMMENT = { code: "no_record", message: "No review comment found on this Jira", severity: "blocker" };
const items = [
  // one union review comment covering 2 PRs; a stale head and a HELD status as warnings
  { ...base, issueId: "i1", key: "CAV-7346", summary: "Partner banner <script>alert(1)</script>", included: true, ticked: true, readiness: "ready", recordCount: 1, reviews: 1, prs: { covered: 2 }, softWarnings: [{ code: "record_status", message: "CAV-7346 (demo): HELD in the DEMO movement", severity: "warning" }], signoffs: { dev: { by: "dev@x.com", at: "2026-11-19T06:00:00Z" }, tester: null } },
  { ...base, issueId: "i2", key: "CAV-7304", summary: "Account lock", included: false, readiness: "blocked", blockers: [{ code: "sibling_no_record", message: "channelkart#9 is named as a sibling in the record of CAV-7304 but has no record of its own", severity: "blocker" }] },
  { ...base, issueId: "i4", key: "CAV-7280", summary: "Required Loadout Number Filter in Loading Sheet", included: false, readiness: "blocked", blockers: [NO_COMMENT] },
  { ...base, issueId: "i3", key: "CAV-1", summary: "Overridden one", included: true, ticked: true, tickSet: true, readiness: "override", override: { reason: "agreed with lead", by: "Admin A", at: "2026-11-19T06:00:00Z" } },
] as unknown as ItemView[];

const noop = async () => true;
const noopErr = async () => null;

describe("MovementChecklist", () => {
  const html = renderToStaticMarkup(h(MovementChecklist, { checklist, loading: false, error: null, onRetry: () => {}, exportBase: "/api/x/export" }));
  it("renders the 14 sections OPEN by default with their items, within the row budget, and an Expand all / Collapse all toggle", () => {
    assert.equal((html.match(/data-testid="movement-section-[a-zA-Z]+"/g) ?? []).length, 14);
    for (const toggle of html.match(/<button[^>]*data-testid="movement-section-toggle-[a-zA-Z]+"[^>]*>/g) ?? []) assert.match(toggle, /aria-expanded="true"/);
    assert.equal((html.match(/data-testid="movement-section-toggle-[a-zA-Z]+"/g) ?? []).length, 14);
    const rows = (html.match(/data-testid="movement-item-[a-zA-Z]+"/g) ?? []).length;
    assert.ok(rows > 0, "the items are there without opening anything");
    assert.ok(rows <= 600, `${rows} item rows mounted at once`);
    assert.match(tagOf(html, "movement-sections-toggle-all"), /aria-pressed="true"/);
    assert.match(html.slice(html.indexOf('data-testid="movement-sections-toggle-all"')), /^[^>]*>Collapse all</);
    assert.ok(html.includes('data-testid="movement-export"'));
    assert.ok(html.includes('data-testid="movement-copy-section-configs"'));
  });
  it("has no 'Copy all' of its own, but still the per-section Copy buttons and Export", () => {
    assert.ok(!/>\s*(?:<svg[\s\S]*?<\/svg>)?\s*Copy all/.test(html) && !html.includes("movement-copy-all\""));
    assert.equal((html.match(/data-testid="movement-copy-section-[a-zA-Z]+"/g) ?? []).length, 14, "one Copy per section");
    assert.ok(html.includes('data-testid="movement-export"'));
  });
  it("shows the unknowns block grouped by owner on top, and the conflicts block when there are conflicts", () => {
    assert.ok(checklist.unknownsByOwner.length > 0, "the real records carry unknowns: this test must not be vacuous");
    assert.ok(html.includes('data-testid="movement-unknowns"'));
    assert.equal((html.match(/data-testid="movement-unknown-group"/g) ?? []).length, checklist.unknownsByOwner.length);
    assert.equal(html.includes('data-testid="movement-conflicts"'), checklist.conflicts.length > 0);
    const firstSection = html.indexOf('data-testid="movement-sections"');
    assert.ok(html.indexOf('data-testid="movement-unknowns"') < firstSection);
  });
  it("shows a retry when the checklist failed and a loading line while it loads", () => {
    const err = renderToStaticMarkup(h(MovementChecklist, { checklist: null, loading: false, error: "boom", onRetry: () => {}, exportBase: "" }));
    assert.match(err, /boom/);
    assert.match(err, /Retry/);
    assert.match(renderToStaticMarkup(h(MovementChecklist, { checklist: null, loading: true, error: null, onRetry: () => {}, exportBase: "" })), /Loading the checklist/);
  });
});

describe("MovementJiras", () => {
  const render = (edit: { allowed: boolean; reason: string | null } = allowed, override: { allowed: boolean; reason: string | null } = denied) =>
    renderToStaticMarkup(h(MovementJiras, { status: "ready", items, checklist, base: "/api/x", refreshKey: "k", hasHash: true, edit, override, revoke: denied, jiraBaseUrl: "https://example.atlassian.net", onTick: noop, onOverride: noopErr }));
  it("is a table: header columns, one row per Jira, the counts as filter chips, and the record help", () => {
    const html = render();
    assert.ok(html.includes('data-testid="movement-jira-table"'));
    assert.match(tagOf(html, "movement-jira-table"), /role="table"/);
    for (const col of ["Jira", "Status", "Why", "Dev", "Test", "Warn"]) assert.match(html, new RegExp(`role="columnheader"[^>]*>(?:<[^>]+>)*${col}<`), col);
    // the counts are chips that are also the filters
    const counts = html.slice(html.indexOf('data-testid="movement-jira-counts"'), html.indexOf('data-testid="movement-record-help"'));
    for (const [id, n] of [["all", 4], ["blocked", 2], ["ready", 1], ["overridden", 1], ["unticked", 0]] as const) {
      assert.match(counts.slice(counts.indexOf(`data-testid="movement-filter-${id}"`)), new RegExp(`^[^>]*>[^<]*<?[^>]*>?[^<]*${n}`), `${id} ${n}`);
    }
    assert.ok(html.includes('data-testid="movement-record-help"'));
    assert.ok(!html.includes("Changing the selection resets the sign-offs.") || /title="Changing the selection resets the sign-offs\."/.test(html), "that sentence is a tooltip, not permanent text");
    assert.ok(!html.includes('data-testid="movement-tick-note"'), "and it only shows while a tick is on its way");
  });
  it("each row has a tick, a link, ONE status chip and ONE short 'why'; no bullet lists, no repeated Jira key", () => {
    const html = render();
    for (const k of ["CAV-7346", "CAV-7304", "CAV-7280", "CAV-1"]) {
      assert.ok(html.includes(`data-testid="movement-tick-${k}"`), k);
      assert.ok(html.includes(`data-testid="movement-jira-why-${k}"`), k);
    }
    assert.ok(html.includes('href="https://example.atlassian.net/browse/CAV-7346"'));
    assert.equal((html.match(/data-testid="movement-readiness"/g) ?? []).length, 4, "one status chip per row");
    assert.ok(!html.includes("<ul"), "no free-text list in the rows");
    assert.ok(!/has no deployment record|has no record/.test(html.replace(/title="[^"]*"/g, "")), "the raw blocker sentences are not printed in the row (only in a tooltip)");
    assert.ok(!/deployment record/i.test(html.replace(/aria-label="What is the review comment\?"/, "")), "the jargon is gone from the rows");
  });
  it("the CAV-7280 example, no review comment: the row says 'Review not posted yet' once, with no PR counts", () => {
    const html = render();
    const why = html.slice(html.indexOf('data-testid="movement-jira-why-CAV-7280"'), html.indexOf('data-testid="movement-signoff-dev-CAV-7280"'));
    assert.equal((why.match(/Review not posted yet/g) ?? []).length, 1, "once, as the row text");
    assert.match(why, />Review not posted yet</);
    assert.ok(!/PRs? waiting|No record for|merged PR/.test(html), "nothing reads as if PRs were read");
    assert.match(tagOf(html, "movement-blockers-CAV-7280"), /title="No review comment found on this Jira"/);
    assert.ok(!html.includes('data-testid="movement-jira-blockers-table-CAV-7280"'), "the table is in the expansion, not the row");
  });
  it("with the union comment the row is ready: '1 review comment · 2 PRs', and its HELD warning is a count chip", () => {
    const html = render();
    const why = html.slice(html.indexOf('data-testid="movement-jira-why-CAV-7346"'), html.indexOf('data-testid="movement-signoff-dev-CAV-7346"'));
    assert.match(why, />1 review comment · 2 PRs</);
    assert.match(html.slice(html.indexOf('data-testid="movement-jira-warncount-CAV-7346"')), /^[^>]*>1</);
    assert.match(html.slice(html.indexOf('data-testid="movement-jira-why-CAV-7304"')), /Partly reviewed: channelkart#9 not covered/);
  });
  it("status: Ready / Blocked / Overridden / Not selected, and the override info reads in the why", () => {
    const html = render();
    const chip = (key: string) => html.slice(html.indexOf(`data-testid="movement-jira-${key}"`)).match(/data-testid="movement-readiness"[^>]*>([^<]*)</)?.[1];
    assert.deepEqual(["CAV-7346", "CAV-7304", "CAV-1"].map(chip), ["Ready", "Blocked", "Overridden"]);
    assert.ok(html.includes('data-testid="movement-override-info-CAV-1"'));
    assert.match(html, />Overridden by Admin A: agreed with lead</);
    const notSelected = renderToStaticMarkup(h(MovementJiras, { status: "ready", items: [{ ...items[0], included: false }] as never, checklist, base: "/api/x", refreshKey: "k", hasHash: true, edit: allowed, override: denied, revoke: denied, jiraBaseUrl: null, onTick: noop, onOverride: noopErr }));
    assert.match(notSelected, /data-testid="movement-readiness"[^>]*>Not selected</);
  });
  it("disables the tick of a blocked Jira and offers Override only on blocked rows (disabled for a non-admin)", () => {
    const html = render();
    assert.ok(isDisabled(tagOf(html, "movement-tick-CAV-7304")), "the blocked Jira's tick box is disabled");
    assert.ok(!isDisabled(tagOf(html, "movement-tick-CAV-7346")), "a ready Jira's tick box is enabled");
    assert.ok(isDisabled(tagOf(html, "movement-override-CAV-7304")), "a non-admin sees Override but it is disabled");
    assert.ok(!isDisabled(tagOf(render(allowed, allowed), "movement-override-CAV-7304")), "an admin can press it");
    assert.ok(!html.includes('data-testid="movement-override-CAV-7346"'));
    assert.ok(html.includes('data-testid="movement-revoke-CAV-1"'));
  });
  it("Dev / Test are labelled chips ('Dev ✓' green, 'Dev –' muted) for EVERY Jira, with who/when in the tooltip and the words for a screen reader", () => {
    const html = render();
    assert.match(tagOf(html, "movement-signoff-dev-CAV-7346"), /title="Dev signed by dev@x.com at /);
    assert.match(tagOf(html, "movement-signoff-dev-CAV-7346"), /bg-emerald-100/, "signed = green");
    assert.match(html.slice(html.indexOf('data-testid="movement-signoff-dev-CAV-7346"')), /^[^>]*><span aria-hidden="true">Dev ✓<\/span><span class="sr-only">Dev: signed</);
    assert.match(html.slice(html.indexOf('data-testid="movement-signoff-tester-CAV-7346"')), /^[^>]*><span aria-hidden="true">Test –<\/span><span class="sr-only">Tester: missing</);
    assert.match(tagOf(html, "movement-signoff-tester-CAV-7346"), /bg-muted/, "missing = muted");
    assert.match(tagOf(html, "movement-signoff-tester-CAV-7346"), /title="Tester sign-off is missing"/);
    for (const k of ["CAV-7346", "CAV-7304", "CAV-7280", "CAV-1"]) {
      assert.ok(html.includes(`data-testid="movement-signoff-dev-${k}"`), `dev of ${k}`);
      assert.ok(html.includes(`data-testid="movement-signoff-tester-${k}"`), `tester of ${k}`);
    }
    const noChecklist = renderToStaticMarkup(h(MovementJiras, { status: "ready", items, checklist: null, base: "/api/x", refreshKey: "k", hasHash: true, edit: allowed, override: denied, revoke: denied, jiraBaseUrl: null, onTick: noop, onOverride: noopErr }));
    assert.ok(noChecklist.includes('data-testid="movement-signoff-tester-CAV-7304"'));
  });
  it("warnings are a small count chip, not text; a default tick is explained in the tick's tooltip", () => {
    const html = render();
    assert.match(html.slice(html.indexOf('data-testid="movement-jira-warncount-CAV-7346"')), /^[^>]*>1</);
    assert.ok(!html.includes('data-testid="movement-jira-warncount-CAV-7304"'), "no warnings, no chip");
    assert.match(tagOf(html, "movement-tick-CAV-7346"), /title="Ticked by default because its review comments are valid/);
    assert.ok(!/auto-ticked|>channelkart</.test(html), "the auto-ticked chip and the repo chips are gone from the row");
    assert.match(tagOf(html, "movement-jira-why-CAV-7346") + html.slice(html.indexOf('data-testid="movement-jira-why-CAV-7346"')).slice(0, 600), /1 review comment · 2 PRs/, "a ready row says one plain fact about its review comment");
  });
  it("takes blockers and warnings from the view, not from codes", () => {
    const html = render();
    assert.ok(html.includes('data-testid="movement-blockers-CAV-7304"'));
    assert.ok(!html.includes('data-testid="movement-blockers-CAV-7346"'), "a soft warning is not a blocker");
    assert.ok(html.includes('data-group="warnings"'));
    assert.ok(html.includes('data-group="blocked"'));
    assert.ok(html.includes('data-group="overridden"'));
  });
  it("never renders Jira text as HTML", () => {
    const html = render();
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });
  it("the bulk buttons say they act on the FILTERED rows, with the count of the rows they will change", () => {
    const html = render();
    assert.match(html, /Select all filtered \(0\)/, "the only unticked Jiras are blocked, so nothing can be ticked");
    assert.match(html, /Clear selection \(2\)/);
  });
  it("renders no detail until a row is expanded", () => {
    assert.ok(!render().includes('data-testid="movement-jira-detail-'));
  });
});

describe("JiraDetailBody (the expansion)", () => {
  const body = (item: ItemView, state: Parameters<typeof JiraDetailBody>[0]["state"] = { phase: "loading" }) =>
    renderToStaticMarkup(h(JiraDetailBody, { item, state, onRetry: () => {}, checklistLoaded: true, hasHash: true, contributions: [] }));
  const noComment = items.find((i) => i.key === "CAV-7280")!;
  const union = items.find((i) => i.key === "CAV-7346")!;
  const detail = (over: Record<string, unknown> = {}) =>
    ({
      phase: "ok",
      data: {
        blockers: [],
        softWarnings: union.softWarnings,
        comments: [{ commentId: "c1", scope: "union", version: 2, status: "READY", updated: "2026-11-19T06:00:00Z", target: "demo", covers: ["slake-reporting-config#1313", "slake-custom-reports#931"] }],
        prs: [
          { prKey: "slake-reporting-config#1313", commentId: "c1", branch: "feature/CAV-7280-filter", sha: "f249c2be9c1234", note: "Adds the loadout filter to the loading sheet", prState: "merged", stale: false, headReviewed: "f249c2be9c1234", headMovedTo: null },
          { prKey: "slake-custom-reports#931", commentId: "c1", branch: "main", sha: "e2ad816ab0aaaa", note: null, prState: "merged", stale: true, headReviewed: "e2ad816ab0aaaa", headMovedTo: null },
        ],
        ...over,
      },
    }) as never;
  it("no review comment: a Problems table, the to-do line naming the Jira once, and 'No review comment on this Jira'", () => {
    const html = body(noComment);
    const t = html.slice(html.indexOf('data-testid="movement-jira-blockers-table-CAV-7280"'));
    assert.match(t, /<th[^>]*>Problem<\/th><th[^>]*>Details<\/th>/);
    assert.match(t.slice(0, t.indexOf("</table>")), />No review comment<\/td><td[^>]*>No review comment found on this Jira</);
    assert.match(html, /<h4[^>]*>Not reviewed yet<\/h4>/);
    const todo = html.slice(html.indexOf('data-testid="movement-jira-todo-CAV-7280"'));
    assert.match(todo, /The review comment has not been posted on CAV-7280\. Ask the reviewer to post one \(the Jira comment with the DEPLOYMENT-RECORD marker\), or an admin can override with a reason\./);
    assert.equal((todo.slice(0, todo.indexOf("</ul>")).match(/<li/g) ?? []).length, 1);
    assert.match(html, /No review comment on this Jira\./);
    assert.ok(!html.includes("movement-jira-prs-table-") && !html.includes("movement-jira-missing-table-"), "no PR table built from messages");
  });
  it("the union comment: one plain summary line; the comments / PRs tables moved into the per-Jira checklist (which is lazy, so loading here)", () => {
    const html = body(union, detail());
    assert.match(html, /<h4[^>]*>Review comment<\/h4>/);
    assert.match(html, /1 review comment · 2 PRs/);
    assert.ok(!html.includes("movement-jira-comments-table-") && !html.includes("movement-jira-prs-table-"), "no duplicate tables");
    assert.ok(!html.includes("movement-jira-todo-") && !html.includes("movement-jira-blockers-table-"), "a ready Jira has no problems / to-do");
  });
  it("with base + environment the expansion carries the per-Jira checklist and the Edit comment button; an edited Jira says so", () => {
    const full = (item: ItemView, edit = allowed) => renderToStaticMarkup(h(JiraDetailBody, { item, state: detail(), onRetry: () => {}, checklistLoaded: true, hasHash: true, contributions: [], base: "/api/x", environment: "demo", hash: "h1", edit, onCommentSaved: () => {} }));
    const html = full(union);
    assert.match(html, /data-testid="movement-comment-edit-CAV-7346"/);
    assert.match(html, /data-testid="movement-jira-checklist-CAV-7346"/);
    assert.ok(!html.includes("edited in Flux"));
    const edited = full({ ...union, edited: true, editedBy: "Asha" } as ItemView);
    assert.match(edited, /edited in Flux by Asha/);
    const denied = full(union, { allowed: false, reason: "Only a manager can edit" } as never);
    assert.match(tagOf(denied, "movement-comment-edit-CAV-7346"), /disabled/);
    const none = renderToStaticMarkup(h(JiraDetailBody, { item: noComment, state: { phase: "loading" }, onRetry: () => {}, checklistLoaded: true, hasHash: true, contributions: [], base: "/api/x", environment: "demo", hash: "h1", edit: allowed }));
    assert.ok(!none.includes("movement-jira-checklist-") && !none.includes("movement-comment-edit-"), "no review comment: nothing to edit or list");
  });
  it("warnings: HELD reads as Where 'CAV-7346 (demo)', a stale head as 'New commits since the review on <PR>'; 'Show all' beyond five", () => {
    const many = { ...union, softWarnings: Array.from({ length: 8 }, (_, i) => ({ code: "stale_record", message: `PR channelkart#${i} has new commits since the review: reviewed abc, now def`, severity: "warning" as const })) } as unknown as ItemView;
    const html = body(many);
    const t = html.slice(html.indexOf('data-testid="movement-jira-warnings-table-CAV-7346"'));
    assert.match(t, /<th[^>]*>Warning<\/th><th[^>]*>Where<\/th>/);
    assert.equal((t.slice(0, t.indexOf("</table>")).match(/<tr>/g) ?? []).length, 5, "five rows, then the toggle");
    assert.match(html, /Show all \(3 more\)/);
    assert.match(t, />New commits since the review on <a [^>]*>channelkart#0<\/a>: reviewed abc, now def<\/td><td[^>]*><a [^>]*>channelkart#0</);
    const held = body(union, detail());
    assert.match(held, />HELD in the DEMO movement<\/td><td[^>]*>CAV-7346 \(demo\)</);
  });
  it("the expansion header repeats the Dev / Test sign-off as chips with who (or 'missing')", () => {
    const html = body(union);
    const line = html.slice(html.indexOf('data-testid="movement-jira-signoffs-CAV-7346"'));
    assert.match(line, />Test-case sign-off</);
    assert.match(line.slice(0, line.indexOf("</p>")), /Dev ✓[\s\S]*Test –[\s\S]*Dev by dev@x\.com · Test missing/);
    assert.match(body(noComment).slice(body(noComment).indexOf('data-testid="movement-jira-signoffs-CAV-7280"')), /Dev missing · Test missing/);
  });
  it("while the detail loads there is a plain summary, not an empty table; 'feeds the checklist' is collapsed", () => {
    const html = body(union);
    assert.match(html, /Loading the review comment…/);
    assert.ok(!html.includes("movement-jira-comments-table-"));
    assert.match(tagOf(html, "movement-jira-feeds-toggle-CAV-7346"), /aria-expanded="false"/);
    assert.ok(!html.includes('data-testid="movement-jira-feeds-CAV-7346"'));
  });
});

const slot = (slot: "deployer" | "ba" | "lead", signed: boolean, email = `${slot}@x.com`) => ({ slot, email, name: slot, signedAt: signed ? "2026-11-19T05:00:00Z" : null, signed, signedCurrent: signed });
const view = (over: Partial<{ status: string; sign: string[]; mine: string[]; start: boolean; signed: boolean[]; environment: string; needsRefresh: boolean; items: Array<{ included: boolean }>; admin: boolean }> = {}): MovementView =>
  ({
    movement: { id: "m", deliveryId: "d", environment: over.environment ?? "prod", status: over.status ?? "ready", hash: checklist.hash, doneAt: null, doneByName: null, changedAfterStart: false },
    signers: [slot("deployer", over.signed?.[0] ?? false), slot("ba", over.signed?.[1] ?? false), slot("lead", over.signed?.[2] ?? false)],
    permissions: { edit: true, refresh: true, setSigners: true, cancel: true, override: false, revoke: false, start: over.start ?? false, done: false, confirm: false, sign: over.sign ?? [], changes: false },
    items: over.items ?? [{ included: true }],
    me: { email: "me@x.com", name: "Me", slots: over.mine ?? over.sign ?? [], isManager: true, isAdmin: over.admin ?? false },
    needsRefresh: over.needsRefresh ?? false,
    refreshError: null,
    refreshing: false,
    events: [{ type: "created", at: "2026-11-19T05:00:00Z", actorName: "Dev" }],
  }) as unknown as MovementView;

describe("SignoffBar", () => {
  const props = { busy: null, onSign: () => {}, onStart: () => {}, onOpenDone: () => {}, onOpenConfirm: () => {}, onCancel: noopErr, onChangeSigners: noopErr };
  it("shows Sign only on the viewer's own slot, enabled once the checklist on screen is the current one", () => {
    const html = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ sign: ["ba"] }), checklist }));
    assert.ok(html.includes('data-testid="movement-sign-ba"'));
    assert.ok(!html.includes('data-testid="movement-sign-lead"'));
    assert.ok(!html.includes('data-testid="movement-sign-deployer"'));
    assert.ok(!isDisabled(tagOf(html, "movement-sign-ba")), "Sign is enabled");
    const noCl = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ sign: ["ba"] }), checklist: null }));
    assert.ok(isDisabled(tagOf(noCl, "movement-sign-ba")));
    assert.match(noCl, /still loading/);
  });
  it("Start is disabled with the missing sign-offs as the reason until all three signed", () => {
    const html = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ signed: [true, false, false] }), checklist }));
    assert.match(html, /Waiting for sign-off from BA, Lead/);
    assert.match(html, /aria-label="Start deployment: Waiting for sign-off from BA, Lead"/, "the focusable wrapper names the action AND the reason");
    assert.ok(html.includes('data-testid="movement-start"'));
    const ok = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ status: "signed_off", start: true, signed: [true, true, true] }), checklist }));
    assert.ok(!isDisabled(tagOf(ok, "movement-start")), "Start is enabled once all three signed");
    assert.ok(isDisabled(tagOf(html, "movement-start")), "and disabled before");
  });
  it("Mark done replaces Start while in progress; Cancel is hidden once done", () => {
    const prog = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ status: "in_progress", signed: [true, true, true] }), checklist }));
    assert.ok(prog.includes('data-testid="movement-mark-done"'));
    assert.ok(!prog.includes('data-testid="movement-start"'));
    const done = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ status: "done", signed: [true, true, true] }), checklist }));
    assert.ok(!done.includes('data-testid="movement-cancel"'));
    assert.ok(done.includes('data-testid="movement-confirm-statuses"'));
  });
});

describe("SignoffBar: who is you", () => {
  const props = { busy: null, onSign: () => {}, onStart: () => {}, onOpenDone: () => {}, onOpenConfirm: () => {}, onCancel: noopErr, onChangeSigners: noopErr };
  it("marks the viewer's own slot 'You' (and 'Your turn') from `me`, and keeps 'You' after they signed", () => {
    const turn = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ sign: ["ba"] }), checklist }));
    assert.ok(turn.includes('data-testid="movement-signer-me-ba"'));
    assert.ok(!turn.includes('data-testid="movement-signer-me-lead"'));
    assert.match(turn, /Your turn/);
    const signed = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ sign: [], mine: ["ba"], signed: [false, true, false] }), checklist }));
    assert.ok(signed.includes('data-testid="movement-signer-me-ba"'), "the You marker stays after signing");
    assert.ok(!/Your turn/.test(signed));
    assert.ok(!signed.includes('data-testid="movement-sign-ba"'));
  });
  it("a holder is told why Sign is closed while the stored data must be re-read", () => {
    const html = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ sign: [], mine: ["ba"], needsRefresh: true }), checklist }));
    assert.ok(html.includes('data-testid="movement-sign-ba"'));
    assert.match(html, /must be re-read/);
  });
  it("a done demo / uat movement has no confirm step; a prod one does", () => {
    const uat = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ status: "done", environment: "uat", signed: [true, true, true] }), checklist }));
    assert.ok(!uat.includes('data-testid="movement-confirm-statuses"'));
    assert.ok(uat.includes('data-testid="movement-nonprod-bar-note"'));
    const prod = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ status: "done", environment: "prod", signed: [true, true, true] }), checklist }));
    assert.ok(prod.includes('data-testid="movement-confirm-statuses"'));
    assert.ok(!prod.includes('data-testid="movement-nonprod-bar-note"'));
  });
});

describe("a signer on the first (Jiras) tab", () => {
  const props = { busy: null, onSign: () => {}, onStart: () => {}, onOpenDone: () => {}, onOpenConfirm: () => {}, onCancel: noopErr, onChangeSigners: noopErr };
  it("wants the checklist without opening its tab, and once it is loaded Sign is enabled (not 'still loading')", () => {
    const v = view({ sign: ["ba"] });
    assert.equal(checklistWanted(false, v), true);
    const html = renderToStaticMarkup(h(SignoffBar, { ...props, view: v, checklist }));
    assert.ok(!isDisabled(tagOf(html, "movement-sign-ba")));
    assert.ok(!/still loading/.test(html));
    assert.ok(!isDisabled(tagOf(html, "movement-sign-compact-ba")), "the compact (phone) Sign is enabled too");
    // while it has not arrived yet the reason says so
    assert.match(renderToStaticMarkup(h(SignoffBar, { ...props, view: v, checklist: null })), /still loading/);
    assert.equal(checklistWanted(false, view({ sign: [] })), false);
  });
  it("under 640 px the signer cards fold into one summary row that keeps the viewer's Sign and an expander", () => {
    const html = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ sign: ["ba"], signed: [true, false, false] }), checklist }));
    assert.match(tagOf(html, "movement-signoff-summary"), /sm:hidden/);
    assert.match(html, /Sign-offs 1\/3/);
    assert.match(tagOf(html, "movement-signoff-expand"), /aria-expanded="false"/);
    assert.match(html, /id="movement-signers-detail"[^>]*class="[^"]*hidden sm:flex/, "the full cards are hidden under 640 px until expanded");
    assert.ok(!html.includes('data-testid="movement-sign-compact-lead"'), "only the viewer's own slot gets a compact Sign");
    assert.ok(html.includes('data-testid="movement-start"') && html.includes('data-testid="movement-cancel"'), "Start / Cancel stay reachable");
  });
});

describe("conflicts block", () => {
  // The real records carry no conflicts (the server side of that is changing), so the block is rendered from synthetic ones.
  const conflict = (kind: string, n: number) => ({ id: `s|k${n}|${kind}`, kind, section: "configs", title: `Title ${n}`, severity: "warn", itemKey: `k${n}`, variants: [{ text: "a", sources: [] }, { text: "b", sources: [] }] });
  const kinds = ["branch_mismatch", "config_default", "config_env_value", "downtime", "order_cycle", "prod_branch", "bundle_sdk", "deploy_branch", "some_new_kind"];
  const html = renderToStaticMarkup(h(MovementChecklist, { checklist: { ...checklist, conflicts: kinds.map((k, i) => conflict(k, i)) } as never, loading: false, error: null, onRetry: () => {}, exportBase: "" }));
  it("shows kinds as plain words, never the raw code as visible text", () => {
    assert.ok(html.includes('data-testid="movement-conflicts"'));
    for (const k of kinds) assert.ok(html.includes(`data-testid="movement-conflict-kind-${k}"`), k);
    assert.match(html, />Branch differs from the review comment</);
    assert.match(html, />Different values per environment</);
    assert.match(html, />Some new kind</);
    assert.ok(!new RegExp(`>(${kinds.join("|")})<`).test(html));
  });
});

describe("refresh notices", () => {
  const idle = { phase: "idle" as const, message: null, startedAt: null, auto: false };
  const noop2 = () => {};
  it("shows 'refresh running' for a refresh the server reports, without a local one", () => {
    const html = renderToStaticMarkup(h(RefreshNotice, { ui: idle, serverRunning: true, serverError: null, canRefresh: true, onRetry: noop2, onDismiss: noop2 }));
    assert.ok(html.includes('data-testid="movement-refresh-running"'));
    assert.match(html, /A refresh is running/);
  });
  it("an automatic refresh says the threshold from the constant (30 minutes), not a stale number", () => {
    const html = renderToStaticMarkup(h(RefreshNotice, { ui: { phase: "running", message: null, startedAt: 1, auto: true }, serverRunning: false, serverError: null, canRefresh: true, onRetry: () => {}, onDismiss: () => {} }));
    assert.match(html, /older than 30 minutes/);
    assert.ok(!/10 minutes/.test(html));
  });
  it("shows the server's refreshError as a red banner with Retry (or who to ask)", () => {
    const html = renderToStaticMarkup(h(RefreshNotice, { ui: idle, serverRunning: false, serverError: "Jira 503", canRefresh: true, onRetry: noop2, onDismiss: noop2 }));
    assert.ok(html.includes('data-testid="movement-refresh-error"'));
    assert.match(html, /Jira 503/);
    assert.ok(html.includes('data-testid="movement-refresh-retry"'));
    const viewer = renderToStaticMarkup(h(RefreshNotice, { ui: idle, serverRunning: false, serverError: "Jira 503", canRefresh: false, onRetry: noop2, onDismiss: noop2 }));
    assert.ok(!viewer.includes('data-testid="movement-refresh-retry"'));
    assert.match(viewer, /Ask a delivery manager/);
  });
  it("renders nothing when idle and healthy", () => {
    assert.equal(renderToStaticMarkup(h(RefreshNotice, { ui: idle, serverRunning: false, serverError: null, canRefresh: true, onRetry: noop2, onDismiss: noop2 })), "");
  });
  it("the needs-refresh banner names the problem and offers Refresh to managers only", () => {
    const html = renderToStaticMarkup(h(NeedsRefreshBanner, { canRefresh: true, running: false, onRefresh: noop2 }));
    assert.ok(html.includes('data-testid="movement-needs-refresh"'));
    assert.match(html, /stored data must be re-read before anyone can sign/);
    assert.ok(html.includes('data-testid="movement-needs-refresh-action"'));
    assert.ok(!renderToStaticMarkup(h(NeedsRefreshBanner, { canRefresh: false, running: false, onRefresh: noop2 })).includes('data-testid="movement-needs-refresh-action"'));
  });
});

describe("MovementEvents", () => {
  it("starts on a loading line (the first page is fetched), with no Load more yet", () => {
    const html = renderToStaticMarkup(h(MovementEvents, { eventsBase: "/api/x/events", refreshKey: "k", initial: view().events }));
    assert.match(html, /Loading the history/);
    assert.ok(!html.includes('data-testid="movement-history-more"'));
    assert.ok(!html.includes("Movement created"));
  });
});

describe("MovementChecklist while the stored data is unreadable", () => {
  it("says so instead of loading forever or offering a retry", () => {
    const html = renderToStaticMarkup(h(MovementChecklist, { checklist: null, loading: false, error: null, onRetry: () => {}, exportBase: "", needsRefresh: true }));
    assert.ok(html.includes('data-testid="movement-checklist-needs-refresh"'));
    assert.ok(!/Retry/.test(html));
  });
});

describe("held-only branch rows", () => {
  it("a pick used only by held Jiras gets the chip and the one-line explanation; a normal row gets nothing", () => {
    const flag = renderToStaticMarkup(h(HeldOnlyFlag, { repo: "channelkart", heldOnly: true }));
    assert.ok(flag.includes('data-testid="movement-branch-heldonly-channelkart"'));
    assert.match(flag, />only used by held Jiras</);
    const note = renderToStaticMarkup(h(HeldOnlyNote, { heldOnly: true }));
    assert.match(note, /Only used by held Jiras\. Not part of the checklist until one of those Jiras is ticked\./);
    assert.equal(renderToStaticMarkup(h(HeldOnlyFlag, { repo: "channelkart", heldOnly: false })), "");
    assert.equal(renderToStaticMarkup(h(HeldOnlyNote, { heldOnly: false })), "");
  });
});

describe("CompletionBanner", () => {
  const plan = (over: Partial<Parameters<typeof CompletionBanner>[0]["plan"]> = {}) => ({ state: "completed" as const, autoReturn: true, message: "Movement to Prod completed: 3 statuses updated", completion: { environment: "prod" as const, updated: 3, skipped: 0 }, skippedRows: [], ...over });
  it("a clean finish says 'Movement completed', offers Back and Stay here, and announces the return", () => {
    const html = renderToStaticMarkup(h(CompletionBanner, { plan: plan(), onBack: () => {} }));
    assert.match(tagOf(html, "movement-completed"), /data-state="completed"/);
    assert.match(html, />Movement completed</);
    assert.match(html, /3 statuses updated/);
    assert.ok(html.includes('data-testid="movement-completed-back"') && html.includes('data-testid="movement-completed-stay"'));
    assert.match(html, /Returning to the delivery in a moment/);
    assert.ok(!html.includes('data-testid="movement-completed-skipped"'));
  });
  it("a finish with skipped rows never says 'completed', lists each key with its reason (10 at most), keeps Confirm statuses, no auto return", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ key: `CAV-${i}`, reason: i === 0 ? "already delivered" : "gate" }));
    const html = renderToStaticMarkup(
      h(CompletionBanner, { plan: plan({ state: "attention", autoReturn: false, message: "0 statuses updated, 12 skipped. The skipped ones were left as they are; the reasons are listed below.", completion: { environment: "prod", updated: 0, skipped: 12 }, skippedRows: rows }), onBack: () => {}, onReconfirm: () => {} })
    );
    assert.match(tagOf(html, "movement-completed"), /data-state="attention"/);
    assert.match(html, />Movement done, needs your attention</);
    assert.ok(!/Movement completed|completed:/.test(html), "no contradictory 'completed' wording");
    assert.match(html, /<span class="font-semibold">CAV-0<\/span>: already delivered/);
    assert.equal((html.match(/<li class="\[overflow-wrap:anywhere\]">/g) ?? []).length, 10);
    assert.match(html, /and 2 more/);
    assert.ok(html.includes('data-testid="movement-completed-reconfirm"'));
    assert.ok(!html.includes('data-testid="movement-completed-stay"'));
    assert.ok(!/Returning to the delivery/.test(html));
    assert.ok(html.includes('data-testid="movement-completed-back"'));
  });
  it("a failed confirm: attention with no list; Confirm again only when the page offers it", () => {
    const html = renderToStaticMarkup(h(CompletionBanner, { plan: plan({ state: "attention", autoReturn: false, message: "could not be confirmed", completion: null }), onBack: () => {} }));
    assert.ok(!html.includes('data-testid="movement-completed-skipped"'));
    assert.ok(!html.includes('data-testid="movement-completed-reconfirm"'));
  });
});

describe("create dialog footer", () => {
  const footer = (busy: boolean, opening: boolean) => renderToStaticMarkup(h(CreateFooter, { ui: createDialogUi(busy, opening), busy, disabled: busy, retry: false, onClose: () => {}, onSubmit: () => {} }));
  it("while the create request runs it cannot be cancelled", () => {
    const html = footer(true, false);
    assert.ok(isDisabled(tagOf(html, "movement-create-cancel")));
    assert.match(html, />Working…</);
  });
  it("once the movement exists and the page is opening there is a way out: an enabled Close", () => {
    const html = footer(true, true);
    assert.ok(!isDisabled(tagOf(html, "movement-create-cancel")), "Close is enabled");
    assert.match(html, />Close</);
    assert.ok(!/>Cancel</.test(html));
  });
  it("idle: Cancel enabled", () => {
    assert.ok(!isDisabled(tagOf(footer(false, false), "movement-create-cancel")));
  });
});

describe("Branches table", () => {
  it("Repo | Review says | Your pick | Status, with the review comment's hint, the pick and the status chips in their cells", () => {
    const html = renderToStaticMarkup(
      h(BranchTable, null, h(BranchRow, { repo: "channelkart", fullName: "salescode-ai/channelkart", heldOnly: false, hint: "release/2.1", pick: "main", status: h("span", null, "differs") }), h(BranchRow, { repo: "lite", fullName: null, heldOnly: true, hint: null, pick: "-", status: null }))
    );
    assert.match(tagOf(html, "movement-branch-table"), /role="table"/);
    for (const col of ["Repo", "Review says", "Your pick", "Status"]) assert.match(html, new RegExp(`role="columnheader">${col}<`));
    assert.match(tagOf(html, "movement-branch-row-channelkart"), /role="row"/);
    assert.match(html.slice(html.indexOf('data-testid="movement-branch-hint-channelkart"')), /^[^>]*>(?:<span[^>]*>Review says: <\/span>)?release\/2\.1</);
    assert.ok(!html.includes('data-testid="movement-branch-hint-lite"'), "no hint, no hint element (just a dash)");
    assert.match(html, /Only used by held Jiras\./);
  });
});

describe("nothing selected: the hint, and the reasons printed as text", () => {
  const none = items.map((i) => ({ ...i, included: false })) as unknown as ItemView[];
  const jiras = (its: ItemView[], status = "ready") =>
    renderToStaticMarkup(h(MovementJiras, { status, items: its, checklist: null, base: "/api/x", refreshKey: "k", hasHash: true, edit: allowed, override: denied, revoke: denied, jiraBaseUrl: null, onTick: noop, onOverride: noopErr }));
  const props = { busy: null, onSign: () => {}, onStart: () => {}, onOpenDone: () => {}, onOpenConfirm: () => {}, onCancel: noopErr, onChangeSigners: noopErr };

  it("with no Jira ticked a one-line hint sits above the table; with one ticked, or a finished movement, it does not", () => {
    const html = jiras(none);
    assert.match(html, /data-testid="movement-nothing-selected"[^>]*>No Jira is selected yet\. Tick the ready Jiras that should move; signing starts once at least one is selected\.</);
    assert.ok(html.indexOf('data-testid="movement-nothing-selected"') < html.indexOf('data-testid="movement-jira-table"'));
    assert.ok(!jiras(items).includes("movement-nothing-selected"));
    assert.ok(!jiras(none, "done").includes("movement-nothing-selected"), "a done movement's selection is history");
  });
  it("the disabled Sign shows WHY as text under it (nothing ticked), on the card and in the phone summary", () => {
    const v = view({ sign: [], mine: ["ba"], items: [{ included: false }] });
    const html = renderToStaticMarkup(h(SignoffBar, { ...props, view: v, checklist: null }));
    assert.ok(isDisabled(tagOf(html, "movement-sign-ba")));
    assert.match(html, /data-testid="movement-sign-reason-ba"[^>]*>Tick at least one ready Jira before signing</);
    assert.match(html, /data-testid="movement-sign-reason-compact"[^>]*>Tick at least one ready Jira before signing</);
    // an enabled Sign has no reason line
    assert.ok(!renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ sign: ["ba"] }), checklist })).includes("movement-sign-reason-"));
  });
  it("stale data and a failed refresh keep their own reasons; Start says who or what it waits for, to the deployer", () => {
    const stale = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ sign: [], mine: ["ba"], needsRefresh: true }), checklist: null }));
    assert.match(stale, /data-testid="movement-sign-reason-ba"[^>]*>The stored Jira data must be re-read/);
    const dep = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ sign: [], mine: ["deployer"], signed: [true, false, false] }), checklist }));
    assert.match(dep, /data-testid="movement-action-reason-start"[^>]*>Waiting for sign-off from BA, Lead</);
    const other = renderToStaticMarkup(h(SignoffBar, { ...props, view: view({ sign: [], mine: ["ba"], signed: [false, false, false] }), checklist }));
    assert.ok(!other.includes("movement-action-reason-"), "not the viewer's button: the tooltip is enough");
  });
});

describe("Copy in the header", () => {
  it("is enabled with NO checklist loaded (it is fetched on click)", () => {
    const hv = { movement: { id: "m", deliveryId: "d", environment: "prod", status: "ready", refreshedAt: null }, delivery: { id: "d", name: "Release", date: "2026-11-20" }, permissions: { refresh: true, notes: [] }, signers: [], items: [], me: { email: "e", name: null, slots: [], isManager: true, isAdmin: false }, needsRefresh: false, refreshError: null, refreshing: false, serverNow: "2026-11-20T00:00:00Z", prData: { asOf: null }, checklist: { summary: "", stats: { conflicts: 0, needsAttention: 0, unknowns: 0, items: 0 }, conflicts: [] } } as unknown as MovementView;
    const html = renderToStaticMarkup(h(MovementHeader, { view: hv, onCopyAll: async () => "", jiraBaseUrl: null, refreshUi: { phase: "idle", message: null, startedAt: null, auto: false }, refreshing: false, receivedAt: null, onRefresh: () => {}, exportBase: "/api/x/export" }));
    assert.ok(!isDisabled(tagOf(html, "movement-copy-all-header")));
    assert.match(tagOf(html, "movement-copy-all-header"), /aria-haspopup="menu"/);
    assert.match(html.slice(html.indexOf('data-testid="movement-copy-all-header"')), /Copy<svg/);
  });
});

describe("Copy menu", () => {
  const jiras = [
    { key: "CAV-7346", summary: "Partner banner", readiness: "ready" as const, included: true },
    { key: "CAV-7304", summary: "Account lock", readiness: "blocked" as const, included: false },
    { key: "CAV-7347", summary: "Report", readiness: "ready" as const, included: false },
  ];
  const menu = (its: typeof jiras, open: boolean) => renderToStaticMarkup(h(CopyMenu, { environment: "prod", deliveryName: "Release", items: its, jiraBaseUrl: null, onCopyChecklist: async () => "", onCopySummary: async () => "", triggerTestId: "movement-copy-all-header", initialOpen: open }));
  it("there is ONE Copy control: the Jiras tab has no copy trigger of its own", () => {
    const html = renderToStaticMarkup(h(MovementJiras, { status: "ready", items, checklist: null, base: "/api/x", refreshKey: "k", hasHash: true, edit: allowed, override: denied, revoke: denied, jiraBaseUrl: null, onTick: noop, onOverride: noopErr }));
    assert.ok(!html.includes("movement-copy-jiras-toolbar") && !html.includes("movement-copy-menu"));
    assert.ok(!/>Copy</.test(html.replace(/<[^>]*>/g, "><")), "no Copy button in the Jiras toolbar");
  });
  it("is a menu button, closed by default, with no checklist request needed to render it", () => {
    const html = menu(jiras, false);
    assert.match(tagOf(html, "movement-copy-all-header"), /aria-haspopup="menu"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*aria-haspopup="menu"/);
    assert.ok(!html.includes('data-testid="movement-copy-menu"'));
    assert.ok(!isDisabled(tagOf(html, "movement-copy-all-header")));
  });
  it("open: Copy checklist first, then Copy summary, then Jiras (selected, n) and Jiras (all, m), all usable", () => {
    const html = menu(jiras, true);
    assert.match(tagOf(html, "movement-copy-menu"), /role="menu"/);
    const order = ["movement-copy-checklist", "movement-copy-summary", "movement-copy-jiras-selected", "movement-copy-jiras-all"].map((id) => html.indexOf(`data-testid="${id}"`));
    assert.ok(order.every((n) => n > 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3]);
    assert.match(html, />Copy checklist</);
    assert.match(html, />Copy summary</);
    assert.match(tagOf(html, "movement-copy-summary"), /role="menuitem"/);
    assert.match(html, />Copy Jiras \(selected, 1\)</);
    assert.match(html, />Copy Jiras \(all, 3\)</);
    for (const id of ["movement-copy-checklist", "movement-copy-summary", "movement-copy-jiras-selected", "movement-copy-jiras-all"]) assert.match(tagOf(html, id), /role="menuitem"/);
    assert.ok(!/aria-disabled/.test(html));
  });
  it("nothing selected: the item says so and is disabled with the reason; 'all' still works", () => {
    const html = menu(jiras.map((j) => ({ ...j, included: false })), true);
    assert.match(html, />No Jiras selected</);
    assert.match(tagOf(html, "movement-copy-jiras-selected"), /aria-disabled="true"/);
    assert.match(tagOf(html, "movement-copy-jiras-selected"), /title="Tick at least one Jira to copy the selected ones"/);
    assert.ok(!/aria-disabled/.test(tagOf(html, "movement-copy-jiras-all")));
  });
  it("an empty movement disables both Jira items (the model, with its reasons)", () => {
    const m = copyMenuModel([]);
    assert.deepEqual(m.map((x) => [x.id, x.disabled]), [["checklist", false], ["summary", false], ["selected", true], ["all", true]]);
    assert.equal(m[2].label, "No Jiras selected");
    assert.equal(m[2].reason, "This movement has no Jiras");
  });
  it("without a summary callback the menu has no Copy summary entry", () => {
    const html = renderToStaticMarkup(h(CopyMenu, { environment: "prod", deliveryName: "Release", items: jiras, jiraBaseUrl: null, onCopyChecklist: async () => "", triggerTestId: "t", initialOpen: true }));
    assert.ok(!html.includes("movement-copy-summary"));
  });
});

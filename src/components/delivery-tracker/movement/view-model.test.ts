import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { BRANCH_RE } from "@/lib/movement/service/service";
import { buildChecklist } from "@/lib/movement/checklist/build";
import { realJiras } from "@/lib/movement/checklist/testkit";
import type { Checklist } from "@/lib/movement/checklist/types";
import {
  actionState,
  approvalsBlockedReason,
  copyAllEnabled,
  nothingSelected,
  NOTHING_SELECTED_REASON,
  pendingActionReason,
  changesBannerVisible,
  changesKey,
  HELD_ONLY_NOTE,
  isHeldOnly,
  notSelectedCount,
  notSelectedNote,
  signerSearchPhase,
  autoRefreshReason,
  cancelBody,
  conflictKindCounts,
  conflictLabel,
  loadErrorActions,
  openerTestIds,
  AUTO_REFRESH_AFTER_MS,
  DONE_BODY_BUDGET_BYTES,
  fitDonePayload,
  mergeFirstPage,
  SESSION_EXPIRED,
  signerConflicts,
  BRANCH_NAME_RE,
  BRANCH_QUERY_RE,
  branchHints,
  branchPayload,
  branchesDirty,
  buildDonePayload,
  confirmSummary,
  conflictsText,
  countItems,
  countsLine,
  describeApiError,
  describeCreateError,
  diffSummary,
  doneCounts,
  doneRows,
  envCells,
  envChips,
  eventDetail,
  eventLabel,
  filterItems,
  formatAge,
  formatIst,
  groupCounts,
  hasStatusStep,
  initialShown,
  isStaleHash,
  isValidBranchName,
  isValidBranchQuery,
  itemTone,
  mergeEvents,
  needsAutoRefresh,
  NEEDS_REFRESH_REASON,
  nextShown,
  nonProdDoneHint,
  notesHidden,
  parseCompletionParams,
  parseDeliveryLink,
  legacyMovementRedirect,
  movementPagePath,
  deliveryBackPath,
  completedBackPath,
  completionToastText,
  completionPlan,
  AUTO_RETURN_MS,
  arrivalStep,
  initialItemsPerSection,
  parseOpenPref,
  CHECKLIST_ROW_BUDGET,
  rowStatus,
  ROW_STATUS,
  signoffMark,
  TICK_RESETS_SIGNOFFS,
  confirmHeading,
  createDialogUi,
  createReleaseReason,
  nowStatusAfter,
  OPENING_TIMEOUT_MS,
  listIsStale,
  showDeliveryBannerOn,
  skippedPreview,
  prDetailChips,
  proposalSkip,
  proposedStatusFor,
  readinessGroup,
  recordsLabel,
  reviewSummary,
  refreshNeededCode,
  refreshNeededMessage,
  sectionStats,
  sectionText,
  serverNowAt,
  shouldFetchChanges,
  showChangesBanner,
  signerRows,
  signoffChips,
  slotFromError,
  sourceChips,
  startAction,
  statusLabel,
  tickOrigin,
  tickState,
  withoutCompletionParams,
  unknownsText,
  visibleSectionItems,
  wholeText,
} from "./view-model";

const cl = (env: "demo" | "uat" | "prod" = "prod", branches: Array<{ repo: string; branch: string }> = []): Checklist => buildChecklist({ environment: env, jiras: realJiras(), branches });

const perms = (o: Partial<Record<string, unknown>> = {}) =>
  ({ edit: false, refresh: false, setSigners: false, cancel: false, override: false, revoke: false, start: false, done: false, confirm: false, sign: [] as string[], ...o }) as never;
const me = (o: Partial<{ email: string; name: string | null; slots: string[]; isManager: boolean; isAdmin: boolean }> = {}) => ({ email: "me@x.com", name: "Me", slots: [] as string[], isManager: false, isAdmin: false, ...o }) as never;
const signers = (signed: boolean[]) =>
  (["deployer", "ba", "lead"] as const).map((slot, i) => ({ slot, email: `${slot}@x.com`, name: slot, signedAt: signed[i] ? "2026-11-19T05:00:00Z" : null, signed: signed[i], signedCurrent: signed[i] }));

describe("labels", () => {
  it("labels statuses and falls back to humanized text", () => {
    assert.equal(statusLabel("signed_off"), "Signed off");
    assert.equal(statusLabel("in_progress"), "In progress");
    assert.equal(statusLabel("something_new"), "Something new");
    assert.equal(eventLabel("items_ticked"), "Jiras ticked");
    assert.equal(eventLabel("brand_new_event"), "Brand new event");
  });
  it("formats IST like the rest of the app", () => {
    assert.match(formatIst("2026-11-19T06:00:00Z"), /19 Nov/);
    assert.match(formatIst("2026-11-19T06:00:00Z"), /11:30/); // 06:00 UTC = 11:30 IST
    assert.equal(formatIst(null), "never");
    assert.equal(formatIst("garbage"), "-");
  });
  it("formats ages", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    assert.equal(formatAge("2026-11-19T11:59:40Z", now), "just now");
    assert.equal(formatAge("2026-11-19T11:55:00Z", now), "5 min ago");
    assert.equal(formatAge("2026-11-19T09:00:00Z", now), "3 h ago");
    assert.equal(formatAge("2026-11-16T12:00:00Z", now), "3 d ago");
    assert.equal(formatAge(null, now), "never");
  });
});

describe("server clock (ages never use the browser clock)", () => {
  it("serverNowAt = serverNow + the time since the view arrived, whatever the browser clock says", () => {
    const serverNow = "2026-11-19T12:00:00Z";
    // A browser whose clock is years off: only the ELAPSED time (received -> now) is used.
    const received = Date.parse("2031-01-01T00:00:00Z");
    const now = serverNowAt(serverNow, received, received + 3 * 60_000);
    assert.equal(new Date(now).toISOString(), "2026-11-19T12:03:00.000Z");
    assert.equal(formatAge("2026-11-19T11:55:00Z", now), "8 min ago");
  });
  it("falls back to the browser clock without a usable serverNow, and never runs backwards", () => {
    assert.equal(serverNowAt(undefined, 5, 1_000), 1_000);
    assert.equal(serverNowAt("garbage", 5, 1_000), 1_000);
    assert.equal(serverNowAt("2026-11-19T12:00:00Z", null, 1_000), 1_000);
    const t = Date.parse("2026-11-19T12:00:00Z");
    assert.equal(serverNowAt("2026-11-19T12:00:00Z", 2_000, 1_000), t, "a browser clock that went back adds nothing");
  });
});

describe("auto refresh", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  it("refreshes when older than 30 minutes or never refreshed, only if allowed", () => {
    assert.equal(needsAutoRefresh("2026-11-19T11:29:00Z", now, true), true);
    assert.equal(needsAutoRefresh("2026-11-19T11:31:00Z", now, true), false);
    assert.equal(needsAutoRefresh(null, now, true), true);
    assert.equal(needsAutoRefresh("2026-11-19T10:00:00Z", now, false), false);
    assert.equal(needsAutoRefresh("not a date", now, true), true);
  });
});

describe("environment chips", () => {
  it("shows none when there is no movement", () => {
    const chips = envChips(null);
    assert.deepEqual(chips.map((c) => [c.env, c.status, c.canStart]), [["demo", null, true], ["uat", null, true], ["prod", null, true]]);
  });
  it("shows the live movement per environment and lets a cancelled one be replaced", () => {
    const chips = envChips([
      { id: "a", environment: "uat", status: "cancelled" },
      { id: "b", environment: "uat", status: "ready" },
      { id: "c", environment: "demo", status: "cancelled" },
      { id: "d", environment: "prod", status: "done" },
    ]);
    const by = Object.fromEntries(chips.map((c) => [c.env, c]));
    assert.equal(by.uat.status, "ready");
    assert.equal(by.uat.movementId, "b");
    assert.equal(by.uat.canStart, false);
    assert.equal(by.demo.status, "cancelled");
    assert.equal(by.demo.canStart, true);
    assert.equal(by.prod.status, "done");
    assert.equal(by.prod.canStart, false); // a done movement still holds the environment
  });
  it("gates the start action on the manager flag and an existing live movement", () => {
    const [demo, uat] = envChips([{ id: "b", environment: "uat", status: "ready" }]);
    assert.equal(startAction(demo, false).enabled, false);
    assert.match(startAction(demo, false).reason ?? "", /managers/);
    assert.equal(startAction(demo, true).enabled, true);
    const s = startAction(uat, true);
    assert.equal(s.enabled, false);
    assert.match(s.reason ?? "", /already a ready UAT movement/);
  });
  it("a completed (or deleted) delivery cannot start a movement, even for a manager", () => {
    const [demo] = envChips([]);
    const s = startAction(demo, true, true);
    assert.equal(s.enabled, false);
    assert.match(s.reason ?? "", /completed delivery/);
    assert.equal(startAction(demo, true, false).enabled, true);
  });
});

describe("actions the user may take (from the API permissions)", () => {
  const view = (status: string, p: Record<string, unknown>, o: { me?: Parameters<typeof me>[0]; needsRefresh?: boolean; refreshError?: string | null; signed?: boolean[] } = {}) => ({
    movement: { status } as never,
    permissions: perms(p),
    signers: signers(o.signed ?? [false, false, false]),
    me: me(o.me),
    needsRefresh: o.needsRefresh ?? false,
    refreshError: o.refreshError ?? null,
  });
  it("allowed follows the server permission", () => {
    assert.deepEqual(actionState("edit", view("ready", { edit: true })), { allowed: true, reason: null });
  });
  it("explains a status refusal", () => {
    const r = actionState("edit", view("in_progress", {}));
    assert.equal(r.allowed, false);
    assert.match(r.reason ?? "", /in progress/);
  });
  it("explains a role refusal from `me`", () => {
    assert.match(actionState("override", view("ready", {})).reason ?? "", /admin/);
    assert.match(actionState("start", view("signed_off", {})).reason ?? "", /deployer/);
    assert.match(actionState("cancel", view("ready", {})).reason ?? "", /managers/);
    // a manager who is not an admin still cannot override
    assert.match(actionState("override", view("ready", {}, { me: { isManager: true } })).reason ?? "", /admin/);
  });
  it("start before everyone signed names who is missing", () => {
    const r = actionState("start", view("ready", {}, { signed: [true, false, false] }));
    assert.match(r.reason ?? "", /BA, Lead/);
  });
  it("a manager refused only because the stored data is unreadable is told to refresh (not 'only managers')", () => {
    const r = actionState("edit", view("ready", {}, { me: { isManager: true }, needsRefresh: true }));
    assert.equal(r.allowed, false);
    assert.equal(r.reason, NEEDS_REFRESH_REASON);
    // a non-manager still gets the role reason: the stale data is not their business
    assert.match(actionState("edit", view("ready", {}, { needsRefresh: true })).reason ?? "", /managers/);
  });
  it("the deployer (or an admin) cannot start on a failed refresh: the reason carries the failure", () => {
    const r = actionState("start", view("signed_off", {}, { me: { slots: ["deployer"] }, refreshError: "Jira timed out" }));
    assert.match(r.reason ?? "", /last refresh failed \(Jira timed out\)/);
    assert.match(actionState("start", view("signed_off", {}, { me: { isAdmin: true }, refreshError: "x" })).reason ?? "", /refresh failed/);
    assert.match(actionState("done", view("in_progress", {}, { me: { slots: ["deployer"] }, needsRefresh: true })).reason ?? "", /re-read/);
  });
  it("approvalsBlockedReason: unreadable data first, then a failed refresh, else nothing", () => {
    assert.equal(approvalsBlockedReason({ needsRefresh: true, refreshError: "x" }), NEEDS_REFRESH_REASON);
    assert.match(approvalsBlockedReason({ needsRefresh: false, refreshError: "boom" }) ?? "", /boom/);
    assert.equal(approvalsBlockedReason({ needsRefresh: false, refreshError: null }), null);
  });
});

describe("signer rows", () => {
  /** `mine` = the slots `me` holds; `sign` = what the server lists as signable now (permissions.sign). */
  const view = (status: string, mine: string[], signed: boolean[], hash = "h1", sign: string[] = mine, o: { needsRefresh?: boolean; refreshError?: string | null } = {}) => ({
    movement: { status, hash } as never,
    signers: signers(signed),
    permissions: perms({ sign }),
    me: me({ slots: mine }),
    needsRefresh: o.needsRefresh ?? false,
    refreshError: o.refreshError ?? null,
  });
  it("marks signed / your turn / waiting and enables only the viewer's own slot", () => {
    const rows = signerRows(view("ready", ["ba"], [true, false, false]), "h1");
    assert.deepEqual(rows.map((r) => [r.slot, r.state, r.canSign, r.isMe]), [["deployer", "signed", false, false], ["ba", "you", true, true], ["lead", "waiting", false, false]]);
    assert.match(rows[2].signReason ?? "", /Only lead@x.com can sign as Lead/);
    assert.match(rows[0].signReason ?? "", /Already signed/);
  });
  it("'You' stays after the viewer signed, and 'Your turn' needs `me`, not permissions.sign", () => {
    const after = signerRows(view("ready", ["ba"], [false, true, false], "h1", []), "h1");
    assert.deepEqual([after[1].state, after[1].isMe, after[1].canSign], ["signed", true, false]);
    // permissions.sign lists a slot but `me` does not hold it (inconsistent input): nobody is "you", nothing is signable
    const heuristic = signerRows(view("ready", [], [false, false, false], "h1", ["ba"]), "h1");
    assert.ok(heuristic.every((r) => r.state === "waiting" && !r.isMe && !r.canSign));
  });
  it("a holder whose Sign is closed by stale data / a failed refresh is still 'your turn', with the reason", () => {
    const stale = signerRows(view("ready", ["ba"], [false, false, false], "h1", [], { needsRefresh: true }), "h1");
    assert.deepEqual([stale[1].state, stale[1].canSign, stale[1].signReason], ["you", false, NEEDS_REFRESH_REASON]);
    const failed = signerRows(view("ready", ["ba"], [false, false, false], "h1", [], { refreshError: "boom" }), "h1");
    assert.match(failed[1].signReason ?? "", /boom/);
  });
  it("does not enable Sign until the checklist the user sees is the current one", () => {
    const rows = signerRows(view("ready", ["ba"], [false, false, false], "h2"), "h1");
    assert.equal(rows[1].canSign, false);
    assert.match(rows[1].signReason ?? "", /still loading/);
    assert.equal(signerRows(view("ready", ["ba"], [false, false, false], "h2"), null)[1].canSign, false);
  });
  it("no sign-offs outside ready / signed_off", () => {
    const rows = signerRows(view("in_progress", [], [true, true, true]), "h1");
    assert.ok(rows.every((r) => !r.canSign));
    const d = signerRows(view("draft", [], [false, false, false]), "h1");
    assert.match(d[0].signReason ?? "", /not open while the movement is draft/);
    assert.equal(signerRows(view("draft", ["ba"], [false, false, false]), "h1")[1].state, "waiting", "no 'your turn' while sign-offs are closed");
  });
  it("a sign-off on an older checklist reads as stale for others, and as your turn for its holder", () => {
    const sg = signers([true, false, false]);
    sg[0] = { ...sg[0], signedCurrent: false };
    const v = { movement: { status: "ready", hash: "h1" } as never, signers: sg, permissions: perms(), me: me(), needsRefresh: false, refreshError: null };
    assert.equal(signerRows(v, "h1")[0].state, "stale");
    assert.equal(signerRows({ ...v, me: me({ slots: ["deployer"] }), permissions: perms({ sign: ["deployer"] }) }, "h1")[0].state, "you");
  });
});

describe("readiness grouping and counts (from the server's blockers / softWarnings)", () => {
  const note = (code: string, severity: "blocker" | "warning") => ({ code, message: "m", severity });
  const it4 = (key: string, summary: string, included: boolean, readiness: "ready" | "blocked" | "override", o: Record<string, unknown> = {}) => ({ key, summary, included, readiness, blockers: [] as ReturnType<typeof note>[], softWarnings: [] as ReturnType<typeof note>[], ...o });
  const items = [
    it4("CAV-1", "Alpha", true, "ready"),
    it4("CAV-2", "Beta thing", false, "ready", { softWarnings: [note("stale_record", "warning")] }),
    it4("CAV-3", "Gamma", false, "blocked", { blockers: [note("pr_no_record", "blocker")] }),
    it4("CAV-4", "Delta", true, "override", { blockers: [note("pr_no_record", "blocker")] }),
  ];
  it("counts ready / blocked / overridden / unticked", () => {
    const c = countItems(items);
    assert.deepEqual(c, { total: 4, ready: 2, blocked: 1, overridden: 1, included: 2, unticked: 1 });
    assert.equal(countsLine(c), "2 ready, 1 blocked, 1 overridden, 1 unticked");
    assert.equal(countsLine(countItems([])), "no Jiras");
    assert.equal(countsLine({ ...c, overridden: 0 }), "2 ready, 1 blocked, 1 unticked");
  });
  it("groups by readiness and soft warnings, with no hard-coded code list", () => {
    assert.deepEqual(items.map((i) => readinessGroup(i)), ["clean", "warnings", "blocked", "overridden"]);
    assert.deepEqual(groupCounts(items), { blocked: 1, overridden: 1, warnings: 1, clean: 1 });
    // a code this UI has never heard of is a blocker or a warning purely by what the server put it under
    assert.equal(readinessGroup(it4("X", "x", true, "ready", { softWarnings: [note("brand_new_code", "warning")] })), "warnings");
    assert.equal(readinessGroup(it4("X", "x", false, "blocked", { blockers: [note("brand_new_code", "blocker")] })), "blocked");
  });
  it("filters by state and text", () => {
    assert.deepEqual(filterItems(items, "blocked", "").map((i) => i.key), ["CAV-3"]);
    assert.deepEqual(filterItems(items, "unticked", "").map((i) => i.key), ["CAV-2"]);
    assert.deepEqual(filterItems(items, "ready", "").map((i) => i.key), ["CAV-1", "CAV-2"], "ready = ready only; overridden has its own filter");
    assert.deepEqual(filterItems(items, "overridden", "").map((i) => i.key), ["CAV-4"]);
    assert.deepEqual(filterItems(items, "warnings", "").map((i) => i.key), ["CAV-2"]);
    assert.deepEqual(filterItems(items, "all", "beta").map((i) => i.key), ["CAV-2"]);
    assert.deepEqual(filterItems(items, "all", " cav-4 ").map((i) => i.key), ["CAV-4"]);
  });
  it("tick state: a blocked Jira is disabled with the override hint, others follow the edit permission", () => {
    const b = tickState({ included: false, readiness: "blocked" }, true, null);
    assert.equal(b.disabled, true);
    assert.match(b.reason ?? "", /override/);
    assert.ok(!/kept/.test(b.reason ?? ""));
    assert.match(tickState({ included: false, readiness: "blocked", ticked: true }, true, null).reason ?? "", /tick is kept/);
    assert.equal(tickState({ included: true, readiness: "ready" }, true, null).disabled, false);
    const ro = tickState({ included: true, readiness: "ready" }, false, "Only delivery managers can do this");
    assert.deepEqual([ro.disabled, ro.checked, ro.reason], [true, true, "Only delivery managers can do this"]);
  });
  it("stored tick (ticked / tickSet) vs the effective tick (included)", () => {
    assert.equal(tickOrigin({ ticked: true, tickSet: false }), "auto");
    assert.equal(tickOrigin({ ticked: true, tickSet: true }), "chosen");
    assert.equal(tickOrigin({ ticked: false, tickSet: true }), "chosen");
    assert.equal(tickOrigin({ ticked: false, tickSet: false }), null);
    // ticked but blocked: shown unticked (effective), with the reason
    assert.equal(tickState({ included: false, readiness: "blocked", ticked: true }, true, null).checked, false);
  });
  it("dev / tester chips come from the item's own signoffs and exist for every Jira", () => {
    const c = signoffChips({ dev: { by: "d@x.com", at: "2026-11-19T06:00:00Z" }, tester: null });
    assert.deepEqual(c.map((x) => [x.label, x.tone]), [["Dev: signed", "ok"], ["Tester: missing", "warn"]]);
    assert.match(c[0].title, /d@x.com/);
    assert.deepEqual(signoffChips({ dev: null, tester: null }).map((x) => x.label), ["Dev: missing", "Tester: missing"]);
  });
  it("record count, the 5-pointer cap ('N more'), and repo chips", () => {
    assert.equal(recordsLabel(1), "1 review comment");
    assert.equal(recordsLabel(7), "7 review comments");
    assert.equal(reviewSummary({ reviews: 1, prs: { covered: 2 } }), "1 review comment · 2 PRs");
    assert.equal(reviewSummary({ reviews: 2, prs: { covered: 1 } }), "2 review comments · 1 PR");
    assert.equal(reviewSummary({ reviews: 1, prs: { covered: 0 } }), "1 review comment");
    assert.equal(notesHidden({ warningsMore: 4 }), 4);
    assert.equal(notesHidden({ warningsMore: -1 }), 0);
  });
  it("per-PR detail chips: status, stale head, unknowns, parser notes", () => {
    const pr = { status: "PARTIAL", stale: true, unknowns: 2, parseNotes: 1, headReviewed: "f249c2be9c1234", headMovedTo: "e2ad816ab0aaaa" };
    const chips = prDetailChips(pr as never);
    assert.deepEqual(chips.map((c) => c.label), ["PARTIAL", "stale", "2 unknowns", "1 note"]);
    assert.match(chips[1].title, /f249c2be9c/);
    assert.match(chips[1].title, /e2ad816ab0/);
    assert.deepEqual(prDetailChips({ status: "READY", stale: false, unknowns: 0, parseNotes: 0, headReviewed: null, headMovedTo: null }).map((c) => [c.label, c.tone]), [["READY", "ok"]]);
  });
});

describe("incremental rendering", () => {
  it("shows the first chunk and grows by one chunk, never past the total", () => {
    assert.equal(initialShown(300), 50);
    assert.equal(initialShown(7), 7);
    assert.equal(nextShown(50, 300), 100);
    assert.equal(nextShown(280, 300), 300);
    assert.equal(nextShown(300, 300), 300);
    assert.equal(nextShown(0, 0), 0);
    const seen: number[] = [];
    for (let n = initialShown(300); ; n = nextShown(n, 300)) {
      seen.push(n);
      if (n === 300) break;
    }
    assert.deepEqual(seen, [50, 100, 150, 200, 250, 300]);
  });
});

describe("merged checklist view helpers (real records)", () => {
  const prod = cl("prod");
  it("section stats count severities, conflicts and attention", () => {
    const configs = prod.sections.find((s) => s.id === "configs")!;
    const st = sectionStats(configs);
    assert.equal(st.count, configs.items.length);
    assert.equal(st.attention, configs.items.filter((i) => i.needsAttention).length);
    assert.ok(st.flagged <= st.count);
    assert.equal(sectionStats({ items: [] }).count, 0);
  });
  it("a needs-attention item is red, a conflict or warning is amber", () => {
    assert.equal(itemTone({ needsAttention: true }), "danger");
    assert.equal(itemTone({ severity: "blocker" }), "danger");
    assert.equal(itemTone({ severity: "warn" }), "warn");
    assert.equal(itemTone({ conflict: { kind: "prod_branch", variants: [] } }), "warn");
    assert.equal(itemTone({}), "plain");
  });
  it("env cells flag the target environment; an unknown target value needs attention", () => {
    const cells = envCells({ env: { target: "prod", targetValue: null, values: { demo: "on", uat: null, prod: null } } });
    assert.deepEqual(cells.map((c) => [c.env, c.isTarget, c.attention]), [["demo", false, false], ["uat", false, false], ["prod", true, true]]);
    assert.deepEqual(envCells({}), []);
    const real = prod.sections.find((s) => s.id === "configs")!.items.find((i) => i.env);
    assert.ok(real);
    assert.equal(envCells(real).filter((c) => c.isTarget).length, 1);
  });
  it("source chips are distinct, capped, and count the rest", () => {
    const src = [
      { jira: "A-1", pr: "r#1" },
      { jira: "A-1", pr: "r#1", section: 4 },
      { jira: "A-1", pr: "r#2" },
      { jira: "B-2", pr: "r#3" },
    ];
    const r = sourceChips(src, 2, 5);
    assert.deepEqual(r.chips.map((c) => c.label), ["A-1 · r#1", "A-1 · r#2"]);
    assert.equal(r.more, 1 + 5);
  });
  it("section text comes from the same renderer as the whole copy, with no document header", () => {
    const text = sectionText(prod, "configs");
    assert.match(text, /^## 8\. Configs to move\n/);
    assert.ok(!/Environment movement checklist/.test(text));
    assert.ok(!/## 4\. /.test(text));
    const whole = wholeText(prod);
    // every line of the section text appears, unchanged, in the whole text
    for (const line of text.trimEnd().split("\n")) assert.ok(whole.includes(line), line.slice(0, 60));
    assert.equal(sectionText(prod, "nope" as never), "");
  });
  it("whole text carries every section title", () => {
    const whole = wholeText(prod);
    for (const s of prod.sections) assert.ok(whole.includes(`## ${s.number}. ${s.title}`));
  });
  it("only-flagged view keeps just the items that need a look", () => {
    const sec = prod.sections.find((s) => s.id === "risks")!;
    const flagged = visibleSectionItems(sec, true);
    assert.ok(flagged.length <= sec.items.length);
    assert.equal(visibleSectionItems(sec, false).length, sec.items.length);
  });
  it("conflict and unknown block text keeps owners and variants", () => {
    assert.equal(conflictsText([]), "");
    const t = unknownsText([{ owner: "devops", items: [{ text: "which node?", sources: [{ jira: "A-1", pr: "r#1" }] }], more: 2 }, { owner: "", items: [] }]);
    assert.match(t, /### devops \(3\)/);
    assert.match(t, /- which node\? \[A-1: r#1\]/);
    assert.match(t, /- \.\.\. 2 more/);
    assert.match(t, /### owner not named \(0\)/);
    if (prod.conflicts.length) assert.match(conflictsText(prod.conflicts), /^- \[/);
  });
});

describe("branches", () => {
  it("validates branch names and search text like the server", () => {
    assert.equal(isValidBranchName("release/2.1"), true);
    assert.equal(isValidBranchName("feature/CAV-7346_x"), true);
    assert.equal(isValidBranchName("a..b"), false);
    assert.equal(isValidBranchName("a//b"), false);
    assert.equal(isValidBranchName("trailing/"), false);
    assert.equal(isValidBranchName("-lead"), false);
    assert.equal(isValidBranchName("has space"), false);
    assert.equal(isValidBranchName("x".repeat(201)), false);
    assert.equal(isValidBranchQuery("rel"), true);
    assert.equal(isValidBranchQuery(""), true);
    assert.equal(isValidBranchQuery("a b"), false);
    assert.equal(isValidBranchQuery("x".repeat(101)), false);
    // the server answers 400 for these, so the picker does not send them
    for (const bad of ["a..b", "a//b", "/lead", "star*"]) assert.equal(isValidBranchQuery(bad), false, bad);
    assert.equal(isValidBranchName("star*"), false);
  });
  it("the client patterns are the server's (service.ts BRANCH_RE / SEARCH_RE)", () => {
    assert.equal(BRANCH_NAME_RE.source, BRANCH_RE.source);
    // SEARCH_RE is not exported (service.ts is outside this change), so its literal is read from the source text.
    const src = readFileSync(join(process.cwd(), "src/lib/movement/service/service.ts"), "utf8");
    const m = /const SEARCH_RE = \/(.+)\/;/.exec(src);
    assert.ok(m, "SEARCH_RE not found in service.ts: update this guard");
    assert.equal(BRANCH_QUERY_RE.source, new RegExp(m![1]).source);
  });
  it("builds the PUT payload: trimmed, sorted, empty picks dropped, 30 max", () => {
    assert.deepEqual(branchPayload({ b: " main ", a: "dev", c: "  " }), [{ repo: "a", branch: "dev" }, { repo: "b", branch: "main" }]);
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`r${String(i).padStart(2, "0")}`, "main"]));
    assert.equal(branchPayload(many).length, 30);
  });
  it("detects unsaved changes", () => {
    assert.equal(branchesDirty([{ repo: "a", branch: "main" }], { a: "main" }), false);
    assert.equal(branchesDirty([{ repo: "a", branch: "main" }], { a: "dev" }), true);
    assert.equal(branchesDirty([], { a: "" }), false);
    assert.equal(branchesDirty([{ repo: "a", branch: "main" }], {}), true);
  });
  it("reads the record's hint and the server's mismatch from the checklist", () => {
    const base = cl("prod");
    const repo = base.sections.find((s) => s.id === "prodBranch")!.items.find((i) => i.key.startsWith("prod:"))!.key.slice(5);
    const hint = branchHints(base, repo);
    assert.ok(hint.hint && hint.hint.length > 0);
    assert.equal(hint.mismatch, null);
    const picked = cl("prod", [{ repo, branch: "totally-other-branch" }]);
    assert.ok(branchHints(picked, repo).mismatch, "a pick that differs from the record's branch is flagged");
    assert.deepEqual(branchHints(null, repo), { hint: null, mismatch: null });
    assert.equal(branchHints(base, "no-such-repo").hint, null);
  });
});

describe("sign-off diff and the changes banner", () => {
  const diff = { added: [], removed: [], changed: [], counts: { added: 2, removed: 0, changed: 3 }, truncated: 0, onlyMeta: false };
  it("summarises a diff", () => {
    assert.equal(diffSummary(diff), "2 added, 3 changed");
    assert.match(diffSummary({ ...diff, counts: { added: 0, removed: 0, changed: 0 }, onlyMeta: true }), /scope or readiness/);
    assert.equal(diffSummary({ ...diff, counts: { added: 0, removed: 1, changed: 0 } }), "1 removed");
  });
  it("shows the banner only for a signer with a diff (or a missing snapshot)", () => {
    const ch = { signedHash: "a", unchanged: false, diff, snapshotMissing: false };
    assert.equal(showChangesBanner(true, ch), true);
    assert.equal(showChangesBanner(false, ch), false);
    assert.equal(showChangesBanner(true, null), false);
    assert.equal(showChangesBanner(true, { ...ch, unchanged: true, diff: null }), false);
    assert.equal(showChangesBanner(true, { ...ch, diff: null, snapshotMissing: true }), true);
    assert.equal(showChangesBanner(true, { signedHash: null, unchanged: false, diff: null, snapshotMissing: false }), false);
  });
});

describe("mark done", () => {
  const items = [
    { issueId: "i1", key: "CAV-1", summary: "A", included: true, readiness: "ready" as const },
    { issueId: "i2", key: "CAV-2", summary: "B", included: false, readiness: "ready" as const },
    { issueId: "i3", key: "CAV-3", summary: "C", included: true, readiness: "override" as const },
    { issueId: "i4", key: "CAV-4", summary: "D", included: false, readiness: "blocked" as const },
  ];
  it("lists only the included Jiras, prefilled as moved", () => {
    const rows = doneRows(items);
    assert.deepEqual(rows.map((r) => [r.key, r.result]), [["CAV-1", "moved"], ["CAV-3", "moved"]]);
  });
  it("proposes delivered for moved and not delivered for held", () => {
    assert.equal(proposedStatusFor("moved"), "delivered");
    assert.equal(proposedStatusFor("held"), "not_delivered");
  });
  it("builds the POST body with trimmed, capped comments", () => {
    const rows = doneRows(items);
    rows[1] = { ...rows[1], result: "held", comment: `  ${"x".repeat(400)}  ` };
    const body = buildDonePayload(rows, "  all good  ");
    assert.equal(body.comment, "all good");
    assert.deepEqual(body.results[0], { issueId: "i1", result: "moved", comment: null });
    assert.equal(body.results[1].result, "held");
    assert.equal(body.results[1].comment?.length, 300);
    assert.equal("comment" in buildDonePayload(rows, "  "), false);
    assert.deepEqual(doneCounts(rows), { moved: 1, held: 1, notSelected: 0 });
  });
  it("summarises the confirm result", () => {
    assert.equal(confirmSummary({ updated: 3, unchanged: 1, skipped: 2 }), "3 updated, 1 unchanged, 2 skipped");
  });
});

describe("API errors", () => {
  it("prefers the server's message, then a status default", () => {
    assert.equal(describeApiError(409, { error: " X is blocked " }, "f"), "X is blocked");
    assert.match(describeApiError(403, null, "f"), /not allowed/);
    assert.match(describeApiError(500, {}, "f"), /try again/);
    assert.match(describeApiError(504, {}, "f"), /too long/);
    assert.equal(describeApiError(418, {}, "fallback"), "fallback");
  });
  it("recognises a stale-hash 409", () => {
    assert.equal(isStaleHash(409, { currentHash: "abc" }), true);
    assert.equal(isStaleHash(409, { error: "x" }), false);
    assert.equal(isStaleHash(400, { currentHash: "abc" }), false);
  });
});

describe("refresh / stale-data errors", () => {
  it("recognises the 409s only a Refresh fixes", () => {
    assert.equal(refreshNeededCode(409, { code: "inputs_stale" }), "inputs_stale");
    assert.equal(refreshNeededCode(409, { code: "refresh_failed" }), "refresh_failed");
    assert.equal(refreshNeededCode(409, { code: "conflict" }), null);
    assert.equal(refreshNeededCode(400, { code: "inputs_stale" }), null);
    assert.equal(refreshNeededCode(409, null), null);
  });
  it("explains each, with the stored failure when the server sent it", () => {
    assert.match(refreshNeededMessage("inputs_stale", null), /re-read/);
    const m = refreshNeededMessage("refresh_failed", { refreshError: "Jira 503" });
    assert.match(m, /Jira 503/);
    assert.match(m, /Refresh/);
    assert.match(refreshNeededMessage("refresh_failed", null), /last refresh failed,/);
  });
});

describe("signer and create errors", () => {
  it("reads the slot a 400 names, and ignores anything else", () => {
    assert.equal(slotFromError({ slot: "ba" }), "ba");
    assert.equal(slotFromError({ slot: "admin" }), null);
    assert.equal(slotFromError({ slot: 3 }), null);
    assert.equal(slotFromError(null), null);
  });
  it("delivery_closed gets the server's message plus what to do", () => {
    const m = describeCreateError(409, { error: "A completed or deleted delivery cannot be moved to an environment", code: "delivery_closed" }, "f");
    assert.match(m, /cannot be moved/);
    assert.match(m, /Reopen the delivery/);
    assert.equal(describeCreateError(409, { error: "There is already a live prod movement", code: "movement_exists" }, "f"), "There is already a live prod movement");
    assert.equal(describeCreateError(0, null, "Network"), "Network");
  });
});

describe("non-prod movements (no status step)", () => {
  it("only prod proposes and confirms delivery statuses", () => {
    assert.equal(hasStatusStep("prod"), true);
    assert.equal(hasStatusStep("uat"), false);
    assert.equal(hasStatusStep("demo"), false);
    assert.match(nonProdDoneHint("uat"), /UAT movement/);
    assert.match(nonProdDoneHint("demo"), /Demo movement/);
  });
  it("shows the server's skipReason (e.g. already delivered) for a proposal left alone", () => {
    assert.equal(proposalSkip({ skipReason: "already delivered" }), "already delivered");
    assert.equal(proposalSkip({}), null);
    assert.equal(proposalSkip({ skipReason: "" }), null);
  });
});

describe("movement page URLs and the old deep link", () => {
  const P = "00000000-1111-4222-8333-444444444444";
  const D = "11111111-2222-4333-8444-555555555555";
  const M = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
  const q = (s: string) => new URLSearchParams(s);
  it("builds the page URL and the way back, encoded", () => {
    assert.equal(movementPagePath(P, D, M), `/projects/${P}/deliveries/${D}/movements/${M}`);
    assert.equal(movementPagePath("p/q", "a b", "c&d"), "/projects/p%2Fq/deliveries/a%20b/movements/c%26d");
    assert.equal(deliveryBackPath(P, D), `/projects/${P}?tab=delivery-tracker&delivery=${D}`);
    assert.equal(completedBackPath(P, D, { environment: "prod", updated: 3, skipped: 0 }), `/projects/${P}?tab=delivery-tracker&delivery=${D}&updated=1&env=prod&n=3`);
    assert.equal(completedBackPath(P, D, { environment: "uat", updated: null, skipped: 0 }), `/projects/${P}?tab=delivery-tracker&delivery=${D}&updated=1&env=uat`);
  });
  it("a finish with skipped rows never carries updated=1 (the tab must not claim a success)", () => {
    const back = completedBackPath(P, D, { environment: "prod", updated: 0, skipped: 2 });
    assert.equal(back, `/projects/${P}?tab=delivery-tracker&delivery=${D}&done=1&skipped=2&env=prod&n=0`);
    assert.ok(!back.includes("updated=1"));
    assert.deepEqual(parseCompletionParams(q(back.split("?")[1])), { kind: "attention", environment: "prod", updated: 0, skipped: 2 });
    assert.equal(parseCompletionParams(q("done=1&env=prod&skipped=0")), null, "done=1 without skipped rows is not an arrival");
    assert.equal(parseCompletionParams(q("done=1&env=prod")), null);
  });
  it("the hand-over round-trips, and only a known environment with updated=1 counts", () => {
    const back = completedBackPath(P, D, { environment: "prod", updated: 12, skipped: 0 });
    assert.deepEqual(parseCompletionParams(q(back.split("?")[1])), { kind: "completed", environment: "prod", updated: 12, skipped: 0 });
    assert.deepEqual(parseCompletionParams(q("updated=1&env=demo")), { kind: "completed", environment: "demo", updated: null, skipped: 0 });
    assert.equal(parseCompletionParams(q("env=prod&n=2")), null, "no updated=1");
    assert.equal(parseCompletionParams(q("updated=1&env=staging")), null);
    assert.equal(parseCompletionParams(q("updated=1&env=prod&n=<x>"))?.updated, null, "a junk count is dropped, not shown");
    assert.equal(parseCompletionParams(q("updated=1&env=prod&n=99999"))?.updated, null);
    assert.equal(completionToastText({ environment: "prod", updated: 3, skipped: 0 }), "Movement to PROD completed: 3 statuses updated");
    assert.equal(completionToastText({ environment: "prod", updated: 1, skipped: 0 }), "Movement to PROD completed: 1 status updated");
    assert.equal(completionToastText({ environment: "uat", updated: null, skipped: 0 }), "Movement to UAT completed");
    assert.equal(completionToastText({ environment: "prod", updated: 0, skipped: 2 }), "Movement to PROD finished with 2 skipped; check the statuses");
    assert.ok(!/completed/.test(completionToastText({ environment: "prod", updated: 5, skipped: 1 })), "never 'completed' with skipped rows");
    assert.equal(withoutCompletionParams(`tab=delivery-tracker&delivery=${D}&updated=1&env=prod&n=3`), `tab=delivery-tracker&delivery=${D}`);
    assert.equal(withoutCompletionParams(`tab=delivery-tracker&delivery=${D}&done=1&skipped=2&env=prod&n=0`), `tab=delivery-tracker&delivery=${D}`);
  });
  it("an old deep link (delivery + movement) redirects to the page; delivery alone, or junk, does not", () => {
    assert.equal(legacyMovementRedirect(q(`tab=delivery-tracker&delivery=${D}&movement=${M}`), P), movementPagePath(P, D, M.toLowerCase()));
    assert.equal(legacyMovementRedirect(q(`tab=delivery-tracker&delivery=${D}`), P), null, "delivery alone only scrolls");
    assert.equal(legacyMovementRedirect(q(`movement=${M}`), P), null);
    assert.equal(legacyMovementRedirect(q(`delivery=${D}&movement=<script>`), P), null);
    assert.equal(legacyMovementRedirect(q(""), P), null);
    assert.deepEqual(parseDeliveryLink(q(`delivery=${D.toUpperCase()}`)), { deliveryId: D });
    assert.equal(parseDeliveryLink(q("delivery=nope")), null);
  });
});

describe("what happens when a movement is finished", () => {
  it("demo / uat finish at done: completed, return by itself", () => {
    for (const env of ["demo", "uat"] as const) {
      const p = completionPlan(env, null);
      assert.deepEqual([p.state, p.autoReturn, p.completion], ["completed", true, { environment: env, updated: null, skipped: 0 }]);
      assert.match(p.message, new RegExp(`^Movement to ${env === "uat" ? "UAT" : "Demo"} completed$`));
    }
  });
  it("prod, nothing skipped: completed with the count, returns by itself", () => {
    const ok = completionPlan("prod", { updated: 3, skipped: 0 });
    assert.deepEqual([ok.state, ok.autoReturn, ok.completion?.updated, ok.completion?.skipped], ["completed", true, 3, 0]);
    assert.equal(ok.message, "Movement to Prod completed: 3 statuses updated");
    assert.equal(completionPlan("prod", { updated: 0, skipped: 0 }).autoReturn, true, "nothing to change is still a clean finish");
    assert.equal(AUTO_RETURN_MS, 2000);
  });
  it("prod with skipped rows: attention, stays, keeps the reasons, never says 'completed', and the way back claims no success", () => {
    const rows = [{ key: "CAV-1", reason: "already delivered" }, { key: "CAV-2", reason: "test cases not signed off" }];
    const p = completionPlan("prod", { updated: 0, skipped: 2, skippedRows: rows });
    assert.deepEqual([p.state, p.autoReturn], ["attention", false]);
    assert.deepEqual(p.skippedRows, rows);
    assert.ok(!/completed/i.test(p.message), p.message);
    assert.equal(p.message, "0 statuses updated, 2 skipped. The skipped ones were left as they are; the reasons are listed below.");
    assert.deepEqual(p.completion, { environment: "prod", updated: 0, skipped: 2 });
    assert.ok(!completedBackPath("p", "d", p.completion!).includes("updated=1"));
  });
  it("a failed confirm: attention, stays, and there is no hand-over at all", () => {
    const f = completionPlan("prod", null, true);
    assert.deepEqual([f.state, f.autoReturn, f.completion], ["attention", false, null]);
    assert.match(f.message, /could not be confirmed/);
  });
  it("the banner lists at most 10 skipped rows and counts the rest", () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({ key: `CAV-${i}`, reason: "r" }));
    assert.deepEqual([skippedPreview(rows).shown.length, skippedPreview(rows).more], [10, 3]);
    assert.deepEqual(skippedPreview(rows.slice(0, 2)), { shown: rows.slice(0, 2), more: 0 });
  });
});

describe("arriving at a delivery card (once per arrival, not per delivery)", () => {
  const D = "11111111-2222-4333-8444-555555555555";
  const A = `tab=delivery-tracker&delivery=${D}`;
  const C = `${A}&updated=1&env=prod&n=3`;
  it("first visit, second visit of the same delivery, a completion arrival after a normal return, params cleared", () => {
    // 1st visit: fresh; the same URL rendered again is not
    let st = arrivalStep(null, D, A);
    assert.deepEqual(st, { fresh: true, clear: false, next: A });
    assert.equal(arrivalStep(st.next, D, A).fresh, false);
    // the user leaves (no delivery link in the URL): reset, so the 2nd visit of the SAME delivery is fresh again
    st = arrivalStep(st.next, null, "tab=overview");
    assert.deepEqual(st, { fresh: false, clear: false, next: null });
    st = arrivalStep(st.next, D, A);
    assert.equal(st.fresh, true, "2nd visit to the same delivery in one session");
    // a normal return, then a completion arrival WITHOUT the tab having seen the URL change in between: still fresh, and it must clear
    st = arrivalStep(st.next, D, C);
    assert.deepEqual(st, { fresh: true, clear: true, next: A });
    // the replace that clears the keys is not a new arrival
    assert.equal(arrivalStep(st.next, D, A).fresh, false);
    // and a stuck completion URL is cleared even when it was already handled
    assert.equal(arrivalStep(C, D, C).clear, true);
    assert.equal(arrivalStep(C, D, C).fresh, false);
  });
  it("a second completion for the same delivery is fresh again (different hand-over)", () => {
    const first = arrivalStep(null, D, C);
    const afterClear = arrivalStep(first.next, D, A);
    assert.equal(afterClear.fresh, false);
    assert.equal(arrivalStep(afterClear.next, D, `${A}&updated=1&env=uat`).fresh, true);
  });
  it("a list is stale after 10 s, or after 2 s when a movement just finished; never loaded = stale", () => {
    assert.equal(listIsStale(null, 100, false), true);
    assert.equal(listIsStale(1000, 5000, false), false);
    assert.equal(listIsStale(1000, 12000, false), true);
    assert.equal(listIsStale(1000, 5000, true), true);
    assert.equal(listIsStale(1000, 2500, true), false, "just loaded on a fresh mount: no second request");
  });
});

describe("the delivery reminder banner and the movement page", () => {
  it("is not shown on a movement route (it would cover the sticky sign-off bar), everywhere else it is", () => {
    assert.equal(showDeliveryBannerOn("/projects/p1/deliveries/d1/movements/m1"), false);
    assert.equal(showDeliveryBannerOn("/projects/p1"), true);
    assert.equal(showDeliveryBannerOn("/projects"), true);
    assert.equal(showDeliveryBannerOn("/"), true);
    assert.equal(showDeliveryBannerOn(null), true);
  });
});

describe("history paging", () => {
  const ev = (id: string, at = "2026-11-19T06:00:00Z") => ({ id, type: "signed", at, actorName: "A", detail: null });
  it("appends a page and drops events already shown", () => {
    const merged = mergeEvents([ev("a"), ev("b")], [ev("b"), ev("c")]);
    assert.deepEqual(merged.map((e) => e.id), ["a", "b", "c"]);
    assert.deepEqual(mergeEvents([], [ev("a")]).map((e) => e.id), ["a"]);
  });
  it("labels the refresh events and condenses a small detail", () => {
    assert.equal(eventLabel("refresh_failed"), "Reading the Jira review comments failed");
    assert.equal(eventLabel("refresh_recovered"), "Jira review comments read again");
    assert.equal(eventDetail("signed", { slot: "ba", hash: "x" }), "ba");
    assert.equal(eventDetail("override", { key: "CAV-1", reason: "agreed with lead", included: true }), "CAV-1 · reason: agreed with lead");
    assert.equal(eventDetail("done", { moved: 3, held: 1, comment: "ok" }), "3 moved, 1 held · comment: ok");
    assert.equal(eventDetail("items_ticked", { keys: ["A-1", "A-2", "A-3", "A-4", "A-5", "A-6"] }), "A-1, A-2, A-3, A-4, A-5 +1");
    assert.equal(eventDetail("refresh_failed", { message: "Jira 503" }), "Jira 503");
    assert.equal(eventDetail("created", { environment: "prod" }), null);
    assert.equal(eventDetail("x", null), null);
  });
});

describe("changes endpoint is only asked of signers", () => {
  const sg = (signedCurrent: boolean) => (["deployer", "ba", "lead"] as const).map((slot) => ({ slot, email: `${slot}@x.com`, name: slot, signedAt: null, signed: signedCurrent && slot === "ba", signedCurrent: signedCurrent && slot === "ba" }));
  const v = (o: { changes?: boolean; needsRefresh?: boolean; reset?: boolean; hash?: string | null; mine?: string[]; signed?: boolean; resetAt?: string } = {}) =>
    ({
      permissions: perms({ changes: o.changes ?? true }),
      needsRefresh: o.needsRefresh ?? false,
      movement: { hash: o.hash === undefined ? "h" : o.hash },
      me: me({ slots: o.mine ?? ["ba"] }),
      signers: sg(o.signed ?? false),
      events: o.reset === false ? [] : [{ type: "checklist_changed", at: o.resetAt ?? "2026-11-19T06:00:00Z", actorName: null }],
    }) as never;
  it("fetches only for permissions.changes, a readable checklist, a hash, a reset, and a viewer who has not signed the current checklist", () => {
    assert.equal(shouldFetchChanges(v()), true);
    assert.equal(shouldFetchChanges(v({ changes: false })), false, "never for non-signers");
    assert.equal(shouldFetchChanges(v({ needsRefresh: true })), false);
    assert.equal(shouldFetchChanges(v({ hash: null })), false);
    assert.equal(shouldFetchChanges(v({ reset: false })), false);
    assert.equal(shouldFetchChanges(v({ signed: true })), false, "signed the current hash: nothing to be told");
  });
  it("the cache key is the hash AND the latest reset, so a reset back to an older hash fetches again", () => {
    assert.notEqual(changesKey(v({ resetAt: "2026-11-19T06:00:00Z" })), changesKey(v({ resetAt: "2026-11-19T07:00:00Z" })), "same hash, a newer reset: a new key");
    assert.equal(changesKey(v()), changesKey(v()));
    assert.equal(changesKey(v({ hash: null, reset: false })), "|");
  });
  it("the banner hides once the viewer signs the current hash, when the server says unchanged, and for a cache from another key", () => {
    const diff = { added: [], removed: [], changed: [], counts: { added: 1, removed: 0, changed: 0 }, truncated: 0, onlyMeta: false };
    const data = { signedHash: "old", unchanged: false, diff, snapshotMissing: false };
    const open = v();
    assert.equal(changesBannerVisible(open, { key: changesKey(open), data }), true);
    const signed = v({ signed: true });
    assert.equal(changesBannerVisible(signed, { key: changesKey(signed), data }), false, "after the viewer signed the current hash");
    assert.equal(changesBannerVisible(open, { key: changesKey(open), data: { ...data, unchanged: true, diff: null } }), false);
    assert.equal(changesBannerVisible(open, { key: "other|key", data }), false, "a cache from an earlier hash or reset is never shown");
    assert.equal(changesBannerVisible(open, null), false);
    assert.equal(changesBannerVisible(v({ changes: false }), { key: changesKey(v({ changes: false })), data }), false);
    // reset again (signature cleared, newer reset event): the old cache no longer matches, the next fetch decides
    const reset = v({ resetAt: "2026-11-19T08:00:00Z" });
    assert.equal(changesBannerVisible(reset, { key: changesKey(open), data }), false);
  });
});

describe("session expiry, years, auto-refresh age", () => {
  it("a 401 reads as an expired session everywhere", () => {
    assert.equal(describeApiError(401, null, "f"), SESSION_EXPIRED);
    assert.match(SESSION_EXPIRED, /session expired/);
    assert.match(describeApiError(403, null, "f"), /not allowed/);
  });
  it("a time from another year carries the year; this year's does not", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    assert.equal(formatIst("2026-03-01T06:00:00Z", now).includes("2026"), false);
    assert.match(formatIst("2025-12-31T06:00:00Z", now), /2025/);
    assert.match(formatIst("2027-01-02T06:00:00Z", now), /2027/);
    // the year of the IST clock, not UTC: 31 Dec 20:00 UTC is already 1 Jan 2026 in IST
    assert.match(formatIst("2025-12-31T20:00:00Z", Date.parse("2027-06-01T00:00:00Z")), /2026/);
  });
  it("auto-refresh waits 30 minutes (the cron's cadence), not 10", () => {
    assert.equal(AUTO_REFRESH_AFTER_MS, 30 * 60 * 1000);
    const now = Date.parse("2026-11-19T12:00:00Z");
    assert.equal(needsAutoRefresh("2026-11-19T11:40:00Z", now, true), false);
    assert.equal(needsAutoRefresh("2026-11-19T11:20:00Z", now, true), true);
  });
});

describe("the /done body stays under the server's 64 KB", () => {
  const rows = (n: number, comment: string) => Array.from({ length: n }, (_, i) => ({ issueId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, key: `CAV-${i}`, summary: "s", result: "held" as const, comment }));
  const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
  it("200 rows of 300 four-byte characters are shortened to fit, and the user is told", () => {
    const fit = fitDonePayload(rows(200, "\u{1F680}".repeat(300)), "é".repeat(500));
    assert.ok(bytes(fit.payload) <= DONE_BODY_BUDGET_BYTES, `${bytes(fit.payload)} bytes`);
    assert.ok(bytes(fit.payload) < 64 * 1024);
    assert.equal(fit.trimmed, true);
    assert.equal(fit.payload.results.length, 200);
    assert.ok(fit.payload.results.every((r) => r.comment !== null && r.comment.length > 0), "every row keeps a (shorter) comment");
    assert.ok(!fit.payload.results.some((r) => (r.comment ?? "").includes("�")), "no code point is cut in half");
    assert.equal(fit.payload.comment?.length, 500);
  });
  it("200 rows of quotes and backslashes (escaped on the wire) also fit", () => {
    const fit = fitDonePayload(rows(200, '"\\'.repeat(150)), "");
    assert.ok(bytes(fit.payload) <= DONE_BODY_BUDGET_BYTES);
  });
  it("a normal done is untouched and not flagged", () => {
    const fit = fitDonePayload(rows(10, "held back, waiting for the DBA"), "ok");
    assert.equal(fit.trimmed, false);
    assert.equal(fit.payload.results[0].comment, "held back, waiting for the DBA");
    assert.deepEqual(buildDonePayload(rows(10, "x"), ""), fitDonePayload(rows(10, "x"), "").payload);
  });
});

describe("signers: the same person twice", () => {
  const p = (email: string) => ({ email, name: email });
  it("says so on each offending field, ignoring case and spaces; nothing when all differ or unset", () => {
    const c = signerConflicts({ deployer: p("A@x.com"), ba: p(" a@x.com "), lead: p("l@x.com") });
    assert.deepEqual(Object.keys(c).sort(), ["ba", "deployer"]);
    assert.match(c.deployer ?? "", /^Deployer and BA are the same person; the Deployer, the BA and the Lead must be three different people$/);
    assert.match(c.ba ?? "", /^BA and Deployer are the same person/);
    assert.match(signerConflicts({ deployer: p("a@x.com"), ba: p("b@x.com"), lead: p("A@x.com") }).lead ?? "", /^Lead and Deployer are the same person/);
    assert.deepEqual(signerConflicts({ deployer: p("a@x.com"), ba: p("b@x.com"), lead: p("c@x.com") }), {});
    assert.deepEqual(signerConflicts({ deployer: null, ba: null, lead: p("c@x.com") }), {});
  });
});

describe("history reload keeps loaded pages", () => {
  const ev = (id: string) => ({ id, type: "signed", at: "2026-11-19T06:00:00Z", actorName: null, detail: null });
  it("a reload puts the fresh first page on top and keeps the older pages and their cursor", () => {
    const shown = ["e5", "e4", "e3", "e2", "e1"].map(ev);
    const page = ["e6", "e5", "e4"].map(ev);
    const m = mergeFirstPage(shown, "cursor-deep", page, "cursor-first");
    assert.deepEqual(m.events.map((e) => e.id), ["e6", "e5", "e4", "e3", "e2", "e1"]);
    assert.equal(m.next, "cursor-deep");
  });
  it("with only the first page loaded, the fresh page's own cursor wins", () => {
    const m = mergeFirstPage(["e3", "e2", "e1"].map(ev), "c1", ["e4", "e3", "e2"].map(ev), "c2");
    assert.equal(m.next, "c2");
    assert.deepEqual(m.events.map((e) => e.id), ["e4", "e3", "e2", "e1"]);
  });
});

describe("conflict kinds in plain words", () => {
  it("maps every known kind and humanises an unknown one", () => {
    const expected: Record<string, string> = {
      branch_mismatch: "Branch differs from the review comment",
      config_default: "Different defaults",
      config_env_value: "Different values per environment",
      downtime: "Downtime disagrees",
      order_cycle: "Deploy order loop",
      prod_branch: "Different prod branches",
    };
    for (const [k, v] of Object.entries(expected)) assert.equal(conflictLabel(k), v);
    assert.ok(!/_/.test(conflictLabel("bundle_sdk")) && !/_/.test(conflictLabel("deploy_branch")));
    assert.equal(conflictLabel("some_new_kind"), "Some new kind");
  });
  it("counts per kind for the summary line without touching the total", () => {
    const k = conflictKindCounts([{ kind: "downtime" }, { kind: "prod_branch" }, { kind: "downtime" }]);
    assert.deepEqual(k.map((x) => [x.kind, x.count, x.label]), [["downtime", 2, "Downtime disagrees"], ["prod_branch", 1, "Different prod branches"]]);
    assert.equal(k.reduce((n, x) => n + x.count, 0), 3);
  });
  it("the copied conflicts block uses the plain words too", () => {
    const text = conflictsText([{ kind: "config_default", title: "KEY", variants: [] } as never]);
    assert.match(text, /^- \[Different defaults\] KEY/);
  });
});

describe("small panel rules", () => {
  it("Retry is offered unless the movement is gone (404) or the session is (401)", () => {
    assert.equal(loadErrorActions(404).retry, false);
    assert.equal(loadErrorActions(401).retry, false);
    assert.equal(loadErrorActions(500).retry, true);
    assert.equal(loadErrorActions(0).retry, true);
    assert.equal(loadErrorActions(null).retry, true);
  });
  it("cancel with an empty or blank reason is allowed and sends no reason; a long one is cut to 500", () => {
    assert.deepEqual(cancelBody(""), {});
    assert.deepEqual(cancelBody("   "), {});
    assert.deepEqual(cancelBody("  wrong env "), { reason: "wrong env" });
    assert.equal(cancelBody("x".repeat(900)).reason?.length, 500);
  });
  it("the auto-refresh text follows the 30-minute constant", () => {
    assert.match(autoRefreshReason(), /older than 30 minutes/);
  });
  it("each nested dialog names the controls that get focus back, most specific first", () => {
    assert.deepEqual(openerTestIds("override", "CAV-1"), ["movement-override-CAV-1", "movement-revoke-CAV-1", "movement-jira-toggle-CAV-1"]);
    assert.deepEqual(openerTestIds("revoke", "CAV-1"), openerTestIds("override", "CAV-1"), "an Override button turns into Revoke after it worked");
    assert.equal(openerTestIds("done")[0], "movement-mark-done");
    assert.ok(openerTestIds("done").includes("movement-confirm-statuses"), "Mark done turns into Confirm statuses");
    assert.equal(openerTestIds("create", "uat")[0], "movement-start-uat");
    assert.equal(openerTestIds("cancel")[0], "movement-cancel");
    assert.equal(openerTestIds("signers")[0], "movement-change-signers");
  });
});

describe("the Mark done counter agrees with what is recorded", () => {
  const it4 = (issueId: string, included: boolean, readiness: "ready" | "blocked" | "override") => ({ issueId, key: issueId.toUpperCase(), summary: issueId, included, readiness });
  it("unselected and blocked Jiras count as held, in the counter, the text and the proposal", () => {
    // 2 selected + 1 not selected (the reported case): the dialog said "1 not selected" and "2 moved, 0 held"
    const items = [it4("a", true, "ready"), it4("b", true, "override"), it4("c", false, "ready")];
    const rows = doneRows(items);
    const out = notSelectedCount(items);
    assert.equal(out, 1);
    assert.deepEqual(doneCounts(rows, out), { moved: 2, held: 1, notSelected: 1 });
    assert.match(notSelectedNote(out), /^1 Jira was not selected and will be recorded as held\.$/);
    // the confirm step proposes Delivered for moved, Not delivered for held: the same 2 and 1
    const c = doneCounts(rows, out);
    assert.deepEqual([c.moved, c.held], [rows.filter((r) => proposedStatusFor(r.result) === "delivered").length, rows.filter((r) => proposedStatusFor(r.result) === "not_delivered").length + out]);
  });
  it("a blocked Jira is not selected; marking a selected row held adds to held; nothing selected is all held", () => {
    const items = [it4("a", true, "ready"), it4("b", false, "blocked"), it4("c", true, "ready"), it4("d", false, "ready")];
    const rows = doneRows(items);
    assert.equal(notSelectedCount(items), 2);
    rows[1] = { ...rows[1], result: "held" };
    assert.deepEqual(doneCounts(rows, notSelectedCount(items)), { moved: 1, held: 3, notSelected: 2 });
    assert.deepEqual(doneCounts([], notSelectedCount([it4("x", false, "ready"), it4("y", false, "blocked")])), { moved: 0, held: 2, notSelected: 2 });
    assert.equal(notSelectedNote(0), "");
    assert.match(notSelectedNote(3), /^3 Jiras were not selected/);
  });
  it("the numbers do not depend on the environment (prod proposes statuses from them, demo / uat just records them)", () => {
    const items = [it4("a", true, "ready"), it4("b", false, "ready")];
    const c = doneCounts(doneRows(items), notSelectedCount(items));
    for (const env of ["prod", "uat", "demo"]) assert.deepEqual([env, c.moved, c.held], [env, 1, 1]);
    assert.equal(hasStatusStep("prod"), true);
    assert.equal(hasStatusStep("demo"), false);
  });
});

describe("held-only branch picks", () => {
  it("only the server's heldOnly:true flags a row", () => {
    assert.equal(isHeldOnly({ heldOnly: true }), true);
    assert.equal(isHeldOnly({ heldOnly: false }), false);
    assert.equal(isHeldOnly({}), false);
    assert.equal(isHeldOnly(undefined), false);
    assert.match(HELD_ONLY_NOTE, /until one of those Jiras is ticked/);
  });
});

describe("signer search never says 'no match' while it is still looking", () => {
  it("short text, no answer yet (a slow first request), an answer for another text, an error, empty, results", () => {
    assert.equal(signerSearchPhase("a", false, null), "short");
    assert.equal(signerSearchPhase("aakash", true, null), "loading");
    assert.equal(signerSearchPhase("aakash", true, { text: "aaka", count: 3, error: null }), "loading", "an answer for an earlier text is not an answer");
    assert.equal(signerSearchPhase(" aakash ", true, { text: "aakash", count: 0, error: null }), "empty");
    assert.equal(signerSearchPhase("aakash", true, { text: "aakash", count: 0, error: "Search failed" }), "error");
    assert.equal(signerSearchPhase("aakash", true, { text: "aakash", count: 1, error: null }), "results");
    // typing on after a "no match": back to loading until the new text is answered
    assert.equal(signerSearchPhase("aakashp", true, { text: "aakash", count: 0, error: null }), "loading");
  });
});

describe("the create dialog never stays up waiting for a page that is not coming", () => {
  const base = { openingSince: 1000, now: 1000, pathname: "/projects/p1", projectPath: "/projects/p1", becameVisible: false };
  it("releases on a route change, when the tab is shown again, and after the timeout; otherwise keeps waiting", () => {
    assert.equal(createReleaseReason(base), null, "still on the project page, just started");
    assert.equal(createReleaseReason({ ...base, pathname: "/projects/p1/deliveries/d1/movements/m1" }), "route");
    assert.equal(createReleaseReason({ ...base, becameVisible: true }), "visible");
    assert.equal(createReleaseReason({ ...base, now: 1000 + OPENING_TIMEOUT_MS - 1 }), null);
    assert.equal(createReleaseReason({ ...base, now: 1000 + OPENING_TIMEOUT_MS }), "timeout");
    assert.equal(createReleaseReason({ ...base, pathname: null }), null, "an unknown path is not a route change");
  });
  it("nothing opening = nothing to release, whatever else is true", () => {
    assert.equal(createReleaseReason({ ...base, openingSince: null, becameVisible: true, pathname: "/elsewhere", now: 1e9 }), null);
  });
  it("a visible tab beats a route change in the reason (the user came back)", () => {
    assert.equal(createReleaseReason({ ...base, becameVisible: true, pathname: "/projects/p1/deliveries/d1/movements/m1" }), "visible");
    assert.equal(OPENING_TIMEOUT_MS, 15_000);
  });
  it("only the create request itself is undismissable; once the page is opening, Close / Esc / overlay work", () => {
    assert.deepEqual(createDialogUi(false, false), { canDismiss: true, cancelDisabled: false, cancelLabel: "Cancel" });
    assert.deepEqual(createDialogUi(true, false), { canDismiss: false, cancelDisabled: true, cancelLabel: "Cancel" });
    assert.deepEqual(createDialogUi(true, true), { canDismiss: true, cancelDisabled: false, cancelLabel: "Close" });
  });
});

describe("the confirm step after it wrote", () => {
  const proposals = { counts: { delivered: 2, notDelivered: 0, willChange: 2 }, missing: 0 };
  it("before: a proposal (2 delivered, 2 will change); after: what happened, in the past tense", () => {
    assert.equal(confirmHeading(proposals, null), "2 delivered, 0 not delivered; 2 will change");
    assert.equal(confirmHeading({ ...proposals, missing: 1 }, null), "2 delivered, 0 not delivered; 2 will change; 1 no longer in the delivery");
    assert.equal(confirmHeading(proposals, { updated: 2, unchanged: 0, skipped: 0 }), "2 updated, 0 unchanged, 0 skipped");
  });
  it("the Now column moves to the new status once the row was updated (or already was there); a skipped row keeps the old one", () => {
    assert.equal(nowStatusAfter("pending", "delivered", undefined), "pending");
    assert.equal(nowStatusAfter("pending", "delivered", "updated"), "delivered");
    assert.equal(nowStatusAfter("delivered", "delivered", "unchanged"), "delivered");
    assert.equal(nowStatusAfter("pending", "delivered", "skipped"), "pending");
  });
});

describe("the row's status chip", () => {
  it("Ready / Blocked / Overridden / Not selected", () => {
    assert.equal(rowStatus({ readiness: "ready", included: true }), "ready");
    assert.equal(rowStatus({ readiness: "ready", included: false }), "notSelected");
    assert.equal(rowStatus({ readiness: "blocked", included: false }), "blocked");
    assert.equal(rowStatus({ readiness: "override", included: false }), "overridden");
    assert.deepEqual(["ready", "blocked", "overridden", "notSelected"].map((k) => ROW_STATUS[k as keyof typeof ROW_STATUS].label), ["Ready", "Blocked", "Overridden", "Not selected"]);
  });
  it("Dev / Test marks: a tick with who and when, or a dash", () => {
    const m = signoffMark("Dev", { by: "d@x.com", at: "2026-11-19T06:00:00Z" });
    assert.deepEqual([m.mark, m.signed, m.label], ["✓", true, "Dev: signed"]);
    assert.match(m.title, /Dev signed by d@x.com at /);
    assert.deepEqual([signoffMark("Tester", null).mark, signoffMark("Tester", null).label], ["–", "Tester: missing"]);
    assert.match(TICK_RESETS_SIGNOFFS, /resets the sign-offs/);
  });
});

describe("copy, nothing selected, and reasons shown as text", () => {
  it("Copy is never off for lack of a checklist: only when the movement did not load, or while a copy runs", () => {
    assert.equal(copyAllEnabled(true, false), true);
    assert.equal(copyAllEnabled(false, false), false);
    assert.equal(copyAllEnabled(true, true), false);
  });
  it("nothing selected: items exist and none is effectively ticked (a blocked one is never in)", () => {
    assert.equal(nothingSelected([]), false, "an empty movement is a different message");
    assert.equal(nothingSelected([{ included: false }, { included: false }]), true);
    assert.equal(nothingSelected([{ included: false }, { included: true }]), false);
  });
  it("a slot holder who cannot sign because nothing is ticked is told so (after stale data / a failed refresh, which come first)", () => {
    const v = (o: Record<string, unknown> = {}) => ({ movement: { status: "ready", hash: "h1" } as never, signers: signers([false, false, false]), permissions: perms({ sign: [] }), me: me({ slots: ["ba"] }), needsRefresh: false, refreshError: null, items: [{ included: false }], ...o });
    assert.equal(signerRows(v(), "h1")[1].signReason, NOTHING_SELECTED_REASON);
    assert.equal(signerRows(v({ items: [{ included: true }] }), "h1")[1].signReason, "You cannot sign right now");
    assert.match(signerRows(v({ needsRefresh: true }), "h1")[1].signReason ?? "", /re-read/);
    assert.match(signerRows(v({ refreshError: "boom" }), "h1")[1].signReason ?? "", /boom/);
  });
  it("the Start / Done / Confirm reason is printed only for the deployer or an admin, in the right status", () => {
    const off = (reason: string) => ({ allowed: false, reason });
    const on = { allowed: true, reason: null };
    const a = { start: off("Waiting for sign-off from BA, Lead"), done: off("not now"), confirm: off("not yet") };
    const dep = { isAdmin: false, slots: ["deployer"] };
    assert.deepEqual(pendingActionReason({ status: "ready", environment: "prod", me: dep }, a), { action: "start", reason: "Waiting for sign-off from BA, Lead" });
    assert.deepEqual(pendingActionReason({ status: "in_progress", environment: "prod", me: dep }, a), { action: "done", reason: "not now" });
    assert.deepEqual(pendingActionReason({ status: "done", environment: "prod", me: { isAdmin: true, slots: [] } }, a), { action: "confirm", reason: "not yet" });
    assert.equal(pendingActionReason({ status: "done", environment: "uat", me: dep }, a), null, "no confirm step for uat");
    assert.equal(pendingActionReason({ status: "ready", environment: "prod", me: { isAdmin: false, slots: ["ba"] } }, a), null, "not their button");
    assert.equal(pendingActionReason({ status: "ready", environment: "prod", me: dep }, { ...a, start: on }), null, "enabled: nothing to explain");
    assert.equal(pendingActionReason({ status: "cancelled", environment: "prod", me: dep }, a), null);
  });
});

describe("checklist sections open by default, within a row budget", () => {
  it("first items per section: 50, or fewer so that all sections together stay inside ~600 rows (14 sections -> 42)", () => {
    assert.equal(initialItemsPerSection(14), 42);
    assert.ok(14 * initialItemsPerSection(14) <= CHECKLIST_ROW_BUDGET);
    assert.equal(initialItemsPerSection(4), 50, "few sections: the normal chunk");
    assert.equal(initialItemsPerSection(100), 10, "never fewer than 10");
    assert.equal(initialItemsPerSection(0), 50);
  });
  it("the remembered choice: open unless the user last chose 'closed' (nothing stored, or junk, is open)", () => {
    assert.equal(parseOpenPref(null), true);
    assert.equal(parseOpenPref(undefined), true);
    assert.equal(parseOpenPref("open"), true);
    assert.equal(parseOpenPref("closed"), false);
    assert.equal(parseOpenPref("garbage"), true);
  });
});

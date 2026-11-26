/**
 * Integration test (DEV database, fake Jira, fake LLM) of the per-Jira checklist, the Flux-side comment edits and the
 * summary. Runs only with MOVEMENT_DB_TESTS=1 so `pnpm test` stays DB-free:
 *
 *   MOVEMENT_DB_TESTS=1 ./node_modules/.bin/tsx --env-file=.env.local --test src/lib/movement/service/service.comments.integration.test.ts
 *
 * It has its own seed (unique tag, removed in `after`); nothing is sent and Jira is only ever READ.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { ByteLru } from "../cache";
import { FakeJira, fixtureComment, noiseComment } from "../fake-jira";
import { approxBytes, type ParsedRecord } from "../record";
import type { IssueRecords } from "../records";
import type { RefreshOptions } from "./refresh";
import type { MovementActor } from "./types";

const RUN = process.env.MOVEMENT_DB_TESTS === "1";
const suite = RUN ? describe : describe.skip;

const TAG = `MVTEST-${randomUUID().slice(0, 8)}`;
const E1 = "dev+tctest@salescode.ai";
const E2 = "dev+tctest2@salescode.ai";
const E3 = `${TAG.toLowerCase()}-lead@example.invalid`; // `.invalid` can never be mailed
const E5 = `${TAG.toLowerCase()}-qa@example.invalid`;
const actor = (email: string, flags: Partial<Pick<MovementActor, "isManager" | "isAdmin">> = {}): MovementActor => ({ id: email, email, name: email.split("@")[0], isManager: false, isAdmin: false, ...flags });
const admin = actor(E1, { isManager: true, isAdmin: true });
const manager = actor(E2, { isManager: true }); // a delivery manager who is not an admin
const deployer = actor(E1);
const ba = actor(E2);
const lead = actor(E3);
const qaLead = actor(E5);
const SIGNERS = { deployer: { email: E1 }, ba: { email: E2 }, lead: { email: E3 }, qa_lead: { email: E5 } };

const caches = () => ({
  recordCache: new ByteLru<string, ParsedRecord>({ maxBytes: 64_000_000, weigh: approxBytes }),
  resultCache: new ByteLru<string, IssueRecords>({ maxBytes: 8_000_000, ttlMs: 60_000, weigh: () => 1000 }),
});
let stmts: string[] | null = null;
const startCount = () => void (stmts = []);
const stopCount = () => {
  const out = stmts ?? [];
  stmts = null;
  return out;
};

suite("per-Jira checklist, comment edits, summary (dev DB, fake Jira, fake LLM)", () => {
  let D: typeof import("@/lib/db");
  let S: typeof import("@/lib/db/schema");
  let O: typeof import("drizzle-orm");
  let M: typeof import("./service");
  let R: typeof import("./refresh");
  let N: typeof import("./notify");
  const created = { users: [] as string[], projectId: "", deliveryIds: [] as string[] };
  const issues = new Map<string, string>();
  let origQuery: unknown;
  const noHeads = { transport: async () => ({ data: {} }), tokens: new Map([["salescode-ai", "unused"]]) };

  const rec7346 = () => [fixtureComment("CAV-7346-81399"), fixtureComment("CAV-7346-81400"), fixtureComment("CAV-7346-81421")];
  const depsFor = (f: FakeJira): RefreshOptions => ({ source: f, github: { heads: noHeads }, loadOptions: caches() });
  const codeOf = (e: unknown) => (e as { code?: string }).code;
  const rejects = async (fn: () => Promise<unknown>, status: number) => void (await assert.rejects(fn, (e: unknown) => (e as { status?: number }).status === status, `expected HTTP ${status}`));

  async function seedIssue(key: string, n: number) {
    const [i] = await D.db.insert(S.jiraIssues).values({ projectId: created.projectId, jiraId: `${TAG}-${n}`, jiraKey: key, summary: `${TAG} ${key}`, status: "Done", issueType: "Task" }).returning({ id: S.jiraIssues.id });
    issues.set(key, i.id);
  }
  async function seedDelivery(name: string, ids: string[]) {
    const [d] = await D.db.insert(S.deliveries).values({ projectId: created.projectId, name: `${TAG} ${name}`, deliveryDate: "2030-01-01", createdBy: E1 }).returning({ id: S.deliveries.id });
    created.deliveryIds.push(d.id);
    await D.db.insert(S.deliveryItems).values(ids.map((issueId) => ({ deliveryId: d.id, issueId, addedBy: E1 })));
    return d.id;
  }
  async function newMovement(name: string, keys: string[], f: FakeJira, env: "demo" | "uat" | "prod" = "uat") {
    const d = await seedDelivery(name, keys.map((k) => issues.get(k)!));
    const dp = depsFor(f);
    const out = await M.createMovement(d, env, SIGNERS, admin, dp);
    assert.equal(out.refresh.ok, true, JSON.stringify(out.refresh));
    return { d, mid: out.movementId, deps: dp };
  }
  const mvRow = async (mid: string) => (await D.db.select().from(S.deliveryMovements).where(O.eq(S.deliveryMovements.id, mid)))[0];
  const evOf = async (mid: string, type: string) => (await D.db.select({ type: S.deliveryMovementEvents.type }).from(S.deliveryMovementEvents).where(O.eq(S.deliveryMovementEvents.movementId, mid))).filter((e) => e.type === type);
  const soOf = async (mid: string) => (await D.db.select({ slot: S.deliveryMovementSignoffs.slot, h: S.deliveryMovementSignoffs.signedHash }).from(S.deliveryMovementSignoffs).where(O.eq(S.deliveryMovementSignoffs.movementId, mid))).sort((a, b) => a.slot.localeCompare(b.slot));
  const itemsOf = async (mid: string) => Object.fromEntries((await D.db.select({ key: S.jiraIssues.jiraKey, r: S.deliveryMovementItems }).from(S.deliveryMovementItems).innerJoin(S.jiraIssues, O.eq(S.jiraIssues.id, S.deliveryMovementItems.issueId)).where(O.eq(S.deliveryMovementItems.movementId, mid))).map((x) => [x.key, x.r]));
  const hashOf = async (d: string, mid: string) => (await M.getMovementView(d, mid, admin)).movement.hash!;
  async function signAll(d: string, mid: string) {
    const h = await hashOf(d, mid);
    await M.signMovement(d, mid, "deployer", h, deployer);
    await M.signMovement(d, mid, "ba", h, ba);
    await M.signMovement(d, mid, "lead", h, lead);
    await M.signMovement(d, mid, "qa_lead", h, qaLead);
    return h;
  }

  before(async () => {
    D = await import("@/lib/db");
    S = await import("@/lib/db/schema");
    O = await import("drizzle-orm");
    M = await import("./service");
    R = await import("./refresh");
    N = await import("./notify");
    N.setMovementNotifier(null);
    const pg = (await import("pg")).default;
    origQuery = pg.Client.prototype.query;
    const orig = pg.Client.prototype.query as (...a: unknown[]) => unknown;
    (pg.Client.prototype as unknown as { query: unknown }).query = function (this: unknown, ...a: unknown[]) {
      if (stmts) stmts.push(typeof a[0] === "string" ? a[0] : ((a[0] as { text?: string })?.text ?? ""));
      return orig.apply(this, a);
    };
    for (const email of [E1, E2, E3, E5]) {
      const r = await D.db.insert(S.users).values({ id: email, email, role: "USER" }).onConflictDoNothing().returning({ id: S.users.id });
      if (r.length) created.users.push(email);
    }
    const [p] = await D.db.insert(S.jiraProjects).values({ name: TAG, jiraBaseUrl: `https://${TAG.toLowerCase()}.invalid`, jiraProjectKey: "MVT", jiraEmail: "x@example.com", jiraApiToken: "not-a-real-token", webhookSecret: TAG, createdBy: E1 }).returning({ id: S.jiraProjects.id });
    created.projectId = p.id;
    await D.db.insert(S.projectStatusMappings).values({ projectId: p.id, rawStatus: "Done", canonicalStatus: "DONE" });
    await seedIssue("CAV-7346", 1);
    await seedIssue("CAV-7399", 2);
  });

  after(async () => {
    try {
      if (created.deliveryIds.length) await D.db.delete(S.deliveryMovements).where(O.inArray(S.deliveryMovements.deliveryId, created.deliveryIds));
      if (created.deliveryIds.length) await D.db.delete(S.deliveries).where(O.inArray(S.deliveries.id, created.deliveryIds));
      if (created.projectId) await D.db.delete(S.jiraProjects).where(O.eq(S.jiraProjects.id, created.projectId));
      if (created.users.length) await D.db.delete(S.users).where(O.inArray(S.users.id, created.users));
    } finally {
      const pg = (await import("pg")).default;
      (pg.Client.prototype as unknown as { query: unknown }).query = origQuery;
      await D.pool.end();
    }
  });

  it("per-Jira checklist: all of one Jira's records, whatever its tick or override state, cached, 404 / 409 as elsewhere", async () => {
    const core = await import("./core");
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }, { key: "CAV-7399", comments: [noiseComment("9", Date.now())] }]);
    const m = await newMovement("itemcl", ["CAV-7346", "CAV-7399"], f);
    const id7346 = issues.get("CAV-7346")!;
    const c1 = await M.getItemChecklist(m.d, m.mid, id7346);
    assert.equal(c1.sections.length, 14);
    assert.ok(c1.stats.prs >= 3 && c1.scope.jiras.length === 1 && c1.scope.jiras[0].jira === "CAV-7346");
    assert.equal(c1.environment, "uat");
    // the movement's tick state does not change it: untick, and it is the same checklist
    await M.setIncluded(m.d, m.mid, [id7346], false, admin);
    assert.equal((await M.getItemChecklist(m.d, m.mid, id7346)).hash, c1.hash, "shown even for a held Jira, ignoring the tick");
    assert.equal((await M.getItemChecklist(m.d, m.mid, issues.get("CAV-7399")!)).stats.prs, 0, "a Jira with no record gives an empty checklist, not an error");
    // cached: the second read does not decode the stored inputs again
    startCount();
    await M.getItemChecklist(m.d, m.mid, id7346);
    assert.equal(stopCount().filter((q) => /^\s*select "inputs" from/i.test(q)).length, 0);
    await rejects(() => M.getItemChecklist(m.d, m.mid, randomUUID()), 404);
    await D.db.update(S.deliveryMovements).set({ inputs: null }).where(O.eq(S.deliveryMovements.id, m.mid));
    core.clearMovementCachesForTests();
    await assert.rejects(() => M.getItemChecklist(m.d, m.mid, id7346), (e: unknown) => (e as { status?: number }).status === 409 && codeOf(e) === "inputs_stale");
  });

  it("comment edits: live original (read-only), preview without saving, an edit changes the hash and resets sign-offs, survives refresh, goes stale on a Jira change, resets cleanly; only a manager, only in draft / ready / signed_off", async () => {
    const C = await import("./comments");
    const core = await import("./core");
    const { loadExportModel } = await import("../export/model");
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }, { key: "CAV-7399", comments: [noiseComment("10", Date.now())] }]);
    const m = await newMovement("edits", ["CAV-7346", "CAV-7399"], f);
    const id = issues.get("CAV-7346")!;
    const src = { source: f };

    // the comments, as Jira has them now
    const l0 = await C.listComments(m.d, m.mid, id, src);
    assert.equal(l0.comments.length, 3);
    assert.equal(l0.jiraAvailable, true);
    assert.ok(l0.comments.every((c) => c.original?.startsWith("DEPLOYMENT-RECORD") && c.edited === null && !c.stale && c.current));
    const kpi = l0.comments.find((c) => c.covers.includes("kpi-dashboard#267"))!;
    const text = kpi.original!;
    const edited = text.replace("KPI Dashboard - UI", "Edited Service Name");
    assert.notEqual(edited, text);

    // preview: nothing saved, small, plain; bad texts are 400
    const pv = await C.previewComment(m.d, m.mid, id, { commentId: kpi.commentId, text: edited }, admin);
    assert.equal(pv.preview.covers, 1);
    assert.ok(JSON.stringify(pv).length < 2000);
    assert.equal((await mvRow(m.mid)).commentEditsHash, null, "a preview saves nothing");
    await rejects(() => C.previewComment(m.d, m.mid, id, { commentId: kpi.commentId, text: edited }, ba), 403);
    await assert.rejects(
      () => C.previewComment(m.d, m.mid, id, { commentId: kpi.commentId, text: "no header line here, only some words about the release" }, admin),
      (e: unknown) => (e as { status?: number }).status === 400 && (e as { message: string }).message === "The text must keep the DEPLOYMENT-RECORD first line"
    );
    await rejects(() => C.previewComment(m.d, m.mid, id, { commentId: kpi.commentId, text: "short" }, admin), 400);
    await rejects(() => C.previewComment(m.d, m.mid, id, { commentId: kpi.commentId, text: "x".repeat(40001) }, admin), 400);
    await rejects(() => C.previewComment(m.d, m.mid, id, { commentId: "999999", text: edited }, admin), 404);
    await rejects(() => C.previewComment(m.d, m.mid, id, { commentId: kpi.commentId, text: edited.replace("kpi-dashboard#267", "kpi-dashboard#999") }, admin), 400); // other PRs

    // save: only a manager; the checklist changes and every sign-off goes
    const h0 = await signAll(m.d, m.mid);
    assert.equal((await mvRow(m.mid)).status, "signed_off");
    await rejects(() => C.saveComment(m.d, m.mid, id, { commentId: kpi.commentId, text: edited }, ba), 403);
    const saved = await C.saveComment(m.d, m.mid, id, { commentId: kpi.commentId, text: edited }, manager);
    assert.equal(saved.checklistChanged, true);
    assert.equal(saved.status, "ready");
    assert.notEqual(saved.hash, h0);
    assert.ok((await soOf(m.mid)).every((x) => x.h === null), "the edit reset every sign-off");
    assert.equal((await evOf(m.mid, "comment_edited")).length, 1);
    assert.equal((await evOf(m.mid, "checklist_changed")).length, 1);
    assert.ok((await mvRow(m.mid)).commentEditsHash);
    const view = await M.getMovementView(m.d, m.mid, admin);
    const it7346 = view.items.find((i) => i.key === "CAV-7346")!;
    assert.deepEqual([it7346.edited, it7346.editedCount, typeof it7346.editedBy], [true, 1, "string"]);
    assert.equal(view.items.find((i) => i.key === "CAV-7399")!.edited, false);
    // every reader sees the edited text: the checklist, the per-Jira checklist and the export
    const textIn = (x: unknown) => JSON.stringify(x).includes("Edited Service Name");
    assert.ok(textIn(await M.getChecklist(m.d, m.mid)));
    assert.ok(textIn(await M.getItemChecklist(m.d, m.mid, id)));
    assert.ok(textIn((await loadExportModel(m.d, m.mid)).checklist));
    const detail = await M.getItemDetail(m.d, m.mid, id);
    assert.ok(detail.comments.find((c) => c.commentId === kpi.commentId)!.edited);
    const c1 = (await C.listComments(m.d, m.mid, id, src)).comments.find((c) => c.commentId === kpi.commentId)!;
    assert.deepEqual([c1.edited, c1.original, c1.stale], [edited, text, false], "the original is still Jira's text; the edit is the overlay");
    assert.equal(f.issues.get("CAV-7346")!.comments!.length, 3, "Jira was only read");

    // the overlay survives a refresh and a no-op refresh changes nothing
    const hEdited = (await mvRow(m.mid)).checklistHash;
    assert.equal((await R.refreshMovement(m.mid, { ...m.deps, bypass: true })).ok, true);
    assert.equal((await mvRow(m.mid)).checklistHash, hEdited);
    assert.ok(textIn(await M.getChecklist(m.d, m.mid)));

    // Jira changes that comment after the edit: the edit is KEPT, marked stale, with a warning on the Jira
    const live = f.issues.get("CAV-7346")!.comments!.find((c) => c.id === kpi.commentId)!;
    live.updated = "2026-11-20T10:00:00.000+0000";
    assert.equal((await R.refreshMovement(m.mid, { ...m.deps, bypass: true })).ok, true);
    assert.ok(textIn(await M.getChecklist(m.d, m.mid)), "still applied");
    assert.ok(((await itemsOf(m.mid))["CAV-7346"].warnings as Array<{ code: string; message: string }>).some((w) => w.code === "comment_edit_stale" && w.message === "The Jira comment changed after the Flux edit: review it"));
    assert.equal((await C.listComments(m.d, m.mid, id, src)).comments.find((c) => c.commentId === kpi.commentId)!.stale, true);

    // reset: back to the Jira text and the checklist as it was; a non-manager cannot
    await rejects(() => C.resetComment(m.d, m.mid, id, kpi.commentId, ba), 403);
    await rejects(() => C.resetComment(m.d, m.mid, id, "424242", manager), 404);
    const reset = await C.resetComment(m.d, m.mid, id, kpi.commentId, manager);
    assert.equal(reset.checklistChanged, true);
    assert.equal(reset.hash, h0, "same content as before the edit, same hash");
    assert.ok(!textIn(await M.getChecklist(m.d, m.mid)));
    assert.equal((await mvRow(m.mid)).commentEditsHash, null);
    assert.equal((await evOf(m.mid, "comment_reset")).length, 1);
    core.clearMovementCachesForTests();

    // a running or finished movement is refused; so is the 201st edit
    const f2 = new FakeJira([{ key: "CAV-7346", comments: rec7346() }]);
    const g = await newMovement("edits2", ["CAV-7346"], f2);
    const gc = (await C.listComments(g.d, g.mid, id, { source: f2 })).comments.find((c) => c.covers.includes("kpi-dashboard#267"))!;
    const gt = gc.original!.replace("KPI Dashboard - UI", "Edited Service Name");
    await D.db.insert(S.deliveryMovementCommentEdits).values(Array.from({ length: 200 }, (_, i) => ({ movementId: g.mid, issueId: id, commentId: `x${i}`, editedText: "x".repeat(30), editedBy: E1 })));
    await assert.rejects(() => C.saveComment(g.d, g.mid, id, { commentId: gc.commentId, text: gt }, admin), (e: unknown) => (e as { status?: number }).status === 409 && codeOf(e) === "too_many_edits");
    await D.db.delete(S.deliveryMovementCommentEdits).where(O.eq(S.deliveryMovementCommentEdits.movementId, g.mid));
    await signAll(g.d, g.mid);
    await M.startMovement(g.d, g.mid, deployer);
    await rejects(() => C.saveComment(g.d, g.mid, id, { commentId: gc.commentId, text: gt }, admin), 409);
    await rejects(() => C.resetComment(g.d, g.mid, id, gc.commentId, admin), 409);
    await M.doneMovement(g.d, g.mid, {}, deployer);
    await rejects(() => C.saveComment(g.d, g.mid, id, { commentId: gc.commentId, text: gt }, admin), 409);
  });

  const FAKE_CFG = { apiKey: "k", model: "fake-model", baseUrl: "http://llm.invalid", effort: "low" };
  const aiOk = { state: "ok" as const, retryAt: null, message: null };
  const llmAnswer = (input: unknown) => ({ blocks: [{ type: "tool_use" as const, id: "t1", name: "submit_summary", input }], stopReason: "tool_use", inputTokens: 100, outputTokens: 20, model: "fake-model" });
  const goodAnswer = { headline: "Release looks fine for UAT", glance: [{ badge: "INFO", severity: "info", title: "Nothing blocks this movement", detail: "All records are present", jiras: [] }] };

  it("summary: deterministic by default; AI generation with a fake LLM is stored, cached by hash, rate limited, stale on a change, and every failure degrades to the rules summary", async () => {
    const { LlmError } = await import("@/lib/llm/minimax");
    const S2 = await import("./summary");
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }]);
    const m = await newMovement("sum", ["CAV-7346"], f);
    let calls = 0;
    const outcomes: Array<{ ok: boolean }> = [];
    let answer: () => unknown = () => llmAnswer(goodAnswer);
    const base = { cfg: FAKE_CFG, health: async () => aiOk, recordOutcome: async (o: { ok: boolean }) => void outcomes.push(o), llm: async () => { calls++; return answer() as never; } };
    const t0 = new Date();
    const at = (s: number) => ({ ...base, now: () => new Date(t0.getTime() + s * 1000) });

    // nothing stored yet: the deterministic summary, and the roll-up to render at once
    const v0 = await S2.getSummary(m.d, m.mid, { cfg: null });
    assert.deepEqual([v0.status, v0.summary.source, v0.source, v0.ai.available], ["none", "rules", "rules", false]);
    assert.match(v0.ai.reason ?? "", /not configured/);
    assert.equal(v0.rollup.environment, "uat");
    assert.ok(v0.summary.headline.length > 0 && v0.hash.length === 64);
    await rejects(() => S2.generateSummary(m.d, m.mid, ba, {}, at(0)), 403);

    // no key: rules row with a plain reason, no AI call, no attempt counted
    const noKey = await S2.generateSummary(m.d, m.mid, admin, {}, { ...at(0), cfg: null });
    assert.deepEqual([noKey.source, noKey.status, calls], ["rules", "rules_only", 0]);
    assert.match(noKey.note ?? "", /not configured/);
    // on hold: the same
    const hold = await S2.generateSummary(m.d, m.mid, admin, {}, { ...at(0), health: async () => ({ state: "paused" as const, retryAt: new Date(Date.now() + 600_000), message: "quota" }) });
    assert.match(hold.note ?? "", /on hold/);
    assert.equal(calls, 0);

    // the AI answers: stored, fresh, with the model, and the prompt is NOT stored
    const gen = await S2.generateSummary(m.d, m.mid, admin, {}, at(0));
    assert.deepEqual([gen.status, gen.source, gen.model, calls], ["fresh", "ai", "fake-model", 1]);
    assert.equal(gen.summary.source, "ai");
    assert.equal(gen.summary.headline, "Release looks fine for UAT");
    assert.deepEqual(outcomes, [{ ok: true }]);
    const row = (await D.db.select().from(S.deliveryMovementSummaries).where(O.eq(S.deliveryMovementSummaries.movementId, m.mid)))[0];
    assert.ok(Buffer.byteLength(JSON.stringify(row.body)) < 65536);
    assert.ok(!/Movement roll-up \(JSON\)|submit_summary/.test(JSON.stringify(row)), "no prompt, no raw model output in the row");
    assert.equal(row.inputHash?.length, 40);
    // the same checklist: no new call; force needs the 20 s gap
    assert.equal((await S2.generateSummary(m.d, m.mid, admin, {}, at(1))).status, "fresh");
    assert.equal(calls, 1, "cached by hash");
    await assert.rejects(() => S2.generateSummary(m.d, m.mid, admin, { force: true }, at(5)), (e: unknown) => (e as { status?: number }).status === 429 && codeOf(e) === "rate_limited");
    assert.equal(calls, 1);
    assert.equal((await S2.generateSummary(m.d, m.mid, admin, { force: true }, at(30))).status, "fresh");
    assert.equal(calls, 2);
    assert.equal((await S2.getSummary(m.d, m.mid, base)).status, "fresh");

    // a failure never replaces a good summary of this checklist, and never throws
    answer = () => {
      throw new LlmError("The AI service's quota or balance is used up: details", "quota");
    };
    const failed = await S2.generateSummary(m.d, m.mid, admin, { force: true }, at(60));
    assert.deepEqual([failed.summary.source, failed.status], ["ai", "fresh"]);
    assert.match(failed.note ?? "", /quota/);
    assert.ok(!/details/.test(failed.note ?? ""), "a fixed plain reason, not the provider's text");
    assert.equal(outcomes.at(-1)!.ok, false);

    // a change in the checklist makes it stale: the deterministic summary of TODAY's checklist is shown meanwhile
    await M.setIncluded(m.d, m.mid, [issues.get("CAV-7346")!], false, admin);
    const stale = await S2.getSummary(m.d, m.mid, base);
    assert.deepEqual([stale.status, stale.summary.source], ["stale", "rules"]);
    assert.notEqual(stale.hash, gen.hash);
    // an unusable answer degrades to the rules summary (a stale row is replaced by the rules row)
    answer = () => llmAnswer({ nothing: "useful" });
    const bad = await S2.generateSummary(m.d, m.mid, admin, {}, at(90));
    assert.deepEqual([bad.summary.source, bad.status], ["rules", "rules_only"]);
    assert.match(bad.note ?? "", /could not be used/);
    answer = () => {
      throw new Error("boom");
    };
    const boom = await S2.generateSummary(m.d, m.mid, admin, {}, at(120));
    assert.equal(boom.source, "rules");
    assert.match(boom.note ?? "", /could not be reached/);

    // the daily cap
    const day = t0.toISOString().slice(0, 10);
    await D.db.update(S.deliveryMovementSummaries).set({ attemptsDay: day, attemptsToday: 30, lastAttemptAt: new Date(0) }).where(O.eq(S.deliveryMovementSummaries.movementId, m.mid));
    answer = () => llmAnswer(goodAnswer);
    await assert.rejects(() => S2.generateSummary(m.d, m.mid, admin, {}, at(200)), (e: unknown) => (e as { status?: number; message?: string }).status === 429 && /30 generated summaries per day/.test((e as { message: string }).message));
    // only the two primary keys: no extra index on the new tables
    const idx = await D.db.execute(O.sql`select count(*)::int n from pg_indexes where tablename in ('delivery_movement_summaries','delivery_movement_comment_edits')`);
    assert.equal((idx.rows[0] as { n: number }).n, 2);
  });
});

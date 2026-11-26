/**
 * Integration test of the movement service against the DEV database (real Postgres, fake Jira,
 * fake GitHub). Runs only with MOVEMENT_DB_TESTS=1 so `pnpm test` stays DB-free:
 *
 *   MOVEMENT_DB_TESTS=1 ./node_modules/.bin/tsx --env-file=.env.local --test src/lib/movement/service/service.integration.test.ts
 *
 * Every row it creates carries a unique tag and is removed in `after` (also when a test fails).
 * Nothing is sent: the notifier is a recording spy. Jira is a FakeJira (the 7 real record
 * fixtures), GitHub is a head transport that answers nothing (Flux no longer looks PRs up).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { ByteLru } from "../cache";
import { FakeJira, fixtureComment, noiseComment, type FakeComment } from "../fake-jira";
import { approxBytes, type ParsedRecord } from "../record";
import type { IssueRecords } from "../records";
import type { JiraSource } from "../jira-source";
import type { RefreshOptions } from "./refresh";
import type { MovementActor } from "./types";

const RUN = process.env.MOVEMENT_DB_TESTS === "1";
const suite = RUN ? describe : describe.skip;

const TAG = `MVTEST-${randomUUID().slice(0, 8)}`;
const E1 = "dev+tctest@salescode.ai";
const E2 = "dev+tctest2@salescode.ai";
// Three more people (the four slots must be four different Flux users); `.invalid` can never be mailed.
const E3 = `${TAG.toLowerCase()}-lead@example.invalid`;
const E4 = `${TAG.toLowerCase()}-ba2@example.invalid`;
const E5 = `${TAG.toLowerCase()}-qa@example.invalid`;
const actor = (email: string, flags: Partial<Pick<MovementActor, "isManager" | "isAdmin">> = {}): MovementActor => ({
  id: email,
  email,
  name: email.split("@")[0],
  isManager: false,
  isAdmin: false,
  ...flags,
});
const admin = actor(E1, { isManager: true, isAdmin: true });
const manager = actor(E2, { isManager: true }); // a delivery manager who is not an admin
const deployer = actor(E1);
const ba = actor(E2);
const lead = actor(E3);
const qaLead = actor(E5);
const stranger = actor(`stranger-${TAG.toLowerCase()}@example.invalid`); // not a Flux user, not a signer
const SIGNERS = { deployer: { email: E1 }, ba: { email: E2 }, lead: { email: E3 }, qa_lead: { email: E5 } };

// ---- fakes -----------------------------------------------------------------------------------
const caches = () => ({
  recordCache: new ByteLru<string, ParsedRecord>({ maxBytes: 64_000_000, weigh: approxBytes }),
  resultCache: new ByteLru<string, IssueRecords>({ maxBytes: 8_000_000, ttlMs: 60_000, weigh: () => 1000 }),
});

/** A copy of a real comment with every text node rewritten (new key / PR numbers / id). */
function cloneComment(name: string, id: string, rewrite: (s: string) => string): FakeComment {
  const c = fixtureComment(name);
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk);
    if (n && typeof n === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n)) o[k] = k === "text" && typeof v === "string" ? rewrite(v) : walk(v);
      return o;
    }
    return n;
  };
  return { ...c, id, body: walk(c.body) };
}

// ---- statement counting ------------------------------------------------------------------------
let stmts: string[] | null = null;
/** While set, every statement records how many pool connections are checked out at that moment. */
let sampler: { max: number; pool: () => number } | null = null;
function startCount() {
  stmts = [];
}
function stopCount(): string[] {
  const out = stmts ?? [];
  stmts = null;
  return out;
}
const verb = (s: string) => /^\s*(\w+)/.exec(s)?.[1]?.toLowerCase() ?? "?";
const countVerbs = (list: string[]) => {
  const o: Record<string, number> = {};
  for (const s of list) o[verb(s)] = (o[verb(s)] ?? 0) + 1;
  return o;
};

suite("movement service (dev DB, fake Jira / GitHub)", () => {
  // loaded in `before` so a skipped run never touches the database
  let M: typeof import("./service");
  let R: typeof import("./refresh");
  let N: typeof import("./notify");
  let D: typeof import("@/lib/db");
  let S: typeof import("@/lib/db/schema");
  let O: typeof import("drizzle-orm");
  const created = { users: [] as string[], projectId: "", deliveryIds: [] as string[] };
  const calls: Array<{ kind: string; p: object }> = [];
  let origQuery: unknown;

  const issues = new Map<string, string>(); // jira key -> issue id
  let deliveryId = "";
  let movementId = "";
  let fake: FakeJira;
  let deps: RefreshOptions;

  const noHeads = { transport: async () => ({ data: {} }), tokens: new Map([["salescode-ai", "unused"]]) };
  const eventsOf = async (type?: string) =>
    (await D.db.select({ type: S.deliveryMovementEvents.type, detail: S.deliveryMovementEvents.detail }).from(S.deliveryMovementEvents).where(O.eq(S.deliveryMovementEvents.movementId, movementId)).orderBy(S.deliveryMovementEvents.at)).filter((e) => !type || e.type === type);
  const movement = async () => (await D.db.select().from(S.deliveryMovements).where(O.eq(S.deliveryMovements.id, movementId)))[0];
  const items = async () => Object.fromEntries((await D.db.select({ key: S.jiraIssues.jiraKey, r: S.deliveryMovementItems }).from(S.deliveryMovementItems).innerJoin(S.jiraIssues, O.eq(S.jiraIssues.id, S.deliveryMovementItems.issueId)).where(O.eq(S.deliveryMovementItems.movementId, movementId))).map((x) => [x.key, x.r]));
  const signoffs = async () => Object.fromEntries((await D.db.select().from(S.deliveryMovementSignoffs).where(O.eq(S.deliveryMovementSignoffs.movementId, movementId))).map((x) => [x.slot, x]));
  const rejects = async (fn: () => Promise<unknown>, status: number) => {
    await assert.rejects(fn, (e: unknown) => (e as { status?: number }).status === status, `expected HTTP ${status}`);
  };

  async function seedIssue(key: string, n: number, status = "Done") {
    const [i] = await D.db
      .insert(S.jiraIssues)
      .values({ projectId: created.projectId, jiraId: `${TAG}-${n}`, jiraKey: key, summary: `${TAG} ${key}`, status, issueType: "Task" })
      .returning({ id: S.jiraIssues.id });
    issues.set(key, i.id);
    return i.id;
  }
  async function seedDelivery(name: string, issueIds: string[]) {
    const [d] = await D.db.insert(S.deliveries).values({ projectId: created.projectId, name: `${TAG} ${name}`, deliveryDate: "2030-01-01", createdBy: E1 }).returning({ id: S.deliveries.id });
    created.deliveryIds.push(d.id);
    if (issueIds.length) await D.db.insert(S.deliveryItems).values(issueIds.map((issueId) => ({ deliveryId: d.id, issueId, addedBy: E1 })));
    return d.id;
  }

  before(async () => {
    D = await import("@/lib/db");
    S = await import("@/lib/db/schema");
    O = await import("drizzle-orm");
    M = await import("./service");
    R = await import("./refresh");
    N = await import("./notify");
    const pg = (await import("pg")).default;
    origQuery = pg.Client.prototype.query;
    const orig = pg.Client.prototype.query as (...a: unknown[]) => unknown;
    (pg.Client.prototype as unknown as { query: unknown }).query = function (this: unknown, ...a: unknown[]) {
      if (stmts) stmts.push(typeof a[0] === "string" ? a[0] : ((a[0] as { text?: string })?.text ?? ""));
      if (sampler) sampler.max = Math.max(sampler.max, sampler.pool());
      return orig.apply(this, a);
    };
    N.setMovementNotifier({
      notifySignerAssigned: (p) => void calls.push({ kind: "assigned", p }),
      notifyReset: (p) => void calls.push({ kind: "reset", p }),
      notifyReadyToDeploy: (p) => void calls.push({ kind: "ready", p }),
      notifyDone: (p) => void calls.push({ kind: "done", p }),
    });

    for (const email of [E1, E2, E3, E4, E5]) {
      const r = await D.db.insert(S.users).values({ id: email, email, role: "USER" }).onConflictDoNothing().returning({ id: S.users.id });
      if (r.length) created.users.push(email);
    }
    const [p] = await D.db
      .insert(S.jiraProjects)
      .values({ name: TAG, jiraBaseUrl: `https://${TAG.toLowerCase()}.invalid`, jiraProjectKey: "MVT", jiraEmail: "x@example.com", jiraApiToken: "not-a-real-token", webhookSecret: TAG, createdBy: E1 })
      .returning({ id: S.jiraProjects.id });
    created.projectId = p.id;
    await D.db.insert(S.projectStatusMappings).values({ projectId: p.id, rawStatus: "Done", canonicalStatus: "DONE" });
  });

  after(async () => {
    try {
      if (created.deliveryIds.length) await D.db.delete(S.deliveryMovements).where(O.inArray(S.deliveryMovements.deliveryId, created.deliveryIds));
      if (created.deliveryIds.length) await D.db.delete(S.deliveries).where(O.inArray(S.deliveries.id, created.deliveryIds));
      if (created.projectId) await D.db.delete(S.jiraProjects).where(O.eq(S.jiraProjects.id, created.projectId)); // cascades issues + mappings (+ their status history)
      if (created.users.length) await D.db.delete(S.users).where(O.inArray(S.users.id, created.users));
    } finally {
      const pg = (await import("pg")).default;
      (pg.Client.prototype as unknown as { query: unknown }).query = origQuery;
      N?.setMovementNotifier(null);
      await D.pool.end();
    }
  });

  it("create + first refresh: CAV-7346 ready and ticked, CAV-7304 (a record missing) and CAV-7399 (no record) blocked", async () => {
    const ids = [await seedIssue("CAV-7346", 1), await seedIssue("CAV-7304", 2), await seedIssue("CAV-7399", 3)];
    deliveryId = await seedDelivery("main", ids);
    fake = new FakeJira([
      { key: "CAV-7346", comments: [fixtureComment("CAV-7346-81399"), fixtureComment("CAV-7346-81400"), fixtureComment("CAV-7346-81421")] },
      // the record of channelkart-flutter#50 (81425) has NOT been posted yet
      { key: "CAV-7304", comments: [fixtureComment("CAV-7304-81422"), fixtureComment("CAV-7304-81423"), fixtureComment("CAV-7304-81424")] },
      { key: "CAV-7399", comments: [noiseComment("5", Date.now())] },
    ]);
    deps = { source: fake, github: { heads: noHeads }, loadOptions: caches() };

    await rejects(() => M.createMovement(deliveryId, "prod", SIGNERS, actor(E2), deps), 403); // not a manager
    await rejects(() => M.createMovement(deliveryId, "staging", SIGNERS, admin, deps), 400);
    await rejects(() => M.createMovement(deliveryId, "prod", { ...SIGNERS, lead: { email: "not-an-email" } }, admin, deps), 400);
    // S10: all four slots named, each a Flux user, and the 400 names the slot (one person may hold several slots: that is not refused)
    await rejects(() => M.createMovement(deliveryId, "prod", { deployer: SIGNERS.deployer, ba: SIGNERS.ba, lead: SIGNERS.lead }, admin, deps), 400); // no QA lead
    await assert.rejects(
      () => M.createMovement(deliveryId, "prod", { ...SIGNERS, ba: { email: `nobody-${TAG.toLowerCase()}@example.invalid` } }, admin, deps),
      (e: unknown) => (e as { status?: number; message?: string }).status === 400 && /BA/.test((e as { message: string }).message)
    );

    startCount();
    const out = await M.createMovement(deliveryId, "prod", SIGNERS, manager, deps);
    const used = stopCount();
    movementId = out.movementId;
    console.log("METRIC create+first refresh statements:", JSON.stringify(countVerbs(used)), "total", used.length, "jira calls", out.refresh.jiraCalls);

    assert.equal(out.refresh.ok, true, JSON.stringify(out.refresh));
    assert.deepEqual(out.refresh.items && { ready: out.refresh.items.ready, blocked: out.refresh.items.blocked, added: out.refresh.items.added }, { ready: 1, blocked: 2, added: 3 });
    assert.equal(out.refresh.inputsWritten, true);
    const m = await movement();
    assert.equal(m.status, "ready");
    assert.ok(m.checklistHash && m.inputsHash && m.refreshedAt);
    const it_ = await items();
    assert.deepEqual([it_["CAV-7346"].readiness, it_["CAV-7346"].included], ["ready", true]);
    assert.deepEqual([it_["CAV-7304"].readiness, it_["CAV-7304"].included], ["blocked", false]);
    assert.ok((it_["CAV-7304"].warnings as Array<{ code: string }>).some((w) => w.code === "sibling_no_record"), JSON.stringify(it_["CAV-7304"].warnings));
    const refs = it_["CAV-7346"].recordRefs as Array<{ commentId?: string }>;
    assert.ok(refs.length === 3 && refs[0].commentId, "pointers only");
    assert.deepEqual(await M.listMovements(deliveryId).then((l) => l.map((x) => [x.status, x.items, x.included])), [["ready", 3, 1]]);
    assert.deepEqual((await eventsOf()).map((e) => e.type), ["created", "became_ready", "items_changed"]);
    assert.equal(calls.filter((c) => c.kind === "assigned").length, 4);
    await assert.rejects(
      () => M.createMovement(deliveryId, "prod", SIGNERS, admin, deps), // one live movement per environment
      (e: { status?: number; code?: string; message?: string; extra?: Record<string, unknown> }) =>
        e.status === 409 && e.code === "movement_exists" && /already a live prod movement/.test(e.message ?? "") && e.extra?.existingStatus === "ready" && e.extra?.existingMovementId === movementId
    );
    const created2 = await M.createMovement(deliveryId, "demo", SIGNERS, admin, deps); // another environment is fine
    await M.cancelMovement(deliveryId, created2.movementId, "test", admin);
  });

  it("the view is built from the database only and carries no raw comments, no inputs blob, no secrets", async () => {
    const before_ = fake.calls;
    const v = await M.getMovementView(deliveryId, movementId, admin);
    assert.equal(fake.calls, before_, "no Jira call");
    const text = JSON.stringify(v);
    assert.ok(text.length < 40_000, `view is ${text.length} bytes`);
    assert.ok(!/DEPLOYMENT-RECORD|inputs|token/i.test(text.replace(/"inputsHash"/g, "")));
    assert.equal(v.checklist.hash, (await movement()).checklistHash);
    assert.equal(v.items.length, 3);
    assert.equal(v.signers.length, 4);
    const cl = await M.getChecklist(deliveryId, movementId);
    assert.equal(cl.sections.length, 14);
    assert.equal(cl.hash, v.checklist.hash);

    // the additions the UI relies on (the old fields are all still there)
    assert.deepEqual([v.me.email, v.me.isAdmin, v.me.slots], [E1, true, ["deployer"]]);
    assert.deepEqual([v.refreshing, v.needsRefresh, v.refreshError], [false, false, null]);
    assert.ok(Math.abs(Date.parse(v.serverNow) - Date.now()) < 60_000);
    assert.equal(v.permissions.changes, true, "E1 holds a slot");
    assert.equal((await M.getMovementView(deliveryId, movementId, manager)).permissions.changes, true, "E2 is the BA");
    assert.equal((await M.getMovementView(deliveryId, movementId, stranger)).permissions.changes, false);
    const i7346 = v.items.find((i) => i.key === "CAV-7346")!;
    assert.deepEqual([i7346.included, i7346.ticked, i7346.tickSet, i7346.recordCount, i7346.repos], [true, true, false, 3, ["channelkart", "channelkart-flutter", "kpi-dashboard"]]);
    assert.deepEqual(i7346.signoffs, { dev: null, tester: null });
    const i7304 = v.items.find((i) => i.key === "CAV-7304")!;
    assert.ok(i7304.blockers.length > 0 && i7304.blockers.every((b) => b.severity === "blocker"));
    assert.equal("warnings" in i7304, false, "the combined list is not repeated in the view");
    assert.equal(i7304.warningsMore, 0);

    // lazy per-PR detail: no raw comment text
    const detail = await M.getItemDetail(deliveryId, movementId, issues.get("CAV-7346")!);
    assert.equal(detail.prs.length, 3);
    assert.deepEqual(detail.prs.map((p) => p.prKey).sort(), ["channelkart#1184", "channelkart-flutter#49", "kpi-dashboard#267"]);
    assert.ok(detail.prs.every((p) => p.commentId && p.status && typeof p.unknowns === "number"));
    assert.ok(!/lorem|DEPLOYMENT-RECORD v1/.test(JSON.stringify(detail)));
    await rejects(() => M.getItemDetail(deliveryId, movementId, randomUUID()), 404);

    // event history pages: every event exactly once
    const all = (await eventsOf()).length;
    const seen: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 20; page++) {
      const r: { events: Array<{ id: string }>; nextBefore: string | null } = await M.listEvents(deliveryId, movementId, { limit: 2, before: before ?? undefined });
      assert.ok(r.events.length <= 2);
      seen.push(...r.events.map((e) => e.id));
      if (!r.nextBefore) break;
      before = r.nextBefore;
    }
    assert.equal(seen.length, all);
    assert.equal(new Set(seen).size, all, "no event repeated");
    assert.equal((await M.listEvents(deliveryId, movementId, { limit: 1000 })).events.length, Math.min(all, 50));
    await rejects(() => M.listEvents(deliveryId, movementId, { before: "yesterday" }), 400);
  });

  it("tick/untick: a blocked Jira needs an override first; ticking changes the hash; non-managers cannot edit", async () => {
    const h0 = (await movement()).checklistHash;
    await rejects(() => M.setIncluded(deliveryId, movementId, [issues.get("CAV-7304")], true, admin), 409);
    await rejects(() => M.setIncluded(deliveryId, movementId, [issues.get("CAV-7346")], false, ba), 403);
    await rejects(() => M.setIncluded(deliveryId, movementId, [randomUUID()], true, admin), 404);
    const off = await M.setIncluded(deliveryId, movementId, [issues.get("CAV-7346")], false, admin);
    assert.equal(off.changed, 1);
    assert.notEqual(off.hash, h0);
    assert.equal((await M.setIncluded(deliveryId, movementId, [issues.get("CAV-7346")], false, admin)).changed, 0, "idempotent");
    const on = await M.setIncluded(deliveryId, movementId, [issues.get("CAV-7346")], true, admin);
    assert.equal(on.hash, h0, "same selection, same hash");
    assert.equal((await items())["CAV-7346"].tickSet, true, "a person's choice is remembered");
  });

  it("override: ADMIN only, reason mandatory; an override survives a refresh while the Jira is still blocked", async () => {
    const id = issues.get("CAV-7304")!;
    await rejects(() => M.overrideItem(deliveryId, movementId, id, "release owner accepted the gap", manager), 403);
    await rejects(() => M.overrideItem(deliveryId, movementId, id, "no", admin), 400);
    await M.overrideItem(deliveryId, movementId, id, "release owner accepted the gap", admin);
    await rejects(() => M.overrideItem(deliveryId, movementId, id, "release owner accepted the gap", admin), 409);
    assert.equal((await items())["CAV-7304"].readiness, "override");
    await M.setIncluded(deliveryId, movementId, [id], true, admin);
    const r = await R.refreshMovement(movementId, { ...deps, bypass: true });
    assert.equal(r.ok, true);
    const row_ = (await items())["CAV-7304"];
    assert.deepEqual([row_.readiness, row_.included, row_.overrideReason], ["override", true, "release owner accepted the gap"]);
    // revoke goes back to blocked and unticks it; override again for the rest of the flow
    await rejects(() => M.revokeOverride(deliveryId, movementId, id, "", admin), 400);
    const rv = await M.revokeOverride(deliveryId, movementId, id, "revoked to test it", admin);
    assert.deepEqual([rv.readiness, rv.included], ["blocked", false]);
    assert.equal((await items())["CAV-7304"].overrideReason, null);
    await M.overrideItem(deliveryId, movementId, id, "release owner accepted the gap", admin, true); // override + tick in one step
    const ov = (await items())["CAV-7304"];
    assert.deepEqual([ov.readiness, ov.included, ov.tickSet], ["override", true, true]);
  });

  it("branches: validated (pattern, affected or tracked repo, one per repo); a pick changes the hash and is searchable", async () => {
    const info = await M.listAffectedRepos(deliveryId, movementId);
    assert.deepEqual(info.affected.map((a) => a.repo), ["channelkart", "channelkart-flutter", "kpi-dashboard", "salescode-auth-service"]);
    assert.ok(info.affected.every((a) => a.heldOnly === false));
    await rejects(() => M.saveBranches(deliveryId, movementId, [{ repo: "channelkart", branch: "bad branch" }], admin), 400);
    await rejects(() => M.saveBranches(deliveryId, movementId, [{ repo: "channelkart", branch: "a" }, { repo: "channelkart", branch: "b" }], admin), 400);
    await rejects(() => M.saveBranches(deliveryId, movementId, [{ repo: `not-a-repo-${TAG}`, branch: "main" }], admin), 400);
    await rejects(() => M.saveBranches(deliveryId, movementId, [{ repo: "channelkart", branch: "main" }], ba), 403);
    const h0 = (await movement()).checklistHash;
    const saved = await M.saveBranches(deliveryId, movementId, [{ repo: "channelkart", branch: "prod_blue_20261119" }], admin);
    assert.equal(saved.changed, true);
    assert.notEqual(saved.hash, h0);
    assert.equal((await M.saveBranches(deliveryId, movementId, [{ repo: "channelkart", branch: "prod_blue_20261119" }], admin)).changed, false);
    await M.saveBranches(deliveryId, movementId, [], admin);
    assert.equal((await movement()).checklistHash, h0);
    // searching needs a TRACKED repo: an affected repo Flux does not track reports searched:false instead of guessing an owner
    const res = await M.searchBranches(deliveryId, movementId, "channelkart", "prod", admin, { searchBranches: async () => Array.from({ length: 80 }, (_, i) => `prod_${i}`) });
    if (res.searched) assert.equal(res.branches.length, 50);
    for (const q of ["x".repeat(101), "a b", "a/../b", "..", "a//b", "/abs", "prod_*", "a;b"]) await rejects(() => M.searchBranches(deliveryId, movementId, "channelkart", q, admin), 400);
    await rejects(() => M.searchBranches(deliveryId, movementId, "channelkart", "prod", ba), 403); // managers only (it spends the org's rate limit)
    await rejects(() => M.saveBranches(deliveryId, movementId, [{ repo: "channelkart", branch: "prod_*" }], admin), 400); // no wildcard picks
  });

  it("sign-off: only the named user; a stale hash is a 409 with the new hash; all three at the current hash = signed_off", async () => {
    const hash = (await movement()).checklistHash!;
    await rejects(() => M.signMovement(deliveryId, movementId, "ba", hash, admin), 403); // an admin is not the BA
    await rejects(() => M.signMovement(deliveryId, movementId, "ba", hash, deployer), 403);
    await assert.rejects(
      () => M.signMovement(deliveryId, movementId, "ba", "0".repeat(64), ba),
      (e: unknown) => (e as { status?: number; extra?: { currentHash?: string } }).status === 409 && (e as { extra?: { currentHash?: string } }).extra?.currentHash === hash
    );
    assert.equal((await M.signMovement(deliveryId, movementId, "deployer", hash, deployer)).allSigned, false);
    assert.equal((await M.signMovement(deliveryId, movementId, "deployer", hash, deployer)).allSigned, false, "idempotent");
    await M.signMovement(deliveryId, movementId, "ba", hash, ba);
    const third = await M.signMovement(deliveryId, movementId, "lead", hash, lead);
    assert.deepEqual([third.status, third.allSigned], ["ready", false], "the QA lead has not signed yet");
    await rejects(() => M.signMovement(deliveryId, movementId, "qa_lead", hash, lead), 403); // only the QA lead signs as the QA lead
    const last = await M.signMovement(deliveryId, movementId, "qa_lead", hash, qaLead);
    assert.deepEqual([last.status, last.allSigned], ["signed_off", true]);
    assert.equal((await movement()).status, "signed_off");
    assert.equal(calls.filter((c) => c.kind === "ready").length, 1);
    const snaps = await D.db.select({ hash: S.deliveryMovementSnapshots.hash, reason: S.deliveryMovementSnapshots.reason }).from(S.deliveryMovementSnapshots).where(O.eq(S.deliveryMovementSnapshots.movementId, movementId));
    assert.deepEqual(snaps, [{ hash, reason: "signoff" }], "one snapshot per hash, however many sign-offs");
    await rejects(() => M.setSigners(deliveryId, movementId, { lead: { email: E4 } }, admin), 409); // fixed once signed off
    await rejects(() => M.startMovement(deliveryId, movementId, ba), 403);
  });

  it("a changed record resets every sign-off (event with a capped diff, notification, snapshot kept), the override clears when the record becomes valid", async () => {
    const hash = (await movement()).checklistHash!;
    fake.issues.get("CAV-7304")!.comments!.push(fixtureComment("CAV-7304-81425")); // the missing record is posted
    const resets = calls.filter((c) => c.kind === "reset").length;
    const r = await R.refreshMovement(movementId, { ...deps, bypass: true });
    assert.equal(r.ok, true);
    assert.equal(r.movementStatus, "ready");
    assert.notEqual(r.hash, hash);
    const so = await signoffs();
    for (const s of ["deployer", "ba", "lead", "qa_lead"]) assert.deepEqual([so[s].signedAt, so[s].signedHash], [null, null]);
    const row_ = (await items())["CAV-7304"];
    assert.deepEqual([row_.readiness, row_.overrideReason, row_.included], ["ready", null, true], "valid record: override dropped, still ticked");
    const ev = (await eventsOf("checklist_changed")).at(-1)!;
    const d = ev.detail as { cleared: number; diff: { counts: { added: number } } };
    assert.equal(d.cleared, 4);
    assert.ok(JSON.stringify(ev.detail).length <= 4096 && d.diff.counts.added > 0, "capped diff");
    assert.equal(calls.filter((c) => c.kind === "reset").length, resets + 1);
    assert.equal((await eventsOf("items_changed")).at(-1) && true, true);

    // what changed since the deployer signed: the FULL diff against the stored snapshot
    const ch = await M.getChangesSinceSigned(deliveryId, movementId, deployer);
    assert.equal(ch.signedHash, hash);
    assert.equal(ch.unchanged, false);
    assert.ok(ch.diff && ch.diff.counts.added + ch.diff.counts.changed + ch.diff.counts.removed > 0 && ch.diff.truncated === 0);
    await rejects(() => M.getChangesSinceSigned(deliveryId, movementId, actor("someone-else@salescode.ai")), 403);
    // a stale sign-off is refused now
    await assert.rejects(() => M.signMovement(deliveryId, movementId, "ba", hash, ba), (e: unknown) => (e as { status?: number }).status === 409);

    // N5: when the stored hash is found out of date at sign time, the reset event still carries the real diff
    // (taken from the snapshot of the old hash), not an empty one
    const current = (await movement()).checklistHash!;
    await D.db.update(S.deliveryMovements).set({ checklistHash: hash }).where(O.eq(S.deliveryMovements.id, movementId));
    const n0 = (await eventsOf("checklist_changed")).length;
    await M.signMovement(deliveryId, movementId, "ba", current, ba);
    const evs = await eventsOf("checklist_changed");
    assert.equal(evs.length, n0 + 1);
    const d2 = evs.at(-1)!.detail as { counts: { added: number; changed: number; removed: number } };
    assert.ok(d2.counts.added + d2.counts.changed + d2.counts.removed > 0, "real counts, not zeros");
  });

  it("a refresh that finds nothing writes ONE tiny update; the inputs blob and the items are not rewritten", async () => {
    const before_ = await movement();
    startCount();
    const r = await R.refreshMovement(movementId, { ...deps, bypass: true });
    const used = stopCount();
    console.log("METRIC no-op refresh statements:", JSON.stringify(countVerbs(used)), "total", used.length);
    assert.equal(r.ok, true);
    assert.equal(r.changed, false);
    assert.equal(r.inputsWritten, false);
    const writes = used.filter((s) => /^\s*(insert|update|delete)/i.test(s));
    assert.equal(writes.length, 1, writes.join("\n"));
    assert.match(writes[0], /^update "delivery_movements" set "refreshed_at" = \$1 where/i);
    assert.ok(!/"inputs"/.test(writes[0]));
    const after_ = await movement();
    assert.equal(after_.updatedAt.getTime(), before_.updatedAt.getTime(), "updated_at only on a real change");
    assert.ok(after_.refreshedAt!.getTime() > before_.refreshedAt!.getTime());
    assert.equal(after_.inputsHash, before_.inputsHash);
    assert.equal(after_.checklistHash, before_.checklistHash);
    const n = (await eventsOf()).length;
    await R.refreshMovement(movementId, { ...deps, bypass: true });
    assert.equal((await eventsOf()).length, n, "no event on a no-op");
    // the 10 s rule and the lock
    assert.equal((await R.refreshMovement(movementId, deps)).skipped, "recent");
    const lockHeld = await D.db.transaction(async (tx) => {
      await tx.execute(O.sql`select pg_advisory_xact_lock(hashtextextended(${movementId}, 0))`);
      return R.refreshMovement(movementId, { ...deps, bypass: true }); // another connection: the lock is held
    });
    assert.deepEqual(lockHeld, { refreshing: true });
  });

  it("a failing Jira changes nothing on an existing Jira but a re-check warning (readiness, tick, records, hash stay); recovery clears it", async () => {
    const before_ = await movement();
    const refsBefore = (await items())["CAV-7346"].recordRefs;
    const evBefore = (await eventsOf()).length;
    fake.failCommentsFor.add("CAV-7346");
    fake.failSearchWhen = () => true;
    const r = await R.refreshMovement(movementId, { ...deps, bypass: true });
    fake.failCommentsFor.clear();
    fake.failSearchWhen = undefined;
    assert.equal(r.ok, true, JSON.stringify(r));
    const row_ = (await items())["CAV-7346"];
    assert.equal(row_.readiness, "ready", "an outage is not a content change");
    assert.equal(row_.included, true);
    assert.deepEqual(row_.recordRefs, refsBefore, "pointers kept");
    const warn = row_.warnings as Array<{ code: string; message: string }>;
    assert.equal(warn.filter((w) => w.code === "recheck_failed").length, 1);
    assert.ok(!JSON.stringify(warn).match(/simulated|503|failed \(/), "nothing internal in the stored warnings");
    const m = await movement();
    assert.equal(m.inputsHash, before_.inputsHash, "stored inputs were not touched");
    assert.equal(m.checklistHash, before_.checklistHash, "the hash did not move");
    assert.equal((await eventsOf()).length, evBefore, "no event");
    assert.ok((await M.getChecklist(deliveryId, movementId)).scope.jiras.some((j) => j.jira === "CAV-7346"));
    // the view says so, and does not block signing on it
    const dv = await M.getMovementView(deliveryId, movementId, deployer);
    assert.equal(dv.degradedCount, 3, "the whole search was down, so all three Jiras of the movement");
    assert.deepEqual([dv.degraded.count, typeof dv.degraded.since], [3, "string"]);
    assert.match(dv.checklist.summary, /3 Jiras could not be re-checked since /);
    assert.equal(dv.permissions.notes.length, 1);
    assert.deepEqual(dv.permissions.sign, ["deployer"], "signing is not blocked by an outage");
    // recovery
    const back = await R.refreshMovement(movementId, { ...deps, bypass: true });
    assert.equal(back.ok, true);
    const rec = (await items())["CAV-7346"];
    assert.equal(rec.readiness, "ready");
    assert.ok(!(rec.warnings as Array<{ code: string }>).some((w) => w.code === "recheck_failed"));
    assert.equal((await movement()).checklistHash, before_.checklistHash);
  });

  it("sign again -> start; a record changing while in progress does NOT reset (changed_after_start) -> done -> propose/confirm statuses", async () => {
    let hash = (await movement()).checklistHash!;
    await M.signMovement(deliveryId, movementId, "deployer", hash, deployer);
    await M.signMovement(deliveryId, movementId, "ba", hash, ba);
    await M.signMovement(deliveryId, movementId, "lead", hash, lead);
    await M.signMovement(deliveryId, movementId, "qa_lead", hash, qaLead);
    assert.equal((await movement()).status, "signed_off");
    await rejects(() => M.startMovement(deliveryId, movementId, ba), 403);
    await rejects(() => M.startMovement(deliveryId, movementId, manager), 403); // a manager who is not the deployer
    const started = await M.startMovement(deliveryId, movementId, deployer);
    assert.equal(started.status, "in_progress");
    await rejects(() => M.signMovement(deliveryId, movementId, "ba", hash, ba), 409);
    await rejects(() => M.setIncluded(deliveryId, movementId, [issues.get("CAV-7346")], false, admin), 409);

    // a NEW record appears on the Jira while the deployment is under way
    const extra = cloneComment("CAV-7346-81399", "999001", (s) => s.replace(/1184/g, "1190"));
    fake.issues.get("CAV-7346")!.comments!.push(extra);
    const resets = calls.filter((c) => c.kind === "reset").length;
    const r = await R.refreshMovement(movementId, { ...deps, bypass: true });
    assert.equal(r.ok, true);
    assert.equal(r.movementStatus, "in_progress");
    assert.notEqual(r.hash, hash);
    for (const s of Object.values(await signoffs())) assert.equal(s.signedHash, hash, "sign-offs untouched while in progress");
    const ev = await eventsOf("changed_after_start");
    assert.equal(ev.length, 1);
    const last = calls.filter((c) => c.kind === "reset");
    assert.equal(last.length, resets + 1);
    assert.equal((last.at(-1)!.p as { changedAfterStart: boolean }).changedAfterStart, true);
    assert.equal((await M.getMovementView(deliveryId, movementId, deployer)).movement.changedAfterStart, true);
    await R.refreshMovement(movementId, { ...deps, bypass: true });
    assert.equal((await eventsOf("changed_after_start")).length, 1, "the same change never notifies twice");

    await rejects(() => M.doneMovement(deliveryId, movementId, {}, ba), 403);
    await rejects(() => M.doneMovement(deliveryId, movementId, { results: [{ issueId: issues.get("CAV-7399")!, result: "moved" }] }, deployer), 400); // never ticked
    await rejects(() => M.doneMovement(deliveryId, movementId, {}, actor(`x-${TAG.toLowerCase()}@example.invalid`)), 403); // a plain user who is not the deployer
    await rejects(() => M.startMovement(deliveryId, movementId, actor(`x-${TAG.toLowerCase()}@example.invalid`)), 403);
    assert.equal((await M.startMovement(deliveryId, movementId, deployer)).alreadyStarted, true, "start is idempotent");
    const done = await M.doneMovement(deliveryId, movementId, { comment: "all went well" }, deployer);
    assert.deepEqual([done.status, done.moved, done.held], ["done", 2, 1]);
    const again = await M.doneMovement(deliveryId, movementId, { comment: "double click" }, deployer);
    assert.deepEqual([again.status, again.moved, again.held, again.alreadyDone], ["done", 2, 1, true], "done is idempotent");
    assert.equal((await eventsOf("done")).length, 1);
    assert.equal((await movement()).status, "done");
    assert.equal((await items())["CAV-7399"].result, "held");
    assert.equal(calls.filter((c) => c.kind === "done").length, 1);
    // frozen
    assert.equal((await R.refreshMovement(movementId, { ...deps, bypass: true })).skipped, "frozen");
    await rejects(() => M.cancelMovement(deliveryId, movementId, "x", admin), 409);
    await rejects(() => M.setIncluded(deliveryId, movementId, [issues.get("CAV-7346")], false, admin), 409);

    const snaps = await D.db.select({ hash: S.deliveryMovementSnapshots.hash }).from(S.deliveryMovementSnapshots).where(O.eq(S.deliveryMovementSnapshots.movementId, movementId));
    assert.ok(snaps.length >= 3, "signoff, start and done snapshots (deduped by hash)");

    // propose
    hash = "";
    const p = await M.proposeStatuses(deliveryId, movementId);
    const by = Object.fromEntries(p.proposals.map((x) => [x.key, x]));
    assert.deepEqual([by["CAV-7346"].to, by["CAV-7304"].to, by["CAV-7399"].to], ["delivered", "delivered", "not_delivered"]);
    assert.equal(p.note, null);
    assert.match(by["CAV-7399"].reason, /Not moved to prod \(not selected\)/);
    await rejects(() => M.confirmStatuses(deliveryId, movementId, undefined, ba, { gates: async () => ({ blocked: false }) }), 403);
    await rejects(() => M.confirmStatuses(deliveryId, movementId, [randomUUID()], deployer, { gates: async () => ({ blocked: false }) }), 400); // unknown ids are an error, not ignored
    // S6: a Jira already delivered (through another delivery) is never taken back
    await D.db.update(S.deliveryItems).set({ status: "delivered" }).where(O.and(O.eq(S.deliveryItems.deliveryId, deliveryId), O.eq(S.deliveryItems.issueId, issues.get("CAV-7399")!)));
    const p2 = await M.proposeStatuses(deliveryId, movementId);
    assert.equal(p2.proposals.find((x) => x.key === "CAV-7399")!.skipReason, "already delivered");
    startCount();
    // The real gate reads a feature flag through Next's cache (not available here); the DONE-status rule is kept.
    const { isIssueDone } = await import("@/lib/deliveries/entries");
    const gates = async (a: { issueId: string; toStatus: string }) => (a.toStatus !== "pending" && !(await isIssueDone(a.issueId)) ? { blocked: true as const, message: "not DONE" } : { blocked: false as const });
    const c1 = await M.confirmStatuses(deliveryId, movementId, undefined, deployer, { gates });
    const used = stopCount();
    assert.deepEqual(c1.counts, { updated: 2, unchanged: 0, skipped: 1 }, JSON.stringify(c1.results));
    assert.equal(c1.results.find((x) => x.key === "CAV-7399")!.reason, "already delivered");
    const status = async () => Object.fromEntries((await D.db.select({ key: S.jiraIssues.jiraKey, s: S.deliveryItems.status }).from(S.deliveryItems).innerJoin(S.jiraIssues, O.eq(S.jiraIssues.id, S.deliveryItems.issueId)).where(O.eq(S.deliveryItems.deliveryId, deliveryId))).map((x) => [x.key, x.s]));
    assert.deepEqual(await status(), { "CAV-7346": "delivered", "CAV-7304": "delivered", "CAV-7399": "delivered" });
    const hist = await D.db.select({ id: S.deliveryStatusHistory.id, to: S.deliveryStatusHistory.toStatus, by: S.deliveryStatusHistory.changedBy }).from(S.deliveryStatusHistory).where(O.inArray(S.deliveryStatusHistory.issueId, [...issues.values()]));
    assert.equal(hist.length, 2);
    assert.ok(hist.every((h) => h.by === E1));
    // idempotent: a second confirm writes nothing
    const c2 = await M.confirmStatuses(deliveryId, movementId, undefined, deployer, { gates });
    assert.deepEqual(c2.counts, { updated: 0, unchanged: 2, skipped: 1 });
    assert.equal((await D.db.select({ id: S.deliveryStatusHistory.id }).from(S.deliveryStatusHistory).where(O.inArray(S.deliveryStatusHistory.issueId, [...issues.values()]))).length, 2);
    // an item removed from the delivery is left alone
    assert.ok(used.length > 0);
    // a new movement can be created for the same environment only once this one is cancelled: done stays live
    await assert.rejects(
      () => M.createMovement(deliveryId, "prod", SIGNERS, admin, deps),
      (e: { status?: number; code?: string; message?: string; extra?: Record<string, unknown> }) =>
        e.status === 409 &&
        e.code === "movement_exists" &&
        e.message === "This delivery already has a finished prod movement. Move the Jiras that were held to another delivery (Migrate) and start a new movement there." &&
        e.extra?.existingStatus === "done" &&
        e.extra?.existingMovementId === movementId
    );
  });

  it("cancel frees the environment; signers can change before sign-off (the slot loses its sign-off)", async () => {
    const d2 = await seedDelivery("second", [issues.get("CAV-7346")!]);
    const out = await M.createMovement(d2, "uat", SIGNERS, admin, deps);
    assert.equal(out.refresh.ok, true);
    const mid = out.movementId;
    const h = (await M.getMovementView(d2, mid, admin)).movement.hash;
    await M.signMovement(d2, mid, "ba", h, ba);
    const calls0 = calls.filter((c) => c.kind === "assigned").length;
    // one person may hold two slots (here the deployer is also the BA); the other signers keep their sign-off
    assert.equal((await M.setSigners(d2, mid, { ba: { email: E1 } }, manager)).changed, true);
    assert.deepEqual((await M.getMovementView(d2, mid, deployer)).me.slots, ["deployer", "ba"], "E1 now holds two slots");
    const calls1 = calls.filter((c) => c.kind === "assigned").length;
    assert.equal(calls1, calls0 + 1);
    // E1 signs one of its slots; the other is still open for E1
    await M.signMovement(d2, mid, "ba", h, deployer);
    assert.deepEqual((await M.getMovementView(d2, mid, deployer)).permissions.sign, ["deployer"]);
    await rejects(() => M.setSigners(d2, mid, { ba: { email: `ghost-${TAG.toLowerCase()}@example.invalid` } }, manager), 400);
    const ch = await M.setSigners(d2, mid, { ba: { email: E4, name: "New BA" } }, manager);
    assert.equal(ch.changed, true);
    assert.equal(calls.filter((c) => c.kind === "assigned").length, calls1 + 1);
    const v = await M.getMovementView(d2, mid, admin);
    assert.deepEqual(v.signers.map((s) => [s.slot, s.email, s.signed]), [["deployer", E1, false], ["ba", E4, false], ["lead", E3, false], ["qa_lead", E5, false]]);
    // the person who was the BA can no longer sign that slot
    await rejects(() => M.signMovement(d2, mid, "ba", h, ba), 403);
    await rejects(() => M.cancelMovement(d2, mid, "x", ba), 403);
    await M.cancelMovement(d2, mid, "wrong environment", manager);
    await M.createMovement(d2, "uat", SIGNERS, admin, deps); // allowed again
    await rejects(() => M.getMovementView(deliveryId, mid, admin), 404); // wrong delivery
  });

  // ---- helpers for the focused tests below (each builds its own small delivery + movement) -----------
  const rec7346 = () => [fixtureComment("CAV-7346-81399"), fixtureComment("CAV-7346-81400"), fixtureComment("CAV-7346-81421")];
  const depsFor = (f: JiraSource | FakeJira): RefreshOptions => ({ source: f, github: { heads: noHeads }, loadOptions: caches() });
  async function newMovement(name: string, keys: string[], f: JiraSource | FakeJira, env: "demo" | "uat" | "prod" = "uat") {
    const d = await seedDelivery(name, keys.map((k) => issues.get(k)!));
    const dp = depsFor(f);
    const out = await M.createMovement(d, env, SIGNERS, admin, dp);
    assert.equal(out.refresh.ok, true, JSON.stringify(out.refresh));
    return { d, mid: out.movementId, deps: dp };
  }
  const mvRow = async (mid: string) => (await D.db.select().from(S.deliveryMovements).where(O.eq(S.deliveryMovements.id, mid)))[0];
  const evOf = async (mid: string, type?: string) => (await D.db.select({ type: S.deliveryMovementEvents.type, detail: S.deliveryMovementEvents.detail }).from(S.deliveryMovementEvents).where(O.eq(S.deliveryMovementEvents.movementId, mid)).orderBy(S.deliveryMovementEvents.at)).filter((e) => !type || e.type === type);
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
  const codeOf = (e: unknown) => (e as { code?: string }).code;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("an outage on a signed-off or running movement changes nothing (no reset, no event, no mail); recovery changes nothing either", async () => {
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }]);
    const m = await newMovement("outage", ["CAV-7346"], f);
    const h = await signAll(m.d, m.mid);
    assert.equal((await mvRow(m.mid)).status, "signed_off");
    const state = async () => ({ mv: (({ status, checklistHash, inputsHash }) => ({ status, checklistHash, inputsHash }))(await mvRow(m.mid)), so: await soOf(m.mid), ev: (await evOf(m.mid)).map((e) => e.type), resets: calls.filter((c) => c.kind === "reset").length });
    const outage = async () => {
      f.failCommentsFor.add("CAV-7346");
      f.failSearchWhen = () => true;
      try {
        return await R.refreshMovement(m.mid, { ...m.deps, bypass: true });
      } finally {
        f.failCommentsFor.clear();
        f.failSearchWhen = undefined;
      }
    };
    for (const phase of ["signed_off", "in_progress"] as const) {
      if (phase === "in_progress") await M.startMovement(m.d, m.mid, deployer);
      const s0 = await state();
      assert.equal(s0.mv.status, phase);
      const r = await outage();
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(await state(), s0, `${phase}: nothing moved during the outage`);
      assert.ok(((await itemsOf(m.mid))["CAV-7346"].warnings as Array<{ code: string }>).some((w) => w.code === "recheck_failed"));
      assert.equal((await R.refreshMovement(m.mid, { ...m.deps, bypass: true })).ok, true);
      assert.deepEqual(await state(), s0, `${phase}: nor did the recovery`);
      assert.ok(!((await itemsOf(m.mid))["CAV-7346"].warnings as Array<{ code: string }>).some((w) => w.code === "recheck_failed"));
      assert.ok((await soOf(m.mid)).every((x) => x.h === h));
    }
    assert.equal((await evOf(m.mid, "changed_after_start")).length, 0);
    assert.equal((await evOf(m.mid, "checklist_changed")).length, 0);
  });

  it("unreadable stored inputs fail closed: 409 inputs_stale, needsRefresh, the hash is not overwritten; a refresh repairs it; a done movement reads its snapshot", async () => {
    const { gzipSync } = await import("node:zlib");
    const core = await import("./core");
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }]);
    const m = await newMovement("stale", ["CAV-7346"], f);
    const h = await hashOf(m.d, m.mid);
    const bads: Array<[string, Buffer | null]> = [["missing", null], ["corrupt", Buffer.from("not gzip at all")], ["older version", gzipSync('{"version":999,"items":[]}')]];
    for (const [label, bad] of bads) {
      await D.db.update(S.deliveryMovements).set({ inputs: bad }).where(O.eq(S.deliveryMovements.id, m.mid));
      core.checklistCacheForTests.clear();
      const v = await M.getMovementView(m.d, m.mid, admin);
      assert.equal(v.needsRefresh, true, label);
      assert.deepEqual([v.permissions.sign, v.permissions.start, v.permissions.edit], [[], false, false], label);
      for (const call of [
        () => M.signMovement(m.d, m.mid, "deployer", h, deployer),
        () => M.getChecklist(m.d, m.mid),
        () => M.setIncluded(m.d, m.mid, [issues.get("CAV-7346")], false, admin),
        () => M.getItemDetail(m.d, m.mid, issues.get("CAV-7346")!),
      ]) await assert.rejects(call, (e: unknown) => (e as { status?: number }).status === 409 && codeOf(e) === "inputs_stale", label);
      assert.equal((await mvRow(m.mid)).checklistHash, h, `${label}: the stored hash was not replaced by an empty-records hash`);
      assert.deepEqual((await soOf(m.mid)).map((x) => x.h), [null, null, null, null]);
      const r = await R.refreshMovement(m.mid, { ...m.deps, bypass: true });
      assert.equal(r.inputsWritten, true, `${label}: the refresh rewrote the unreadable copy`);
      assert.equal(r.hash, h, "same content, same hash");
      assert.equal((await M.getMovementView(m.d, m.mid, admin)).needsRefresh, false);
    }
    // a cron / background refresh (no bypass) heals a corrupt copy as well, nobody has to press Refresh
    await D.db.update(S.deliveryMovements).set({ inputs: Buffer.from("rotten") }).where(O.eq(S.deliveryMovements.id, m.mid));
    core.clearMovementCachesForTests();
    const cron = await R.refreshMovement(m.mid, { ...m.deps, now: () => new Date(Date.now() + 60_000) });
    assert.equal(cron.inputsWritten, true);
    assert.equal((await M.getMovementView(m.d, m.mid, admin)).needsRefresh, false);
    await signAll(m.d, m.mid);
    await M.startMovement(m.d, m.mid, deployer);
    await M.doneMovement(m.d, m.mid, {}, deployer);
    await D.db.update(S.deliveryMovements).set({ inputs: null }).where(O.eq(S.deliveryMovements.id, m.mid));
    core.checklistCacheForTests.clear();
    assert.equal((await M.getChecklist(m.d, m.mid)).hash, h, "a done movement reads the snapshot of its last hash");
    assert.equal((await M.getMovementView(m.d, m.mid, admin)).needsRefresh, false);
  });

  it("a refresh that cannot persist (inputs over the cap) fails closed for approvals and says so; the next good refresh clears it", async () => {
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }]);
    const m = await newMovement("cap", ["CAV-7346"], f);
    const before_ = await mvRow(m.mid);
    f.issues.get("CAV-7346")!.comments!.push(cloneComment("CAV-7346-81399", "999777", (x) => x.replace(/1184/g, "1191"))); // pointer set changes -> must be stored
    const r = await R.refreshMovement(m.mid, { ...m.deps, bypass: true, inputsCapBytes: 50 });
    assert.match(r.error ?? "", /too large/);
    const after_ = await mvRow(m.mid);
    assert.ok(after_.refreshError && after_.refreshError.length <= 300 && !/\d{4,} bytes/.test(after_.refreshError), "generic text, no internals");
    assert.equal(after_.inputsHash, before_.inputsHash, "the stored inputs are untouched");
    assert.ok(after_.refreshedAt!.getTime() > before_.refreshedAt!.getTime());
    assert.equal((await evOf(m.mid, "refresh_failed")).length, 1);
    await R.refreshMovement(m.mid, { ...m.deps, bypass: true, inputsCapBytes: 50 });
    assert.equal((await evOf(m.mid, "refresh_failed")).length, 1, "one event per change, not per attempt");
    const v = await M.getMovementView(m.d, m.mid, admin);
    assert.equal(v.refreshError, after_.refreshError);
    assert.deepEqual([v.permissions.sign, v.permissions.start], [[], false]);
    await assert.rejects(() => M.signMovement(m.d, m.mid, "deployer", v.movement.hash!, deployer), (e: unknown) => (e as { status?: number }).status === 409 && codeOf(e) === "refresh_failed");
    const ok = await R.refreshMovement(m.mid, { ...m.deps, bypass: true });
    assert.equal(ok.ok, true);
    assert.equal((await mvRow(m.mid)).refreshError, null);
    assert.equal((await evOf(m.mid, "refresh_recovered")).length, 1);
    await M.signMovement(m.d, m.mid, "deployer", await hashOf(m.d, m.mid), deployer);
  });

  it("concurrent sign-offs are serialised (two slots at once, the same slot twice); a sign racing a refresh never leaves a sign-off on a stale hash", async () => {
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }]);
    const m = await newMovement("conc", ["CAV-7346"], f);
    const h = await hashOf(m.d, m.mid);
    const res = await Promise.all([
      M.signMovement(m.d, m.mid, "deployer", h, deployer),
      M.signMovement(m.d, m.mid, "deployer", h, deployer),
      M.signMovement(m.d, m.mid, "ba", h, ba),
    ]);
    assert.ok(res.every((r) => r.hash === h));
    assert.equal((await soOf(m.mid)).filter((x) => x.h === h).length, 2);
    assert.equal((await evOf(m.mid, "signed")).length, 2, "the same slot twice is one sign-off");
    await M.signMovement(m.d, m.mid, "lead", h, lead);
    await M.signMovement(m.d, m.mid, "qa_lead", h, qaLead);
    assert.equal((await mvRow(m.mid)).status, "signed_off");

    // race: three sign-offs are in, the QA lead signs while a new record arrives
    const f2 = new FakeJira([{ key: "CAV-7346", comments: rec7346() }]);
    const n = await newMovement("conc2", ["CAV-7346"], f2, "demo");
    const h2 = await hashOf(n.d, n.mid);
    await M.signMovement(n.d, n.mid, "deployer", h2, deployer);
    await M.signMovement(n.d, n.mid, "ba", h2, ba);
    await M.signMovement(n.d, n.mid, "lead", h2, lead);
    f2.issues.get("CAV-7346")!.comments!.push(cloneComment("CAV-7346-81399", "999888", (x) => x.replace(/1184/g, "1192")));
    const out = await Promise.allSettled([M.signMovement(n.d, n.mid, "qa_lead", h2, qaLead), R.refreshMovement(n.mid, { ...n.deps, bypass: true })]);
    assert.equal(out[1].status, "fulfilled");
    const row_ = await mvRow(n.mid);
    assert.equal(row_.status, "ready");
    assert.notEqual(row_.checklistHash, h2);
    for (const so of await soOf(n.mid)) assert.ok(so.h === null || so.h === row_.checklistHash, "no sign-off on an old hash");
    assert.ok((await soOf(n.mid)).every((x) => x.h === null), "the record change reset every sign-off, whichever came first");
  });

  it("refresh: no connection is held while Jira answers; concurrent refreshes of one movement run once; 5 movements refresh together with normal queries", async () => {
    const inner = new FakeJira([{ key: "CAV-7346", comments: rec7346() }]);
    let out = 0;
    let samples = 0;
    const slow: JiraSource = {
      searchByJql: async (...a) => {
        await sleep(25);
        out = Math.max(out, D.pool.totalCount - D.pool.idleCount);
        samples++;
        return inner.searchByJql(...a);
      },
      fetchIssueComments: async (...a) => {
        await sleep(25);
        out = Math.max(out, D.pool.totalCount - D.pool.idleCount);
        samples++;
        return inner.fetchIssueComments(...a);
      },
    };
    const m = await newMovement("par0", ["CAV-7346"], slow);
    await sleep(50); // let the pool settle
    out = 0;
    samples = 0;
    const one = await R.refreshMovement(m.mid, { ...m.deps, bypass: true });
    assert.equal(one.ok, true);
    assert.ok(samples >= 2, "the slow source was used");
    assert.equal(out, 0, "no pool connection was checked out while Jira was being read");

    const three = await Promise.all([1, 2, 3].map(() => R.refreshMovement(m.mid, { ...m.deps, bypass: true })));
    assert.equal(three.filter((r) => r.refreshing).length, 2, "the second and third caller are told a refresh is running");
    assert.equal(three.filter((r) => r.ok).length, 1);
    assert.equal(R.isRefreshing(m.mid), false);

    const ms = [m];
    for (let i = 1; i < 5; i++) ms.push(await newMovement(`par${i}`, ["CAV-7346"], slow));
    const t0 = performance.now();
    const all = await Promise.all([
      ...ms.map((x) => R.refreshMovement(x.mid, { ...x.deps, bypass: true })),
      ...ms.map((x) => M.getMovementView(x.d, x.mid, admin)),
      ...ms.map((x) => M.listMovements(x.d)),
    ]);
    console.log(`METRIC 5 concurrent refreshes + 10 normal queries: ${(performance.now() - t0).toFixed(0)} ms, none timed out, pool waiting ${D.pool.waitingCount}`);
    assert.ok(all.slice(0, 5).every((r) => (r as { ok?: boolean }).ok === true));
    assert.equal(D.pool.waitingCount, 0);
  });

  it("create refuses unusable deliveries before inserting anything (0 or > 200 Jiras, completed or deleted); an existing movement of a completed delivery stays readable", async () => {
    const movementsOf = async (d: string) => (await D.db.select({ id: S.deliveryMovements.id }).from(S.deliveryMovements).where(O.eq(S.deliveryMovements.deliveryId, d))).length;
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }]);
    const empty = await seedDelivery("empty", []);
    await rejects(() => M.createMovement(empty, "uat", SIGNERS, admin, depsFor(f)), 400);
    const many = await D.db.insert(S.jiraIssues).values(Array.from({ length: 201 }, (_, i) => ({ projectId: created.projectId, jiraId: `${TAG}-many-${i}`, jiraKey: `MANY-${i + 1}`, summary: `${TAG} many`, status: "Done", issueType: "Task" }))).returning({ id: S.jiraIssues.id });
    const big = await seedDelivery("big", many.map((x) => x.id));
    await assert.rejects(() => M.createMovement(big, "uat", SIGNERS, admin, depsFor(f)), (e: unknown) => (e as { status?: number }).status === 400 && codeOf(e) === "too_many_items");
    assert.equal(await movementsOf(big), 0, "nothing was inserted");
    const closed = await seedDelivery("closed", [issues.get("CAV-7346")!]);
    await D.db.update(S.deliveries).set({ completedAt: new Date() }).where(O.eq(S.deliveries.id, closed));
    await assert.rejects(() => M.createMovement(closed, "uat", SIGNERS, admin, depsFor(f)), (e: unknown) => (e as { status?: number }).status === 409 && codeOf(e) === "delivery_closed");
    const deleted = await seedDelivery("deleted", [issues.get("CAV-7346")!]);
    await D.db.update(S.deliveries).set({ deletedAt: new Date() }).where(O.eq(S.deliveries.id, deleted));
    await rejects(() => M.createMovement(deleted, "uat", SIGNERS, admin, depsFor(f)), 409);
    assert.equal((await movementsOf(empty)) + (await movementsOf(closed)) + (await movementsOf(deleted)), 0);
    // a movement that exists when its delivery is completed is still readable
    const live = await newMovement("live", ["CAV-7346"], f, "demo");
    await D.db.update(S.deliveries).set({ completedAt: new Date() }).where(O.eq(S.deliveries.id, live.d));
    assert.equal((await M.getMovementView(live.d, live.mid, admin)).movement.status, "ready");
    assert.equal((await M.listMovements(live.d)).length, 1);
  });

  it("edits made in draft leave it in draft: only a successful refresh makes a movement ready", async () => {
    const [tracked] = await D.db.select({ name: S.githubRepos.name }).from(S.githubRepos).where(O.eq(S.githubRepos.isTracked, true)).limit(1);
    if (!tracked) return console.log("SKIP draft test: the dev DB has no tracked repo");
    const d = await seedDelivery("draft", [issues.get("CAV-7346")!]);
    const [mv] = await D.db.insert(S.deliveryMovements).values({ deliveryId: d, environment: "demo", createdBy: E1 }).returning({ id: S.deliveryMovements.id });
    await D.db.insert(S.deliveryMovementSignoffs).values((["deployer", "ba", "lead"] as const).map((slot, i) => ({ movementId: mv.id, slot, userEmail: [E1, E2, E3][i] })) /* three rows on purpose: an older movement */);
    const saved = await M.saveBranches(d, mv.id, [{ repo: tracked.name, branch: "main" }], admin);
    assert.equal(saved.changed, true);
    assert.equal((await mvRow(mv.id)).status, "draft");
    assert.equal((await evOf(mv.id, "became_ready")).length, 0);
    const r = await R.refreshMovement(mv.id, { ...depsFor(new FakeJira([{ key: "CAV-7346", comments: rec7346() }])), bypass: true });
    assert.equal(r.ok, true);
    assert.equal((await mvRow(mv.id)).status, "ready");

    // This movement has only the three first slots (made before the QA lead existed): it has no QA lead row, and naming one adds the slot.
    const before = await M.getMovementView(d, mv.id, admin);
    assert.deepEqual(before.signers.find((s) => s.slot === "qa_lead")?.email, "");
    await rejects(() => M.setSigners(d, mv.id, { qa_lead: { email: `ghost-${TAG.toLowerCase()}@example.invalid` } }, manager), 400);
    assert.equal((await M.setSigners(d, mv.id, { qa_lead: { email: E5, name: "QA Lead" } }, manager)).changed, true);
    const after = await M.getMovementView(d, mv.id, admin);
    assert.deepEqual(after.signers.find((s) => s.slot === "qa_lead")?.email, E5);
    assert.equal((await evOf(mv.id, "signers_changed")).length, 1);
    assert.equal((await M.setSigners(d, mv.id, { qa_lead: { email: E5 } }, manager)).changed, false, "naming the same person again changes nothing");
  });

  it("a notifier that throws never rolls anything back; a transaction that rolls back sends no mail; statuses are proposed only for prod", async () => {
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }, { key: "CAV-7399", comments: [noiseComment("6", Date.now())] }]);
    const m = await newMovement("notif", ["CAV-7346", "CAV-7399"], f, "uat");
    const angry = () => { throw new Error("mail server down"); };
    N.setMovementNotifier({ notifySignerAssigned: angry, notifyReset: angry, notifyReadyToDeploy: angry, notifyDone: angry });
    try {
      await signAll(m.d, m.mid); // the last sign-off calls notifyReadyToDeploy, which throws
      assert.equal((await mvRow(m.mid)).status, "signed_off", "the sign-off is committed");
      await M.startMovement(m.d, m.mid, deployer);
      f.issues.get("CAV-7346")!.comments!.push(cloneComment("CAV-7346-81399", "999555", (x) => x.replace(/1184/g, "1193")));
      assert.equal((await R.refreshMovement(m.mid, { ...m.deps, bypass: true })).ok, true, "a failing reset mail does not fail the refresh");
      assert.equal((await evOf(m.mid, "changed_after_start")).length, 1);
    } finally {
      N.setMovementNotifier({
        notifySignerAssigned: (p) => void calls.push({ kind: "assigned", p }),
        notifyReset: (p) => void calls.push({ kind: "reset", p }),
        notifyReadyToDeploy: (p) => void calls.push({ kind: "ready", p }),
        notifyDone: (p) => void calls.push({ kind: "done", p }),
      });
    }
    // a done that fails AFTER it already collected a reset notification rolls back and sends nothing
    await D.db.update(S.deliveryMovements).set({ checklistHash: "f".repeat(64), lastNotifiedHash: null }).where(O.eq(S.deliveryMovements.id, m.mid));
    const resets = calls.filter((c) => c.kind === "reset").length;
    const evs = (await evOf(m.mid, "changed_after_start")).length;
    await rejects(() => M.doneMovement(m.d, m.mid, { results: [{ issueId: issues.get("CAV-7399")!, result: "moved" }] }, deployer), 400);
    assert.equal(calls.filter((c) => c.kind === "reset").length, resets, "no mail for a change that was rolled back");
    assert.equal((await evOf(m.mid, "changed_after_start")).length, evs);
    assert.equal((await mvRow(m.mid)).checklistHash, "f".repeat(64), "the rolled-back transaction left no trace");
    assert.equal((await mvRow(m.mid)).status, "in_progress");
    await M.doneMovement(m.d, m.mid, {}, deployer);
    // S6: demo / uat movements propose nothing and cannot confirm
    const p = await M.proposeStatuses(m.d, m.mid);
    assert.deepEqual([p.proposals.length, p.counts.total], [0, 0]);
    assert.match(p.note ?? "", /prod/);
    await assert.rejects(() => M.confirmStatuses(m.d, m.mid, undefined, deployer, { gates: async () => ({ blocked: false }) }), (e: unknown) => (e as { status?: number }).status === 409 && codeOf(e) === "not_prod");
  });

  it("tick default: a Jira that becomes ready is ticked once unless somebody already chose; a person's choice is never overridden", async () => {
    const rw = (x: string) => x.replace(/CAV-7346/g, "CAV-7399").replace(/\b1184\b/g, "31001").replace(/\b267\b/g, "31002").replace(/\b49\b/g, "31003");
    const f = new FakeJira([
      { key: "CAV-7346", comments: rec7346() },
      { key: "CAV-7304", comments: [fixtureComment("CAV-7304-81422"), fixtureComment("CAV-7304-81423"), fixtureComment("CAV-7304-81424")] },
      { key: "CAV-7399", comments: [] },
    ]);
    const m = await newMovement("tick", ["CAV-7346", "CAV-7304", "CAV-7399"], f, "uat");
    let it_ = await itemsOf(m.mid);
    assert.deepEqual([it_["CAV-7346"].included, it_["CAV-7304"].included, it_["CAV-7399"].included], [true, false, false]);
    assert.deepEqual([it_["CAV-7346"].tickSet, it_["CAV-7304"].tickSet], [false, false]);
    await M.setIncluded(m.d, m.mid, [issues.get("CAV-7399")], false, admin); // an explicit "no" on a blocked Jira
    // both get their records
    f.issues.get("CAV-7304")!.comments!.push(fixtureComment("CAV-7304-81425"));
    f.issues.get("CAV-7399")!.comments!.push(...[["CAV-7346-81399", "a1"], ["CAV-7346-81400", "a2"], ["CAV-7346-81421", "a3"]].map(([n, id]) => cloneComment(n, id, rw)));
    const r = await R.refreshMovement(m.mid, { ...m.deps, bypass: true });
    assert.equal(r.ok, true);
    it_ = await itemsOf(m.mid);
    assert.deepEqual([it_["CAV-7304"].readiness, it_["CAV-7304"].included, it_["CAV-7304"].tickSet], ["ready", true, false], "never touched by a person: ticked when it became ready");
    assert.deepEqual([it_["CAV-7399"].readiness, it_["CAV-7399"].included, it_["CAV-7399"].tickSet], ["ready", false, true], "the person said no: stays unticked");
    await M.setIncluded(m.d, m.mid, [issues.get("CAV-7304")], false, admin);
    await R.refreshMovement(m.mid, { ...m.deps, bypass: true });
    assert.equal((await itemsOf(m.mid))["CAV-7304"].included, false, "a later refresh does not tick what the person unticked");
  });

  it("two writers on the same issue through two deliveries never deadlock (shared status routine, locks in id order)", async () => {
    const { writeItemStatus } = await import("@/lib/deliveries/set-item-status");
    const issueId = issues.get("CAV-7346")!;
    const d1 = await seedDelivery("lock1", [issueId]);
    const d2 = await seedDelivery("lock2", [issueId]);
    const item = async (d: string) => (await D.db.select({ id: S.deliveryItems.id }).from(S.deliveryItems).where(O.and(O.eq(S.deliveryItems.deliveryId, d), O.eq(S.deliveryItems.issueId, issueId))))[0].id;
    const [i1, i2] = [await item(d1), await item(d2)];
    const w = (d: string, itemId: string, to: "delivered" | "pending") => writeItemStatus({ deliveryId: d, deliveryName: "x", itemId, issueId, nextStatus: to, statusComment: null, userId: E1, userName: null });
    for (let round = 0; round < 10; round++) {
      const to = round % 2 === 0 ? "delivered" : "pending";
      const out = await Promise.allSettled([w(d1, i1, to), w(d2, i2, to), w(d1, i1, to), w(d2, i2, to)]);
      for (const o of out) assert.equal(o.status, "fulfilled", o.status === "rejected" ? String((o.reason as { code?: string; cause?: { code?: string } })?.code ?? (o.reason as { cause?: { code?: string } })?.cause?.code ?? o.reason) : "");
    }
    const rows = await D.db.select({ s: S.deliveryItems.status }).from(S.deliveryItems).where(O.eq(S.deliveryItems.issueId, issueId));
    assert.ok(rows.every((r) => r.s === rows[0].s), "every row of the issue mirrors the same status");
  });

  it("a failed depth-limit check degrades an existing ready Jira (status, hash and sign-offs stay) and blocks a new one", async () => {
    const chain = ["DEEP-1", "DEEP-2", "DEEP-3", "DEEP-4", "DEEP-5"].map((key, i) => ({ key, parent: i === 0 ? "CAV-7346" : `DEEP-${i}` }));
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }, ...chain]);
    const m = await newMovement("deep", ["CAV-7346"], f);
    assert.equal((await itemsOf(m.mid))["CAV-7346"].readiness, "ready", "a healthy depth-limit check is clean");
    const h = await signAll(m.d, m.mid);
    const before_ = { mv: (({ status, checklistHash }) => ({ status, checklistHash }))(await mvRow(m.mid)), so: await soOf(m.mid), ev: (await evOf(m.mid)).length };
    f.failSearchWhen = (jql) => jql.startsWith("parent in (DEEP-5");
    const r = await R.refreshMovement(m.mid, { ...m.deps, bypass: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.items!.degraded, 1);
    const row_ = (await itemsOf(m.mid))["CAV-7346"];
    assert.deepEqual([row_.readiness, row_.included], ["ready", true]);
    assert.deepEqual({ mv: (({ status, checklistHash }) => ({ status, checklistHash }))(await mvRow(m.mid)), so: await soOf(m.mid), ev: (await evOf(m.mid)).length }, before_, "nothing approved was disturbed");
    assert.ok((await soOf(m.mid)).every((x) => x.h === h));
    // a NEW Jira in the same outage has no history: it fails closed
    const n = await newMovement("deep-new", ["CAV-7346"], f);
    const nr = (await itemsOf(n.mid))["CAV-7346"];
    assert.deepEqual([nr.readiness, nr.included], ["blocked", false]);
    f.failSearchWhen = undefined;
    assert.equal((await R.refreshMovement(m.mid, { ...m.deps, bypass: true })).ok, true);
    assert.equal((await mvRow(m.mid)).checklistHash, before_.mv.checklistHash);
  });

  it("revoke returns to what the row's own blockers say, not to the readiness kept in the inputs (which a pointer-neutral change leaves stale)", async () => {
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }]);
    const dp: RefreshOptions = { source: f, github: { heads: noHeads }, loadOptions: caches() };
    const d = await seedDelivery("revoke", [issues.get("CAV-7346")!]);
    const out = await M.createMovement(d, "uat", SIGNERS, admin, dp);
    const mid = out.movementId;
    assert.equal((await itemsOf(mid))["CAV-7346"].readiness, "ready");
    // the Jira tree grows past the depth limit: the records (and their pointers) are untouched, the Jira is now incomplete
    for (let i = 1; i <= 6; i++) f.add({ key: `DEEP-${i}`, parent: i === 1 ? "CAV-7346" : `DEEP-${i - 1}` });
    const r = await R.refreshMovement(mid, { ...dp, bypass: true });
    assert.equal(r.inputsWritten, false, "the record pointers did not change, so the stored inputs still say ready");
    assert.equal((await itemsOf(mid))["CAV-7346"].readiness, "blocked");
    const id = issues.get("CAV-7346")!;
    await M.overrideItem(d, mid, id, "accepted by the release owner", admin, true);
    const rv = await M.revokeOverride(d, mid, id, "owner changed their mind", admin);
    assert.deepEqual([rv.readiness, rv.included], ["blocked", false]);
    const v = await M.getMovementView(d, mid, admin);
    assert.equal(v.items[0].included, false);
    assert.ok(!(await M.getChecklist(d, mid)).scope.jiras.some((j) => j.jira === "CAV-7346"), "out of the checklist");
    assert.deepEqual(v.permissions.sign, [], "nothing to sign");
    await assert.rejects(() => M.signMovement(d, mid, "deployer", v.movement.hash!, deployer), (e: unknown) => (e as { status?: number }).status === 409);
  });

  it("CAV-7280: the real union review comment (81643) makes it ready; no comment blocks; a newer comment replaces it (one review comment per Jira)", async () => {
    await seedIssue("CAV-7280", 71);
    await seedIssue("CAV-7281", 72);
    const f = new FakeJira([
      { key: "CAV-7280", comments: [noiseComment("c1", Date.parse("2026-11-20T00:00:00Z")), fixtureComment("CAV-7280-81643")] },
      { key: "CAV-7281", comments: [noiseComment("c2", Date.now())] },
    ]);
    const m = await newMovement("cav7280", ["CAV-7280", "CAV-7281"], f, "demo");
    const it_ = await itemsOf(m.mid);
    assert.deepEqual([it_["CAV-7280"].readiness, it_["CAV-7280"].included], ["ready", true]);
    assert.deepEqual([it_["CAV-7281"].readiness, it_["CAV-7281"].included], ["blocked", false]);
    const w = (it_["CAV-7280"].warnings as Array<{ code: string; message: string }>);
    assert.ok(w.some((x) => x.code === "record_status" && /HELD in the DEMO movement/.test(x.message)), JSON.stringify(w));
    assert.ok(!w.some((x) => ["no_record", "sibling_no_record", "pr_no_record"].includes(x.code)));
    assert.deepEqual((it_["CAV-7281"].warnings as Array<{ code: string; message: string }>).filter((x) => x.code === "no_record").map((x) => x.message), ["No review comment found on this Jira"]);
    // pointers: one per covered PR, all the same comment, marked union
    const refs = it_["CAV-7280"].recordRefs as Array<{ repo: string; pr: number; commentId: string; scope?: string }>;
    assert.deepEqual(refs.map((r) => [r.repo, r.pr, r.commentId, r.scope]), [["slake-custom-reports", 931, "81643", "union"], ["slake-reporting-config", 1313, "81643", "union"]]);

    const v = await M.getMovementView(m.d, m.mid, admin);
    const vi = v.items.find((x) => x.key === "CAV-7280")!;
    assert.deepEqual([vi.reviews, vi.recordCount, vi.prs, vi.repos], [1, 1, { covered: 2 }, ["slake-custom-reports", "slake-reporting-config"]]);
    assert.ok(!("prData" in v), "the view no longer carries the PR-table age");
    assert.deepEqual(vi.blockers, []);
    // the item detail lists the covered PRs as the comment wrote them
    const detail = await M.getItemDetail(m.d, m.mid, issues.get("CAV-7280")!);
    assert.deepEqual(detail.prs.map((p) => [p.prKey, p.scope, p.branch, p.sha, p.note, p.prState]), [
      ["slake-custom-reports#931", "union", "main", "689b6d326c", "executor", "merged"],
      ["slake-reporting-config#1313", "union", "main", "5c9b08cdf1", "4 ckcoedemo report configs", "merged"],
    ]);
    assert.deepEqual(detail.comments.map((c) => [c.commentId, c.scope, c.covers]), [["81643", "union", ["slake-custom-reports#931", "slake-reporting-config#1313"]]]);
    const cl = await M.getChecklist(m.d, m.mid);
    assert.ok(cl.scope.jiras.some((j) => j.jira === "CAV-7280"), "the union record reaches the checklist builder");

    // a NEWER comment on the ticket (other PRs, later) is THE review comment: the old one is superseded
    const h0 = (await mvRow(m.mid)).checklistHash;
    const newer = cloneComment("CAV-7280-81643", "81700", (t) => t.replace(/\b931\b/g, "940").replace(/\b1313\b/g, "1320"));
    newer.created = newer.updated = "2026-11-21T09:00:00.000+0000";
    f.issues.get("CAV-7280")!.comments!.push(newer);
    const r = await R.refreshMovement(m.mid, { ...m.deps, bypass: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.inputsWritten, true);
    assert.notEqual((await mvRow(m.mid)).checklistHash, h0);
    const refs2 = (await itemsOf(m.mid))["CAV-7280"].recordRefs as Array<{ pr: number; commentId: string }>;
    assert.deepEqual(refs2.map((x) => [x.pr, x.commentId]), [[940, "81700"], [1320, "81700"]]);
    // and it is only a pointer-sized change: the same refresh again writes nothing
    assert.equal((await R.refreshMovement(m.mid, { ...m.deps, bypass: true, now: () => new Date(Date.now() + 60_000) })).changed, false);
  });

  it("the view's permissions match what the server accepts, across states (needsRefresh, refresh_failed, zero included, non-prod done, signed_off)", async () => {
    const core = await import("./core");
    const allowed = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return true;
      } catch (e) {
        const st = (e as { status?: number }).status;
        return !(st === 403 || st === 409);
      }
    };
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }, { key: "CAV-7399", comments: [noiseComment("7", Date.now())] }]);
    const id7346 = issues.get("CAV-7346")!;
    const id7399 = issues.get("CAV-7399")!;

    // (a) the stored inputs are unreadable
    const a = await newMovement("perm-a", ["CAV-7346", "CAV-7399"], f);
    const ha = await hashOf(a.d, a.mid);
    await D.db.update(S.deliveryMovements).set({ inputs: null }).where(O.eq(S.deliveryMovements.id, a.mid));
    core.clearMovementCachesForTests();
    let p = (await M.getMovementView(a.d, a.mid, admin)).permissions;
    assert.deepEqual([p.edit, p.override, p.revoke, p.sign, p.start, p.refresh], [false, false, false, [], false, true]);
    assert.equal(await allowed(() => M.setIncluded(a.d, a.mid, [id7346], false, admin)), p.edit);
    assert.equal(await allowed(() => M.overrideItem(a.d, a.mid, id7399, "needed for the release", admin)), p.override);
    assert.equal(await allowed(() => M.signMovement(a.d, a.mid, "deployer", ha, deployer)), p.sign.includes("deployer"));
    assert.equal(p.confirm, false);

    // (b) the last refresh failed: approving is off, editing is not
    const b = await newMovement("perm-b", ["CAV-7346", "CAV-7399"], f);
    const hb = await hashOf(b.d, b.mid);
    await D.db.update(S.deliveryMovements).set({ refreshError: "generic failure" }).where(O.eq(S.deliveryMovements.id, b.mid));
    p = (await M.getMovementView(b.d, b.mid, admin)).permissions;
    assert.deepEqual([p.sign, p.start, p.edit, p.override], [[], false, true, true]);
    assert.equal(await allowed(() => M.signMovement(b.d, b.mid, "deployer", hb, deployer)), false);
    assert.equal(await allowed(() => M.overrideItem(b.d, b.mid, id7399, "needed for the release", admin)), true);

    // (c) nothing selected: nothing to sign or start
    const c = await newMovement("perm-c", ["CAV-7399"], f);
    const vc = await M.getMovementView(c.d, c.mid, admin);
    assert.deepEqual([vc.permissions.sign, vc.permissions.start], [[], false]);
    assert.equal(await allowed(() => M.signMovement(c.d, c.mid, "deployer", vc.movement.hash!, deployer)), false);

    // (d) done: statuses only for prod
    const d1 = await newMovement("perm-d", ["CAV-7346"], f, "uat");
    await signAll(d1.d, d1.mid);
    await M.startMovement(d1.d, d1.mid, deployer);
    await M.doneMovement(d1.d, d1.mid, {}, deployer);
    const gates = { gates: async () => ({ blocked: false as const }) };
    p = (await M.getMovementView(d1.d, d1.mid, deployer)).permissions;
    assert.equal(p.confirm, false);
    assert.equal(await allowed(() => M.confirmStatuses(d1.d, d1.mid, undefined, deployer, gates)), false);
    const pv = (await M.getMovementView(deliveryId, movementId, deployer)).permissions; // the prod movement of the main flow, done
    assert.equal(pv.confirm, true);
    assert.equal(await allowed(() => M.confirmStatuses(deliveryId, movementId, undefined, deployer, gates)), true);

    // (e) signed off: the deployer may start, nobody may sign again
    const e = await newMovement("perm-e", ["CAV-7346"], f);
    await signAll(e.d, e.mid);
    p = (await M.getMovementView(e.d, e.mid, deployer)).permissions;
    assert.deepEqual([p.start, p.sign], [true, []]);
    assert.equal((await M.getMovementView(e.d, e.mid, admin)).permissions.edit, true, "a manager may edit a signed-off movement (it resets the sign-offs)");
    assert.equal(await allowed(() => M.startMovement(e.d, e.mid, deployer)), true);
    const pb = (await M.getMovementView(e.d, e.mid, ba)).permissions;
    assert.equal(pb.start, false);
    assert.equal(await allowed(() => M.startMovement(e.d, e.mid, ba)), false);
  });

  it("confirm never takes a Jira back from delivered even when it changes between the read and the write; the item detail is cached per inputs hash; a stale failure never overwrites a newer refresh", async () => {
    const { writeItemStatus } = await import("@/lib/deliveries/set-item-status");
    const core = await import("./core");
    const issueId = issues.get("CAV-7304")!;
    const d = await seedDelivery("down", [issueId]);
    const itemId = (await D.db.select({ id: S.deliveryItems.id }).from(S.deliveryItems).where(O.eq(S.deliveryItems.deliveryId, d)))[0].id;
    const w = (to: "delivered" | "not_delivered", guard?: "delivered") => writeItemStatus({ deliveryId: d, deliveryName: "x", itemId, issueId, nextStatus: to, statusComment: null, userId: E1, userName: null, neverDowngradeFrom: guard });
    assert.equal((await w("delivered", "delivered")).changed, true);
    const hist = async () => (await D.db.select({ id: S.deliveryStatusHistory.id }).from(S.deliveryStatusHistory).where(O.eq(S.deliveryStatusHistory.issueId, issueId))).length;
    const h0 = await hist();
    assert.deepEqual(await w("not_delivered", "delivered"), { changed: false, affectedDeliveryIds: [], skipped: "downgrade" });
    assert.equal(await hist(), h0, "nothing written, no history row");
    assert.equal((await w("not_delivered")).changed, true, "without the guard it is an ordinary write");

    // the decoded blob is read once per (movement, inputs hash)
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }]);
    const m = await newMovement("cache", ["CAV-7346"], f);
    core.clearMovementCachesForTests();
    const reads = async () => {
      startCount();
      await M.getItemDetail(m.d, m.mid, issues.get("CAV-7346")!);
      return stopCount().filter((q) => /^\s*select "inputs" from/i.test(q)).length;
    };
    assert.equal(await reads(), 1);
    assert.equal(await reads(), 0, "served from the cache");
    f.issues.get("CAV-7346")!.comments!.push(cloneComment("CAV-7346-81399", "999321", (x) => x.replace(/1184/g, "1194")));
    await R.refreshMovement(m.mid, { ...m.deps, bypass: true });
    assert.equal(await reads(), 1, "a rewritten blob (new inputs hash) is read again");
    assert.equal((await M.getItemDetail(m.d, m.mid, issues.get("CAV-7346")!)).prs.length, 4);

    // recordRefreshFailure: same lock, and nothing newer may have happened
    const base = await mvRow(m.mid);
    const baseline = { refreshedAt: base.refreshedAt, inputsHash: base.inputsHash };
    await R.recordRefreshFailure(m.mid, "stale failure", null, { refreshedAt: new Date(0), inputsHash: base.inputsHash });
    assert.equal((await mvRow(m.mid)).refreshError, null, "a newer refresh already happened: the old failure is dropped");
    await D.db.transaction(async (tx) => {
      await tx.execute(O.sql`select pg_advisory_xact_lock(hashtextextended(${m.mid}, 0))`);
      await R.recordRefreshFailure(m.mid, "locked out", null, baseline); // another connection: the lock is busy
    });
    assert.equal((await mvRow(m.mid)).refreshError, null, "a writer holds the lock: nothing recorded");
    await R.recordRefreshFailure(m.mid, "real failure", null, baseline);
    assert.equal((await mvRow(m.mid)).refreshError, "real failure");
    assert.equal((await R.refreshMovement(m.mid, { ...m.deps, bypass: true })).ok, true);
    assert.equal((await mvRow(m.mid)).refreshError, null);
  });

  it("a view never holds more than 2 pool connections at once", async () => {
    const core = await import("./core");
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }, { key: "CAV-7399", comments: [noiseComment("8", Date.now())] }]);
    const m = await newMovement("conns", ["CAV-7346", "CAV-7399"], f);
    await sleep(30);
    core.clearMovementCachesForTests(); // build the checklist too: the widest path
    sampler = { max: 0, pool: () => D.pool.totalCount - D.pool.idleCount };
    let seen = 0;
    try {
      await M.getMovementView(m.d, m.mid, admin);
    } finally {
      seen = sampler!.max;
      sampler = null;
    }
    console.log(`METRIC view: max pool connections checked out at once = ${seen}`);
    assert.ok(seen >= 1 && seen <= 2, `a view held ${seen} connections`);
  });

  it("a refresh never reads the PR table: no github_pull_requests statement, and the jira calls are the same with or without it", async () => {
    const f = new FakeJira([{ key: "CAV-7346", comments: rec7346() }, { key: "CAV-7280", comments: [fixtureComment("CAV-7280-81643")] }]);
    const d = await seedDelivery("nopr", [issues.get("CAV-7346")!, await seedIssue("CAV-7280", 70)]);
    startCount();
    const out = await M.createMovement(d, "uat", SIGNERS, admin, depsFor(f));
    const used = stopCount();
    assert.equal(out.refresh.ok, true, JSON.stringify(out.refresh));
    assert.ok(!used.some((q) => /github_pull_requests/i.test(q)), "no statement touches the PR table");
    console.log("METRIC no-PR-table refresh statements:", JSON.stringify(countVerbs(used)), "total", used.length, "jira calls", out.refresh.jiraCalls);
  });

  it("branch picks follow the ticks: unticking a Jira drops its repos from the list (a saved pick stays, flagged heldOnly, and out of the hash)", async () => {
    const f = new FakeJira([
      { key: "CAV-7346", comments: rec7346() },
      { key: "CAV-7304", comments: [fixtureComment("CAV-7304-81422"), fixtureComment("CAV-7304-81423"), fixtureComment("CAV-7304-81424")] }, // blocked: flutter#50 has no record
    ]);
    const m = await newMovement("branchtick", ["CAV-7346", "CAV-7304"], f);
    const id7304 = issues.get("CAV-7304")!;
    const repos = async () => (await M.listAffectedRepos(m.d, m.mid)).affected.map((a) => `${a.repo}${a.heldOnly ? "*" : ""}`);
    // 7304 is blocked, so it is not in: its auth-service repo is not offered
    assert.deepEqual(await repos(), ["channelkart", "channelkart-flutter", "kpi-dashboard"]);
    // admin overrides and ticks it: its repos appear
    await M.overrideItem(m.d, m.mid, id7304, "accepted by the release owner", admin, true);
    assert.deepEqual(await repos(), ["channelkart", "channelkart-flutter", "kpi-dashboard", "salescode-auth-service"]);
    const picks = [{ repo: "channelkart", branch: "prod_blue_1" }, { repo: "salescode-auth-service", branch: "prod_auth_1" }];
    const saved = await M.saveBranches(m.d, m.mid, picks, admin);
    const withBoth = saved.hash;
    // untick: auth-service leaves the list as an active repo, the pick stays visible and flagged
    const off = await M.setIncluded(m.d, m.mid, [id7304], false, admin);
    assert.deepEqual(await repos(), ["channelkart", "channelkart-flutter", "kpi-dashboard", "salescode-auth-service*"]);
    const info = await M.listAffectedRepos(m.d, m.mid);
    assert.equal(info.affected.find((a) => a.repo === "salescode-auth-service")!.branch, "prod_auth_1", "the saved pick is not dropped");
    assert.deepEqual(info.branches.map((b) => b.repo), ["channelkart", "salescode-auth-service"]);
    assert.notEqual(off.hash, withBoth, "the Jira itself left the checklist");
    // the held-only pick does not touch the hash: removing it, or changing it, leaves the checklist as it was
    const hashHeld = (await M.getMovementView(m.d, m.mid, admin)).movement.hash!;
    const dropped = await M.saveBranches(m.d, m.mid, [{ repo: "channelkart", branch: "prod_blue_1" }], admin);
    assert.equal(dropped.changed, true, "the saved picks did change");
    assert.equal(dropped.hash, hashHeld, "but the checklist hash did not");
    const edited = await M.saveBranches(m.d, m.mid, [{ repo: "channelkart", branch: "prod_blue_1" }, { repo: "salescode-auth-service", branch: "prod_auth_2" }], admin); // a held-only pick may be re-saved: the repo of a saved pick stays allowed
    assert.equal(edited.hash, hashHeld);
    assert.ok(!(await M.getChecklist(m.d, m.mid)).scope.branches.some((b) => b.repo === "salescode-auth-service"));
    // re-ticking brings the pick back into the checklist
    const on = await M.setIncluded(m.d, m.mid, [id7304], true, admin);
    assert.deepEqual(await repos(), ["channelkart", "channelkart-flutter", "kpi-dashboard", "salescode-auth-service"]);
    assert.notEqual(on.hash, hashHeld);
    assert.ok((await M.getChecklist(m.d, m.mid)).scope.branches.some((b) => b.repo === "salescode-auth-service" && b.branch === "prod_auth_2"));
    // a pick for a repo that no Jira of the movement names and that is not tracked is still refused
    await rejects(() => M.saveBranches(m.d, m.mid, [{ repo: `not-a-repo-${TAG.toLowerCase()}`, branch: "main" }], admin), 400);
  });

  /** `legacy`: three per-PR comments per Jira (the older shape); default: ONE union comment per Jira (the real CAV-7280 comment). */
  async function loadScenario(n: number, legacy = false) {
    const T0 = Date.parse("2026-11-19T00:00:00Z");
    const key = (i: number) => `LOAD${n}${legacy ? "L" : "U"}-${i}`;
    const fk = new FakeJira();
    const ids: string[] = [];
    for (let i = 1; i <= n; i++) {
      ids.push(await seedIssue(key(i), 1000 + n * 100 + i + (legacy ? 50000 : 0)));
      const [a, b, c] = [20000 + i * 10, 20001 + i * 10, 20002 + i * 10];
      const rw = (s: string) => s.replace(/CAV-7346/g, key(i)).replace(/\b1184\b/g, String(a)).replace(/\b267\b/g, String(b)).replace(/\b49\b/g, String(c));
      const uw = (s: string) => s.replace(/CAV-7280/g, key(i)).replace(/\b931\b/g, String(a)).replace(/\b1313\b/g, String(b));
      fk.add({
        key: key(i),
        comments: legacy
          ? [noiseComment(`n${i}`, T0), cloneComment("CAV-7346-81399", `${i}01`, rw), cloneComment("CAV-7346-81400", `${i}02`, rw), cloneComment("CAV-7346-81421", `${i}03`, rw)]
          : [noiseComment(`n${i}`, T0), cloneComment("CAV-7280-81643", `${i}01`, uw)],
      });
      for (let s = 1; s <= 3; s++) fk.add({ key: `${key(i)}-S${s}`, subtask: true, parent: key(i), comments: s === 3 ? [noiseComment(`m${i}`, T0)] : [] });
    }
    const did = await seedDelivery(`load${n}`, ids);
    const d = { source: fk, github: { heads: noHeads }, loadOptions: caches() } satisfies RefreshOptions;
    const created_ = await (async () => {
      // create runs the first refresh; the heap is sampled around it
      const base = process.memoryUsage().heapUsed;
      let peak = base;
      const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().heapUsed)), 5);
      const t0 = performance.now();
      startCount();
      const out = await M.createMovement(did, "uat", SIGNERS, admin, d);
      const used = stopCount();
      const ms = performance.now() - t0;
      clearInterval(timer);
      return { out, used, ms, base, peak };
    })();
    return { did, fk, d, ...created_ };
  }

  it("load: 60 Jiras (3 sub-tasks each, ONE union review comment each) refresh in bounded calls, statements and memory", async () => {
    (globalThis as { gc?: () => void }).gc?.();
    const s = await loadScenario(60);
    const mid = s.out.movementId;
    const r = s.out.refresh;
    assert.equal(r.ok, true, JSON.stringify(r));
    const m = (await D.db.select({ inputsLen: O.sql<number>`octet_length(${S.deliveryMovements.inputs})`, status: S.deliveryMovements.status }).from(S.deliveryMovements).where(O.eq(S.deliveryMovements.id, mid)))[0];
    console.log(`METRIC 60-Jira first refresh: ${s.ms.toFixed(0)} ms, jira calls ${s.fk.calls} (search ${s.fk.searchCalls}, comments ${s.fk.commentCalls}), DB statements ${s.used.length} ${JSON.stringify(countVerbs(s.used))}`);
    console.log(`METRIC 60-Jira peak heap: +${((s.peak - s.base) / 1048576).toFixed(1)} MB over a ${(s.base / 1048576).toFixed(0)} MB baseline`);
    console.log(`METRIC 60-Jira items: ${JSON.stringify(r.items)} inputs blob ${m.inputsLen} bytes, parsed records ${r.recordsParsed}`);
    assert.ok(s.used.length < 40, `statements ${s.used.length}`);
    assert.ok(m.inputsLen > 0 && m.inputsLen <= 4194304);

    // no-op refresh of the same movement
    startCount();
    const t0 = performance.now();
    const again = await R.refreshMovement(mid, { ...s.d, bypass: true, loadOptions: caches() });
    const ms = performance.now() - t0;
    const used = stopCount();
    console.log(`METRIC 60-Jira no-op refresh: ${ms.toFixed(0)} ms, DB statements ${used.length} ${JSON.stringify(countVerbs(used))}, changed=${again.changed}`);
    assert.equal(again.changed, false);
    assert.equal(used.filter((q) => /^\s*(insert|update|delete)/i.test(q)).length, 1);

    // sizes after the run (the tables hold every movement of this test run)
    const sizes = await D.db.execute(O.sql`select c.relname as t, pg_total_relation_size(c.oid) as total, pg_table_size(c.oid) as tbl, pg_indexes_size(c.oid) as idx from pg_class c where c.relname like 'delivery_movement%' and c.relkind = 'r' order by 1`);
    console.log("METRIC sizes:", JSON.stringify(sizes.rows));
    const counts = await D.db.execute(O.sql`select 'movements' t, count(*) from delivery_movements union all select 'items', count(*) from delivery_movement_items union all select 'events', count(*) from delivery_movement_events union all select 'snapshots', count(*) from delivery_movement_snapshots`);
    console.log("METRIC row counts:", JSON.stringify(counts.rows));
    const cl = await M.getChecklist(s.did, mid);
    console.log(`METRIC 60-Jira checklist: ${Buffer.byteLength(JSON.stringify(cl))} bytes, ${cl.stats.included}/${cl.stats.jiras} included`);
    const view = await M.getMovementView(s.did, mid, admin);
    console.log(`METRIC 60-Jira view payload: ${Buffer.byteLength(JSON.stringify(view))} bytes`);
    assert.ok(Buffer.byteLength(JSON.stringify(view)) < 250_000);
  });

  it("load: a 30-Jira movement of the older shape, 3 per-PR comments each (size facts)", async () => {
    const s = await loadScenario(30, true);
    const mid = s.out.movementId;
    assert.equal(s.out.refresh.ok, true);
    const q = await D.db.execute(O.sql`select octet_length(inputs) as inputs_bytes, (select count(*) from delivery_movement_items where movement_id = ${mid}) as items from delivery_movements where id = ${mid}`);
    console.log("METRIC 30-Jira movement:", JSON.stringify(q.rows[0]), `refresh ${s.ms.toFixed(0)} ms, jira calls ${s.fk.calls}, statements ${s.used.length}`);
    const cl = await M.getChecklist(s.did, mid);
    console.log(`METRIC 30-Jira checklist: ${Buffer.byteLength(JSON.stringify(cl))} bytes`);
  });
  it("a Jira added to the delivery after the movement was created is flagged in the view and comes in on refresh", async () => {
    const a = await seedIssue("CAV-7346", 41);
    const did = await seedDelivery("grow", [a]);
    const fk = new FakeJira([{ key: "CAV-7346", comments: [fixtureComment("CAV-7346-81399")] }, { key: "CAV-7399", comments: [noiseComment("9", Date.now())] }]);
    const d = { source: fk, github: { heads: noHeads }, loadOptions: caches() };
    const out = await M.createMovement(did, "demo", SIGNERS, admin, d);
    assert.deepEqual((await M.getMovementView(did, out.movementId, admin)).deliveryChanged, { added: 0, removed: 0 });

    const b = await seedIssue("CAV-7399", 42);
    await D.db.insert(S.deliveryItems).values({ deliveryId: did, issueId: b, addedBy: E1 });
    const before = await M.getMovementView(did, out.movementId, admin);
    assert.deepEqual(before.deliveryChanged, { added: 1, removed: 0 });
    assert.equal(before.items.length, 1);

    const r = await R.refreshMovement(out.movementId, { ...d, bypass: true });
    assert.equal(r.items?.added, 1, JSON.stringify(r));
    const after = await M.getMovementView(did, out.movementId, admin);
    assert.equal(after.items.length, 2);
    assert.deepEqual(after.deliveryChanged, { added: 0, removed: 0 });

    await D.db.delete(S.deliveryItems).where(O.and(O.eq(S.deliveryItems.deliveryId, did), O.eq(S.deliveryItems.issueId, b)));
    assert.deepEqual((await M.getMovementView(did, out.movementId, admin)).deliveryChanged, { added: 0, removed: 1 });
  });
});

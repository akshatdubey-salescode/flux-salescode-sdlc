import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOVEMENT_STATUS_VALUES, type MovementStatus } from "../values";
import {
  ALLOWED_STATUSES,
  allSignedAt,
  authorize,
  checkSignable,
  checkStartable,
  cleanReason,
  isValidEmail,
  onHashChange,
  permissionsFor,
  signableSlots,
  slotsOf,
  statusAfterSign,
  type ActorInfo,
  type MovementAction,
  type Slots,
} from "./state";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const slots = (h: [string | null, string | null, string | null, string | null] = [null, null, null, null]): Slots => ({
  deployer: { email: "Dep@x.com", signedHash: h[0] },
  ba: { email: "ba@x.com", signedHash: h[1] },
  lead: { email: "lead@x.com", signedHash: h[2] },
  qa_lead: { email: "qa@x.com", signedHash: h[3] },
});
const manager: ActorInfo = { email: "mgr@x.com", isManager: true, isAdmin: false };
const admin: ActorInfo = { email: "admin@x.com", isManager: true, isAdmin: true };
const plain: ActorInfo = { email: "someone@x.com", isManager: false, isAdmin: false };
const deployer: ActorInfo = { email: "dep@x.com", isManager: false, isAdmin: false }; // different case on purpose
const ok = (a: MovementAction, status: MovementStatus, actor: ActorInfo, extra: { slot?: "deployer" | "ba" | "lead"; s?: Slots } = {}) =>
  authorize(a, { status, actor, slots: extra.s ?? slots(), slot: extra.slot }).ok;

describe("state machine: which statuses allow which action", () => {
  it("matches the table for every action x status (a manager / the deployer / an admin as needed)", () => {
    const actorFor = (a: MovementAction): { actor: ActorInfo; slot?: "ba" } =>
      a === "sign" ? { actor: { email: "ba@x.com", isManager: false, isAdmin: false }, slot: "ba" } : a === "override" || a === "revoke" ? { actor: admin } : a === "start" || a === "done" || a === "confirm" ? { actor: deployer } : { actor: manager };
    for (const a of Object.keys(ALLOWED_STATUSES) as MovementAction[]) {
      for (const st of MOVEMENT_STATUS_VALUES) {
        const { actor, slot } = actorFor(a);
        assert.equal(ok(a, st, actor, { slot }), ALLOWED_STATUSES[a].includes(st), `${a} in ${st}`);
      }
    }
    // the headline transitions
    assert.deepEqual(ALLOWED_STATUSES.start, ["signed_off"]);
    assert.deepEqual(ALLOWED_STATUSES.done, ["in_progress"]);
    assert.deepEqual(ALLOWED_STATUSES.confirm, ["done"]);
    assert.ok(!ALLOWED_STATUSES.cancel.includes("done") && !ALLOWED_STATUSES.cancel.includes("cancelled"));
    assert.ok(!ALLOWED_STATUSES.setSigners.includes("signed_off"), "signers are fixed once signed off");
    for (const a of Object.keys(ALLOWED_STATUSES) as MovementAction[]) {
      assert.ok(!ALLOWED_STATUSES[a].includes("done") || a === "confirm");
      assert.ok(!ALLOWED_STATUSES[a].includes("cancelled"));
    }
  });
});

describe("state machine: who can do what", () => {
  it("managing needs a delivery manager; a plain user gets 403 whatever the status", () => {
    for (const a of ["edit", "refresh", "setSigners", "cancel"] as const) {
      assert.equal(ok(a, "ready", manager), true);
      assert.equal(ok(a, "ready", admin), true);
      const d = authorize(a, { status: "done", actor: plain, slots: slots() });
      assert.deepEqual([d.ok, !d.ok && d.code], [false, "forbidden"]); // permission is checked before the status
    }
  });

  it("only the user named in the slot signs (case-insensitive); an admin is NOT exempt", () => {
    assert.equal(ok("sign", "ready", { email: "DEP@X.COM", isManager: false, isAdmin: false }, { slot: "deployer" }), true);
    assert.equal(ok("sign", "ready", admin, { slot: "deployer" }), false);
    assert.equal(ok("sign", "ready", manager, { slot: "ba" }), false);
    assert.equal(ok("sign", "ready", { email: "ba@x.com", isManager: false, isAdmin: false }, { slot: "lead" }), false);
    const d = authorize("sign", { status: "draft", actor: { email: "ba@x.com", isManager: false, isAdmin: false }, slots: slots(), slot: "ba" });
    assert.deepEqual([d.ok, !d.ok && d.code], [false, "conflict"]); // right person, wrong state
  });

  it("start / done / confirm: the deployer or an admin; the BA, the lead and a manager cannot", () => {
    for (const [a, st] of [["start", "signed_off"], ["done", "in_progress"], ["confirm", "done"]] as const) {
      assert.equal(ok(a, st, deployer), true);
      assert.equal(ok(a, st, admin), true);
      assert.equal(ok(a, st, { email: "ba@x.com", isManager: false, isAdmin: false }), false);
      assert.equal(ok(a, st, manager), false);
    }
  });

  it("override and revoke are ADMIN only (a delivery manager is not enough)", () => {
    assert.equal(ok("override", "ready", admin), true);
    assert.equal(ok("override", "ready", manager), false);
    assert.equal(ok("revoke", "signed_off", admin), true);
    assert.equal(ok("revoke", "in_progress", admin), false);
    assert.equal(cleanReason("  needs a business owner decision  "), "needs a business owner decision");
    assert.equal(cleanReason("no"), null);
    assert.equal(cleanReason("   "), null);
    assert.equal(cleanReason("x".repeat(501)), null);
    assert.equal(cleanReason(undefined), null);
  });

  it("permissionsFor reports the same answers the guards give", () => {
    const p = permissionsFor("signed_off", deployer, slots([H1, H1, H1, H1]), H1);
    assert.deepEqual([p.start, p.edit, p.override, p.cancel], [true, false, false, false]);
    assert.deepEqual(p.sign, []); // already signed at the current hash
    assert.deepEqual(permissionsFor("ready", deployer, slots(), H1).sign, ["deployer"]);
    assert.deepEqual(permissionsFor("in_progress", deployer, slots(), H1).sign, [], "no signing after the start");
  });

  it("email validation accepts normal addresses and rejects junk", () => {
    assert.ok(isValidEmail("a.b+c@salescode.ai"));
    for (const bad of ["", "a@b", "a b@c.com", "<a@b.com>", "a@b.com, c@d.com", 5, null]) assert.equal(isValidEmail(bad), false);
  });
});

describe("state machine: sign-offs are for ONE hash", () => {
  it("a stale hash is refused with the new hash; a fresh one is accepted; an empty selection is refused", () => {
    const stale = checkSignable({ currentHash: H2, signingHash: H1, includedCount: 3 });
    assert.equal(stale.ok, false);
    assert.equal(!stale.ok && stale.code, "conflict");
    assert.deepEqual(!stale.ok && stale.extra, { currentHash: H2 });
    assert.equal(checkSignable({ currentHash: H1, signingHash: H1, includedCount: 3 }).ok, true);
    assert.equal(checkSignable({ currentHash: H1, signingHash: H1, includedCount: 0 }).ok, false);
    assert.equal(checkSignable({ currentHash: null, signingHash: H1, includedCount: 3 }).ok, false);
  });

  it("signed_off needs all three slots at the CURRENT hash; start re-checks it", () => {
    assert.equal(statusAfterSign(slots([H1, H1, null, null]), H1), "ready");
    assert.equal(statusAfterSign(slots([H1, H1, H1, H1]), H1), "signed_off");
    assert.equal(statusAfterSign(slots([H1, H2, H1, H1]), H1), "ready", "a sign-off of another hash does not count");
    assert.equal(allSignedAt(slots([H1, H1, H1, H1]), null), false);
    assert.equal(checkStartable({ slots: slots([H1, H1, H1, H1]), currentHash: H1, includedCount: 1 }).ok, true);
    assert.equal(checkStartable({ slots: slots([H1, H1, H1, H1]), currentHash: H2, includedCount: 1 }).ok, false);
    assert.equal(checkStartable({ slots: slots([H1, H1, H1, H1]), currentHash: H1, includedCount: 0 }).ok, false);
    assert.deepEqual(signableSlots("ready", slots([H1, null, null, null]), "dep@x.com", H1), [], "signed at the current hash: nothing left to sign");
    assert.deepEqual(signableSlots("ready", slots([H2, null, null, null]), "dep@x.com", H1), ["deployer"], "signed an older hash: can sign again");
  });
});

describe("state machine: a change of the checklist hash", () => {
  it("draft becomes ready on the first successful refresh", () => {
    assert.deepEqual(onHashChange({ status: "draft", prevHash: null, nextHash: H1, signedCount: 0 }), { status: "ready", clearSignoffs: false, event: "became_ready", notify: null });
  });

  it("ready / signed_off: same hash = nothing; changed hash CLEARS the sign-offs, back to ready, event, notify only if somebody had signed", () => {
    for (const st of ["ready", "signed_off"] as const) {
      assert.deepEqual(onHashChange({ status: st, prevHash: H1, nextHash: H1, signedCount: 3 }), { status: st, clearSignoffs: false, event: null, notify: null });
    }
    assert.deepEqual(onHashChange({ status: "signed_off", prevHash: H1, nextHash: H2, signedCount: 3 }), { status: "ready", clearSignoffs: true, event: "checklist_changed", notify: "reset" });
    assert.deepEqual(onHashChange({ status: "ready", prevHash: H1, nextHash: H2, signedCount: 1 }), { status: "ready", clearSignoffs: true, event: "checklist_changed", notify: "reset" });
    assert.deepEqual(onHashChange({ status: "ready", prevHash: H1, nextHash: H2, signedCount: 0 }), { status: "ready", clearSignoffs: true, event: "checklist_changed", notify: null });
  });

  it("in_progress does NOT reset: it records changed_after_start and notifies", () => {
    assert.deepEqual(onHashChange({ status: "in_progress", prevHash: H1, nextHash: H2, signedCount: 3 }), { status: "in_progress", clearSignoffs: false, event: "changed_after_start", notify: "after_start" });
    assert.equal(onHashChange({ status: "in_progress", prevHash: H1, nextHash: H1, signedCount: 3 }).event, null);
  });

  it("done and cancelled are frozen: a new hash changes nothing", () => {
    for (const st of ["done", "cancelled"] as const) {
      assert.deepEqual(onHashChange({ status: st, prevHash: H1, nextHash: H2, signedCount: 3 }), { status: st, clearSignoffs: false, event: null, notify: null });
    }
  });
});

describe("the QA lead slot", () => {
  it("is a fourth sign-off: start and signed_off wait for it", () => {
    assert.equal(allSignedAt(slots([H1, H1, H1, null]), H1), false);
    assert.equal(statusAfterSign(slots([H1, H1, H1, null]), H1), "ready");
    assert.equal(statusAfterSign(slots([H1, H1, H1, H1]), H1), "signed_off");
    assert.equal(checkStartable({ slots: slots([H1, H1, H1, null]), currentHash: H1, includedCount: 1 }).ok, false);
  });
  it("the QA lead can sign as qa_lead and holds only that slot", () => {
    assert.deepEqual(slotsOf(slots(), "QA@x.com"), ["qa_lead"]);
    assert.deepEqual(signableSlots("ready", slots(), "qa@x.com", H1), ["qa_lead"]);
  });
  it("a movement made before the slot existed (no QA lead row) is not held up for it", () => {
    const legacy = slots([H1, H1, H1, null]);
    legacy.qa_lead = { email: "", signedHash: null };
    assert.equal(allSignedAt(legacy, H1), true);
    assert.equal(statusAfterSign(legacy, H1), "signed_off");
    assert.equal(checkStartable({ slots: legacy, currentHash: H1, includedCount: 1 }).ok, true);
  });
});

/**
 * The movement state machine. PURE: no I/O, no clock. The DB layer (service.ts / refresh.ts) asks
 * these functions what is allowed and what a change of the checklist hash does, then writes it.
 *
 *   draft -> ready (first successful refresh) -> signed_off (all 3 slots signed at the CURRENT
 *   hash) -> in_progress (the deployer starts) -> done;  cancelled from any non-done state.
 *
 * Who may act:
 *   manage (create, tick, branches, refresh, cancel, set signers) = delivery managers (ADMIN or the flag)
 *   sign                         = only the user named in that slot (email, case-insensitive; an
 *                                  ADMIN is NOT exempt: a sign-off is a person's statement)
 *   start / done / confirm       = the deployer slot's user, or an ADMIN
 *   override / revoke            = ADMIN, with a mandatory reason
 *
 * A change of the checklist hash:
 *   ready / signed_off  -> every sign-off is CLEARED, status back to ready, event + notify
 *   in_progress         -> NOT reset (the deployment is under way); recorded as changed_after_start + notify
 *   done / cancelled    -> frozen, never changes
 */
import { MOVEMENT_SLOT_VALUES, type MovementSlot, type MovementStatus } from "../values";

export type MovementAction =
  | "edit" // tick / untick, branches
  | "refresh"
  | "setSigners"
  | "cancel"
  | "sign"
  | "start"
  | "done"
  | "confirm"
  | "override"
  | "revoke";

export interface ActorInfo {
  email: string;
  /** canManageDeliveries(user): ADMIN or the delivery-manager flag. */
  isManager: boolean;
  /** hasMinRole(user.role, "ADMIN"). */
  isAdmin: boolean;
}

export interface SlotState {
  email: string;
  signedHash: string | null;
}
export type Slots = Record<MovementSlot, SlotState>;

export type Denied = {
  ok: false;
  /** forbidden -> HTTP 403, conflict -> HTTP 409. */
  code: "forbidden" | "conflict";
  message: string;
  extra?: Record<string, unknown>;
};
export type Decision = { ok: true } | Denied;

const OK: Decision = { ok: true };
const deny = (code: Denied["code"], message: string, extra?: Denied["extra"]): Denied => ({ ok: false, code, message, ...(extra ? { extra } : {}) });

/** The statuses in which each action is possible. */
export const ALLOWED_STATUSES: Readonly<Record<MovementAction, readonly MovementStatus[]>> = {
  // signed_off is allowed: an edit there clears the sign-offs (hash change) and returns to ready.
  edit: ["draft", "ready", "signed_off"],
  refresh: ["draft", "ready", "signed_off", "in_progress"],
  // Signers are fixed once everyone has signed.
  setSigners: ["draft", "ready"],
  cancel: ["draft", "ready", "signed_off", "in_progress"],
  sign: ["ready", "signed_off"],
  start: ["signed_off"],
  done: ["in_progress"],
  confirm: ["done"],
  override: ["draft", "ready", "signed_off"],
  revoke: ["draft", "ready", "signed_off"],
};

export const normEmail = (e: string): string => e.trim().toLowerCase();

/** Same address, whatever the case. */
export const sameEmail = (a: string, b: string): boolean => normEmail(a) === normEmail(b);

const EMAIL_RE = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\]+$/;
export function isValidEmail(e: unknown): e is string {
  return typeof e === "string" && e.length <= 254 && EMAIL_RE.test(e.trim());
}

/** The slots this user holds (a person can hold several). */
export function slotsOf(slots: Slots, email: string): MovementSlot[] {
  return MOVEMENT_SLOT_VALUES.filter((s) => sameEmail(slots[s].email, email));
}

export const REASON_MIN = 5;
export const REASON_MAX = 500;
/** Override / revoke reason: trimmed text, 5..500 characters. Returns the trimmed reason or null. */
export function cleanReason(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  const r = reason.trim();
  return r.length >= REASON_MIN && r.length <= REASON_MAX ? r : null;
}

/**
 * May `actor` do `action` on a movement in `status`? Permission first (403), then status (409),
 * so a user without rights never learns the state. `slot` is required for "sign".
 */
export function authorize(
  action: MovementAction,
  ctx: { status: MovementStatus; actor: ActorInfo; slots?: Slots; slot?: MovementSlot }
): Decision {
  const { status, actor } = ctx;
  switch (action) {
    case "edit":
    case "refresh":
    case "setSigners":
    case "cancel":
      if (!actor.isManager) return deny("forbidden", "Only delivery managers can do this");
      break;
    case "override":
    case "revoke":
      if (!actor.isAdmin) return deny("forbidden", "Only an admin can override or revoke an override");
      break;
    case "sign": {
      if (!ctx.slot || !ctx.slots) return deny("forbidden", "Choose the slot to sign");
      if (!sameEmail(ctx.slots[ctx.slot].email, actor.email)) return deny("forbidden", `Only ${ctx.slots[ctx.slot].email} can sign as ${ctx.slot}`);
      break;
    }
    case "start":
    case "done":
    case "confirm":
      if (!actor.isAdmin && !(ctx.slots && sameEmail(ctx.slots.deployer.email, actor.email))) {
        return deny("forbidden", "Only the deployer (or an admin) can do this");
      }
      break;
  }
  if (!ALLOWED_STATUSES[action].includes(status)) {
    return deny("conflict", `Cannot ${labelOf(action)} a movement that is ${status.replace("_", " ")}`, { status });
  }
  return OK;
}

function labelOf(a: MovementAction): string {
  switch (a) {
    case "edit":
      return "edit";
    case "setSigners":
      return "change the signers of";
    case "override":
      return "override an item of";
    case "revoke":
      return "revoke an override on";
    case "confirm":
      return "confirm statuses of";
    default:
      return a;
  }
}

/** Every slot signed the given hash. */
export function allSignedAt(slots: Slots, hash: string | null): boolean {
  return hash !== null && MOVEMENT_SLOT_VALUES.every((s) => slots[s].signedHash === hash);
}

/**
 * A sign-off is accepted only for the hash the movement has NOW. A stale hash is refused with the
 * new one so the client can reload and show what changed; nothing signs an old checklist.
 */
export function checkSignable(input: { currentHash: string | null; signingHash: string; includedCount: number }): Decision {
  if (input.currentHash === null) return deny("conflict", "The checklist has not been built yet; refresh first");
  if (input.signingHash !== input.currentHash) {
    return deny("conflict", "The checklist changed since you opened it; review the changes and sign again", { currentHash: input.currentHash });
  }
  if (input.includedCount < 1) return deny("conflict", "No Jira is selected for this movement");
  return OK;
}

/** Start needs the three sign-offs at the hash that is current right now. */
export function checkStartable(input: { slots: Slots; currentHash: string | null; includedCount: number }): Decision {
  if (input.includedCount < 1) return deny("conflict", "No Jira is selected for this movement");
  if (!allSignedAt(input.slots, input.currentHash)) {
    return deny("conflict", "All three sign-offs must be on the current checklist", { currentHash: input.currentHash });
  }
  return OK;
}

/** Status after a sign-off was recorded. */
export function statusAfterSign(slots: Slots, currentHash: string): MovementStatus {
  return allSignedAt(slots, currentHash) ? "signed_off" : "ready";
}

export type HashEvent = "became_ready" | "checklist_changed" | "changed_after_start";
export type NotifyKind = "reset" | "after_start";

export interface HashChange {
  status: MovementStatus;
  /** Clear signed_at / signed_hash of every slot. */
  clearSignoffs: boolean;
  /** The event to write, or null when nothing really changed. */
  event: HashEvent | null;
  /** Who should be told, or null. `reset` only when somebody had signed. */
  notify: NotifyKind | null;
}

/**
 * What a freshly computed checklist hash does to a movement. `prevHash` is the stored one (null
 * before the first successful refresh); `signedCount` is how many slots hold a sign-off.
 */
export function onHashChange(input: { status: MovementStatus; prevHash: string | null; nextHash: string; signedCount: number }): HashChange {
  const { status, prevHash, nextHash, signedCount } = input;
  const same = prevHash === nextHash;
  switch (status) {
    case "draft":
      // The first successful refresh makes the movement ready.
      return { status: "ready", clearSignoffs: false, event: "became_ready", notify: null };
    case "ready":
    case "signed_off":
      if (same) return { status, clearSignoffs: false, event: null, notify: null };
      return { status: "ready", clearSignoffs: true, event: "checklist_changed", notify: signedCount > 0 ? "reset" : null };
    case "in_progress":
      if (same) return { status, clearSignoffs: false, event: null, notify: null };
      return { status, clearSignoffs: false, event: "changed_after_start", notify: "after_start" };
    case "done":
    case "cancelled":
      return { status, clearSignoffs: false, event: null, notify: null };
  }
}

/** done / cancelled never change (no refresh, no edits). */
export const isFrozen = (s: MovementStatus): boolean => s === "done" || s === "cancelled";

/** The slots a user could sign right now (for the UI): empty unless the movement is ready / signed_off. */
export function signableSlots(status: MovementStatus, slots: Slots, email: string, currentHash: string | null): MovementSlot[] {
  if (!ALLOWED_STATUSES.sign.includes(status)) return [];
  return slotsOf(slots, email).filter((s) => slots[s].signedHash !== currentHash || currentHash === null);
}

/** What the actor may do now, for the view (the server re-checks every action). */
export function permissionsFor(status: MovementStatus, actor: ActorInfo, slots: Slots, currentHash: string | null) {
  const can = (a: MovementAction) => authorize(a, { status, actor, slots }).ok;
  return {
    edit: can("edit"),
    refresh: can("refresh"),
    setSigners: can("setSigners"),
    cancel: can("cancel"),
    override: can("override"),
    revoke: can("revoke"),
    start: can("start"),
    done: can("done"),
    confirm: can("confirm"),
    sign: signableSlots(status, slots, actor.email, currentHash),
  };
}

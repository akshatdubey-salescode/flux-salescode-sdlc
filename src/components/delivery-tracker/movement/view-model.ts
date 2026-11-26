/**
 * Pure view-model helpers of the movement UI: labels, which action a user may take (from the API
 * response, never guessed), readiness grouping, summary strings, incremental-render chunking and
 * the copy-text assembly. No React, no fetch, no Date.now() (callers pass `now`), so every
 * function here is unit-tested with node:test.
 *
 * Client-safe imports only: render.ts and state.ts import nothing but types and values.ts.
 */
import { formatSources, renderText } from "@/lib/movement/checklist/render";
import type { Checklist, ChecklistItem, ChecklistSection, Conflict, ItemSource, SectionId } from "@/lib/movement/checklist/types";
import { ALLOWED_STATUSES, type MovementAction } from "@/lib/movement/service/state";
import { MOVEMENT_ENVIRONMENT_VALUES, MOVEMENT_SLOT_VALUES, type MovementEnvironment, type MovementSlot, type MovementStatus } from "@/lib/movement/values";
import type { ChangesResponse, ItemPrDetail, ItemView, MovementEventRow, MovementListItem, MovementMe, MovementPermissions, MovementSigner, MovementView } from "./api-types";

// ---------------------------------------------------------------------------------------------
// labels and tones
// ---------------------------------------------------------------------------------------------

export type Tone = "neutral" | "info" | "ok" | "warn" | "danger" | "muted";

/** Chip colours, same palette as the delivery statuses (light + dark). */
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  muted: "bg-muted/60 text-muted-foreground",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  danger: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export const ENV_OPTIONS: ReadonlyArray<{ value: MovementEnvironment; label: string }> = MOVEMENT_ENVIRONMENT_VALUES.map((v) => ({
  value: v,
  label: v === "uat" ? "UAT" : v === "demo" ? "Demo" : "Prod",
}));

export function envLabel(env: string): string {
  return ENV_OPTIONS.find((o) => o.value === env)?.label ?? env;
}

export const SLOT_LABELS: Record<MovementSlot, string> = { deployer: "Deployer", ba: "BA", lead: "Lead", qa_lead: "QA Lead" };

const STATUS_LABELS: Record<MovementStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  signed_off: "Signed off",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as MovementStatus] ?? humanize(status);
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "draft":
      return "muted";
    case "ready":
      return "info";
    case "signed_off":
      return "ok";
    case "in_progress":
      return "warn";
    case "done":
      return "ok";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

/** `items_ticked` -> `Items ticked` (unknown event / status values still read fine). */
export function humanize(s: string): string {
  const t = s.replace(/_/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

const EVENT_LABELS: Record<string, string> = {
  created: "Movement created",
  became_ready: "Checklist ready",
  checklist_changed: "Checklist changed, sign-offs reset",
  changed_after_start: "Checklist changed after the start",
  items_ticked: "Jiras ticked",
  items_unticked: "Jiras unticked",
  items_changed: "Jiras changed by a refresh",
  override: "Blocked Jira overridden",
  override_revoked: "Override revoked",
  branches_changed: "Branches changed",
  signers_changed: "Signers changed",
  signed: "Signed",
  signed_off: "All signed",
  started: "Deployment started",
  done: "Marked done",
  statuses_confirmed: "Delivery statuses confirmed",
  cancelled: "Movement cancelled",
  refresh_failed: "Reading the Jira review comments failed",
  refresh_recovered: "Jira review comments read again",
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? humanize(type);
}

// ---------------------------------------------------------------------------------------------
// dates (the rest of the app shows IST, en-IN)
// ---------------------------------------------------------------------------------------------

const istYear = (d: Date): string => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric" });

/**
 * "19 Nov, 11:30 am" in IST; "never" for null, "-" for an unparsable value. A time from an earlier (or later)
 * year than `nowMs`'s carries the year ("19 Nov 2025, 11:30 am"), so an old history entry is not read as this year's.
 */
export function formatIst(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const withYear = istYear(d) !== istYear(new Date(nowMs));
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", ...(withYear ? { year: "numeric" as const } : {}), hour: "2-digit", minute: "2-digit", hour12: true });
}

/** "just now", "5 min ago", "3 h ago", "2 d ago"; "never" for null. */
export function formatAge(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "-";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/**
 * "Now" on the SERVER's clock: the view's `serverNow` plus the time that has passed in this browser
 * since the view arrived (`receivedAt`, a browser timestamp). Ages ("read 5 min ago") are measured on
 * the clock that wrote the timestamps, so a wrong laptop clock cannot make them wrong; without a
 * usable serverNow it falls back to the browser clock.
 */
export function serverNowAt(serverNow: string | null | undefined, receivedAt: number | null, localNow: number): number {
  const t = serverNow ? Date.parse(serverNow) : Number.NaN;
  if (Number.isNaN(t) || receivedAt === null) return localNow;
  return t + Math.max(0, localNow - receivedAt);
}

/**
 * Opening a movement re-reads the Jira records once if they are older than this. It matches the 30-minute cron
 * (/api/cron/movements) on purpose: a refresh that finds changed records RESETS the sign-offs of a ready / signed_off
 * movement, so opening a signed_off movement must not do that more often than the cron already would.
 */
export const AUTO_REFRESH_AFTER_MS = 30 * 60 * 1000;

/** The notice's reason text for an automatic refresh, built from the constant so the words can never disagree with the threshold. */
export function autoRefreshReason(): string {
  return `the data was older than ${Math.round(AUTO_REFRESH_AFTER_MS / 60_000)} minutes or could not be read`;
}

/** Refresh once per open when the view is older than 30 minutes (or was never refreshed) and the user may refresh. */
export function needsAutoRefresh(refreshedAt: string | null | undefined, now: number, canRefresh: boolean, maxAgeMs = AUTO_REFRESH_AFTER_MS): boolean {
  if (!canRefresh) return false;
  if (!refreshedAt) return true;
  const t = Date.parse(refreshedAt);
  return Number.isNaN(t) || now - t > maxAgeMs;
}

// ---------------------------------------------------------------------------------------------
// the delivery card: environment chips
// ---------------------------------------------------------------------------------------------

export interface EnvChip {
  env: MovementEnvironment;
  label: string;
  /** null = no movement to this environment yet. */
  status: MovementStatus | null;
  movementId: string | null;
  /** A cancelled movement does not block a new one. */
  canStart: boolean;
}

/**
 * One chip per environment from the (newest-first) list of the delivery's movements. The live
 * one (not cancelled) wins; otherwise the newest cancelled one is shown as "cancelled".
 */
export function envChips(list: ReadonlyArray<Pick<MovementListItem, "id" | "environment" | "status">> | null): EnvChip[] {
  return ENV_OPTIONS.map(({ value, label }) => {
    const mine = (list ?? []).filter((m) => m.environment === value);
    const live = mine.find((m) => m.status !== "cancelled");
    const pick = live ?? mine[0] ?? null;
    return {
      env: value,
      label,
      status: (pick?.status as MovementStatus | undefined) ?? null,
      movementId: pick?.id ?? null,
      canStart: !live,
    };
  });
}

/** `closed`: the delivery is completed (or deleted); the server refuses a movement then (409 delivery_closed), so the button is not offered. */
export function startAction(chip: EnvChip, canManage: boolean, closed = false): { enabled: boolean; reason: string | null } {
  if (closed) return { enabled: false, reason: "A completed delivery cannot be moved to an environment; reopen it first" };
  if (!canManage) return { enabled: false, reason: "Only delivery managers can start a movement" };
  if (!chip.canStart) return { enabled: false, reason: `There is already a ${statusLabel(chip.status ?? "").toLowerCase()} ${chip.label} movement; open it instead` };
  return { enabled: true, reason: null };
}

// ---------------------------------------------------------------------------------------------
// action availability (server permissions + a reason when they say no)
// ---------------------------------------------------------------------------------------------

export type PanelAction = Exclude<MovementAction, "sign">;

const ROLE_REASON: Record<PanelAction, string> = {
  edit: "Only delivery managers can do this",
  refresh: "Only delivery managers can do this",
  setSigners: "Only delivery managers can do this",
  cancel: "Only delivery managers can do this",
  override: "Only an admin can override a blocked Jira",
  revoke: "Only an admin can revoke an override",
  start: "Only the deployer (or an admin) can start the deployment",
  done: "Only the deployer (or an admin) can mark it done",
  confirm: "Only the deployer (or an admin) can confirm the statuses",
};

export interface ActionState {
  allowed: boolean;
  reason: string | null;
}

export const NEEDS_REFRESH_REASON = "The stored Jira data must be re-read before this can be done; use Refresh";

/** Why approvals (sign, start) and edits are closed even for the right person: the data is unreadable or the last refresh failed. */
export function approvalsBlockedReason(v: { needsRefresh: boolean; refreshError: string | null }): string | null {
  if (v.needsRefresh) return NEEDS_REFRESH_REASON;
  if (v.refreshError) return `The last refresh failed (${v.refreshError}); refresh again before approving`;
  return null;
}

/** Does this person's ROLE fit the action (the server's own rule, from `me`)? Only used to word a refusal. */
function roleFits(action: PanelAction, me: Pick<MovementMe, "isManager" | "isAdmin" | "slots">): boolean {
  switch (action) {
    case "edit":
    case "refresh":
    case "setSigners":
    case "cancel":
      return me.isManager;
    case "override":
    case "revoke":
      return me.isAdmin;
    case "start":
    case "done":
    case "confirm":
      return me.isAdmin || me.slots.includes("deployer");
  }
}

type ActionView = {
  movement: Pick<MovementView["movement"], "status">;
  permissions: Pick<MovementPermissions, PanelAction>;
  signers: ReadonlyArray<Pick<MovementSigner, "slot" | "signedCurrent">>;
  me: Pick<MovementMe, "isManager" | "isAdmin" | "slots">;
  needsRefresh: boolean;
  refreshError: string | null;
};

/**
 * May the current user do `action` now? `allowed` is the server's own answer (`permissions`, which
 * already folds in the role, the status, needsRefresh and refreshError); the reason is only text for the
 * tooltip of a disabled control and is derived from `me`, the status and the two refresh fields.
 */
export function actionState(action: PanelAction, view: ActionView): ActionState {
  if (view.permissions[action]) return { allowed: true, reason: null };
  const status = view.movement.status as MovementStatus;
  if (!ALLOWED_STATUSES[action].includes(status)) {
    if (action === "start" && status === "ready") return { allowed: false, reason: `Waiting for ${waitingSlots(view.signers) || "all sign-offs"}` };
    return { allowed: false, reason: `Not available while the movement is ${statusLabel(status).toLowerCase()}` };
  }
  if (!roleFits(action, view.me)) return { allowed: false, reason: ROLE_REASON[action] };
  // Role and status fit, yet the server says no: stale or failed Jira data (edit, start, done).
  const blocked = action === "edit" || action === "start" || action === "done" ? approvalsBlockedReason(view) : null;
  return { allowed: false, reason: blocked ?? ROLE_REASON[action] };
}

function waitingSlots(signers: ReadonlyArray<Pick<MovementSigner, "slot" | "signedCurrent"> & { email?: string }>): string {
  const w = signers.filter((s) => !s.signedCurrent && s.email !== "").map((s) => SLOT_LABELS[s.slot as MovementSlot] ?? s.slot);
  return w.length ? `sign-off from ${w.join(", ")}` : "";
}

export type SignerState = "signed" | "waiting" | "you" | "stale";

export interface SignerRow {
  slot: MovementSlot;
  label: string;
  email: string;
  name: string | null;
  state: SignerState;
  /** The viewer holds this slot (`me.slots`): shown as "You" even after they signed. */
  isMe: boolean;
  signedAt: string | null;
  canSign: boolean;
  /** Why the Sign button is disabled (null when it is enabled). */
  signReason: string | null;
}

/**
 * The signer rows (a slot nobody holds, the QA lead of a movement made before that slot existed, has none). Who the viewer is comes from `me` (the server's reading of the session), never
 * guessed from the permissions. "Your turn" = the viewer holds the slot, has not signed the current
 * checklist and sign-offs are open. `reviewedHash` is the checklist the user can actually see (the loaded
 * checklist's hash): Sign is only enabled when it equals the movement's current hash AND the server
 * lists the slot in `permissions.sign` (which is empty while the data is stale or the last refresh failed).
 */
export function signerRows(
  view: Pick<MovementView, "movement" | "signers" | "permissions" | "me" | "needsRefresh" | "refreshError"> & { items?: ReadonlyArray<Pick<ItemView, "included">> },
  reviewedHash: string | null
): SignerRow[] {
  const { status, hash } = view.movement;
  const signOpen = ALLOWED_STATUSES.sign.includes(status as MovementStatus);
  return MOVEMENT_SLOT_VALUES.filter((slot) => !!view.signers.find((x) => x.slot === slot)?.email).map((slot) => {
    const s = view.signers.find((x) => x.slot === slot);
    const isMe = view.me.slots.includes(slot);
    const signedNow = !!s?.signedCurrent;
    const state: SignerState = signedNow ? "signed" : isMe && signOpen ? "you" : s?.signed ? "stale" : "waiting";
    let signReason: string | null = null;
    let canSign = false;
    if (state === "you") {
      if (!view.permissions.sign.includes(slot)) signReason = approvalsBlockedReason(view) ?? (view.items && nothingSelected(view.items) ? NOTHING_SELECTED_REASON : "You cannot sign right now");
      else if (!reviewedHash || reviewedHash !== hash) signReason = "The checklist is still loading; wait until it is shown";
      else canSign = true;
    } else if (signedNow) signReason = "Already signed this checklist";
    else if (!signOpen) signReason = `Sign-offs are not open while the movement is ${statusLabel(status).toLowerCase()}`;
    else signReason = `Only ${s?.email || "the named person"} can sign as ${SLOT_LABELS[slot]}`;
    return { slot, label: SLOT_LABELS[slot], email: s?.email ?? "", name: s?.name ?? null, state, isMe, signedAt: s?.signedAt ?? null, canSign, signReason };
  });
}

// ---------------------------------------------------------------------------------------------
// Jira list: readiness grouping, counts, filters, warnings vs blockers
// ---------------------------------------------------------------------------------------------

export interface ItemCounts {
  total: number;
  ready: number;
  blocked: number;
  overridden: number;
  /** In the checklist (the server's effective tick: ticked and not blocked). */
  included: number;
  /** Not blocked but not ticked. */
  unticked: number;
}

type CountItem = Pick<ItemView, "included" | "readiness">;

export function countItems(items: ReadonlyArray<CountItem>): ItemCounts {
  const c: ItemCounts = { total: items.length, ready: 0, blocked: 0, overridden: 0, included: 0, unticked: 0 };
  for (const i of items) {
    if (i.readiness === "blocked") c.blocked++;
    else if (i.readiness === "override") c.overridden++;
    else c.ready++;
    if (i.included) c.included++;
    else if (i.readiness !== "blocked") c.unticked++;
  }
  return c;
}

/** "12 ready, 3 blocked, 1 overridden, 2 unticked" (zero counts left out; "no Jiras" when empty). */
export function countsLine(c: ItemCounts): string {
  if (c.total === 0) return "no Jiras";
  const parts = [`${c.ready} ready`, `${c.blocked} blocked`];
  if (c.overridden) parts.push(`${c.overridden} overridden`);
  parts.push(`${c.unticked} unticked`);
  return parts.join(", ");
}

/** How a Jira reads in the list: blocked (red), overridden, ready with soft warnings (amber), clean. Decided from the server's blockers / softWarnings, never from codes. */
export type ReadinessGroup = "blocked" | "overridden" | "warnings" | "clean";

export function readinessGroup(i: Pick<ItemView, "readiness" | "softWarnings">): ReadinessGroup {
  if (i.readiness === "blocked") return "blocked";
  if (i.readiness === "override") return "overridden";
  return i.softWarnings.length > 0 ? "warnings" : "clean";
}

export function groupCounts(items: ReadonlyArray<Pick<ItemView, "readiness" | "softWarnings">>): Record<ReadinessGroup, number> {
  const out: Record<ReadinessGroup, number> = { blocked: 0, overridden: 0, warnings: 0, clean: 0 };
  for (const i of items) out[readinessGroup(i)]++;
  return out;
}

export type ItemFilter = "all" | "blocked" | "ready" | "overridden" | "unticked" | "warnings";

export function filterItems<T extends Pick<ItemView, "key" | "summary" | "included" | "readiness" | "softWarnings">>(items: readonly T[], filter: ItemFilter, query: string): T[] {
  const q = query.trim().toLowerCase();
  return items.filter((i) => {
    if (q && !i.key.toLowerCase().includes(q) && !i.summary.toLowerCase().includes(q)) return false;
    switch (filter) {
      case "blocked":
        return i.readiness === "blocked";
      case "ready":
        return i.readiness === "ready";
      case "overridden":
        return i.readiness === "override";
      case "unticked":
        return !i.included && i.readiness !== "blocked";
      case "warnings":
        return i.softWarnings.length > 0;
      default:
        return true;
    }
  });
}

export interface TickState {
  checked: boolean;
  disabled: boolean;
  reason: string | null;
}

/**
 * The tick box of a Jira. `included` is the effective tick (what the checklist uses); `ticked` is the stored
 * one. A blocked Jira shows unticked and disabled; if its stored tick is on, the reason says it takes
 * effect once an admin overrides the block.
 */
export function tickState(item: Pick<ItemView, "included" | "readiness"> & { ticked?: boolean }, canEdit: boolean, editReason: string | null): TickState {
  if (item.readiness === "blocked") {
    return {
      checked: false,
      disabled: true,
      reason: `Blocked: no review comment is posted on this Jira (or a sub-Jira). An admin can override it with a reason.${item.ticked ? " Its tick is kept and applies once it is overridden." : ""}`,
    };
  }
  if (!canEdit) return { checked: item.included, disabled: true, reason: editReason ?? "You cannot change the selection" };
  return { checked: item.included, disabled: false, reason: null };
}

/** "auto" = ticked by the refresh because its records are valid; "chosen" = a person ticked or unticked it (a refresh never changes it); null = not ticked. */
export function tickOrigin(item: Pick<ItemView, "ticked" | "tickSet">): "auto" | "chosen" | null {
  if (item.tickSet) return "chosen";
  return item.ticked ? "auto" : null;
}

/** The single status chip of a row: Ready / Blocked / Overridden / Not selected (ready but not ticked). */
export type RowStatus = "ready" | "blocked" | "overridden" | "notSelected";

export function rowStatus(i: Pick<ItemView, "readiness" | "included">): RowStatus {
  if (i.readiness === "blocked") return "blocked";
  if (i.readiness === "override") return "overridden";
  return i.included ? "ready" : "notSelected";
}

export const ROW_STATUS: Record<RowStatus, { label: string; tone: Tone }> = {
  ready: { label: "Ready", tone: "ok" },
  blocked: { label: "Blocked", tone: "danger" },
  overridden: { label: "Overridden", tone: "warn" },
  notSelected: { label: "Not selected", tone: "muted" },
};

/** A tiny Dev / Tester mark: a tick when signed, a dash when missing; the tooltip says who and when. */
export function signoffMark(role: "Dev" | "Tester", v: ItemView["signoffs"]["dev"]): { mark: string; signed: boolean; label: string; title: string } {
  return v === null
    ? { mark: "–", signed: false, label: `${role}: missing`, title: `${role} sign-off is missing` }
    : { mark: "✓", signed: true, label: `${role}: signed`, title: `${role} signed by ${v.by} at ${formatIst(v.at)}` };
}

/** The reminder shown while a tick is on its way: a change of the selection clears the sign-offs. */
export const TICK_RESETS_SIGNOFFS = "Changing the selection resets the sign-offs.";

export type SignoffChip = { label: string; tone: Tone; title: string };

/**
 * Dev / tester sign-off chips of EVERY Jira (also an unticked one), from the view's own `signoffs`
 * (the existing test-case sign-offs); missing = highlighted, never blocking.
 */
export function signoffChips(s: ItemView["signoffs"]): SignoffChip[] {
  const one = (role: string, v: ItemView["signoffs"]["dev"]): SignoffChip =>
    v === null
      ? { label: `${role}: missing`, tone: "warn", title: `${role} sign-off is missing` }
      : { label: `${role}: signed`, tone: "ok", title: `${role} signed by ${v.by} at ${formatIst(v.at)}` };
  return [one("Dev", s.dev), one("Tester", s.tester)];
}

/** "3 review comments" chip text. */
export function recordsLabel(n: number): string {
  return `${n} review comment${n === 1 ? "" : "s"}`;
}

/** "1 review comment · 2 PRs" for a Jira's summary line (the detail has the rows). */
export function reviewSummary(i: Pick<ItemView, "reviews" | "prs">): string {
  const c = i.prs?.covered ?? 0;
  return `${i.reviews} review comment${i.reviews === 1 ? "" : "s"}${c > 0 ? ` · ${c} PR${c === 1 ? "" : "s"}` : ""}`;
}

/** Notes (blockers + warnings) the view cut off its lists (`warningsMore`); the item detail has them all. */
export function notesHidden(i: Pick<ItemView, "warningsMore">): number {
  return Math.max(0, i.warningsMore);
}

export const shortSha = (sha: string | null | undefined): string => (sha ? sha.slice(0, 10) : "");

/** Chips of one PR in the lazy detail: record status, stale head, open unknowns, parse notes. */
export function prDetailChips(pr: Pick<ItemPrDetail, "status" | "stale" | "unknowns" | "parseNotes" | "headReviewed" | "headMovedTo">): SignoffChip[] {
  const out: SignoffChip[] = [];
  if (pr.status) out.push({ label: pr.status, tone: pr.status === "READY" ? "ok" : "warn", title: "Status the review comment states" });
  if (pr.stale) {
    const to = pr.headMovedTo ? ` (head has since moved to ${shortSha(pr.headMovedTo)})` : "";
    out.push({ label: "stale", tone: "warn", title: `The review comment was written for ${shortSha(pr.headReviewed) || "an older head"}${to}` });
  }
  if (pr.unknowns > 0) out.push({ label: `${pr.unknowns} unknown${pr.unknowns === 1 ? "" : "s"}`, tone: "warn", title: "Open 'unknown, owner to confirm' items in the review comment" });
  if (pr.parseNotes > 0) out.push({ label: `${pr.parseNotes} note${pr.parseNotes === 1 ? "" : "s"}`, tone: "muted", title: "Things the parser could not structure or found inconsistent" });
  return out;
}

// ---------------------------------------------------------------------------------------------
// incremental rendering
// ---------------------------------------------------------------------------------------------

export const CHUNK = 50;

/** How many rows to show after one more "show more" click. */
export function nextShown(shown: number, total: number, step = CHUNK): number {
  return Math.min(total, Math.max(0, shown) + step);
}

export function initialShown(total: number, step = CHUNK): number {
  return Math.min(total, step);
}

/** The checklist tab never mounts more than about this many item rows on its own (the user adds more with "Show more"). */
export const CHECKLIST_ROW_BUDGET = 600;

/** First items per section when every section is open: 50, or fewer when many sections would push the page past the row budget (14 sections -> 42). */
export function initialItemsPerSection(sectionCount: number, budget = CHECKLIST_ROW_BUDGET, step = CHUNK): number {
  return Math.max(10, Math.min(step, Math.floor(budget / Math.max(1, sectionCount))));
}

/** The remembered choice for the checklist sections: open unless the user last chose "Collapse all" (anything else, or nothing stored, is open). */
export function parseOpenPref(raw: string | null | undefined): boolean {
  return raw !== "closed";
}

export const OPEN_PREF_KEY = "flux.movement.checklist.sections"

// ---------------------------------------------------------------------------------------------
// merged checklist
// ---------------------------------------------------------------------------------------------

export interface SectionStats {
  count: number;
  blockers: number;
  warns: number;
  conflicts: number;
  attention: number;
  /** Items that should catch the eye (conflict, attention, blocker or warn). */
  flagged: number;
}

export function isFlagged(it: ChecklistItem): boolean {
  return !!(it.conflict || it.needsAttention || it.severity === "blocker" || it.severity === "warn");
}

export function sectionStats(section: Pick<ChecklistSection, "items">): SectionStats {
  const s: SectionStats = { count: section.items.length, blockers: 0, warns: 0, conflicts: 0, attention: 0, flagged: 0 };
  for (const it of section.items) {
    if (it.severity === "blocker") s.blockers++;
    else if (it.severity === "warn") s.warns++;
    if (it.conflict) s.conflicts++;
    if (it.needsAttention) s.attention++;
    if (isFlagged(it)) s.flagged++;
  }
  return s;
}

export type ItemTone = "danger" | "warn" | "plain";

/** Red = blocker or needs attention (the target environment's value is unknown), amber = warn or conflict. */
export function itemTone(it: Pick<ChecklistItem, "severity" | "needsAttention" | "conflict">): ItemTone {
  if (it.severity === "blocker" || it.needsAttention) return "danger";
  if (it.severity === "warn" || it.conflict) return "warn";
  return "plain";
}

export interface EnvCell {
  env: MovementEnvironment;
  label: string;
  value: string | null;
  isTarget: boolean;
  /** The target environment has no value: shown in red. */
  attention: boolean;
}

/** The three environment cells of a config item; the target one is flagged. */
export function envCells(it: Pick<ChecklistItem, "env">): EnvCell[] {
  if (!it.env) return [];
  const { target, values } = it.env;
  return MOVEMENT_ENVIRONMENT_VALUES.map((env) => ({
    env,
    label: envLabel(env),
    value: values[env],
    isTarget: env === target,
    attention: env === target && values[env] === null,
  }));
}

export interface SourceChip {
  label: string;
  jira: string;
  pr: string;
}

/** Distinct `CAV-7304 channelkart#1185` chips, at most `max`; `more` counts the rest (incl. the server's own cap). */
export function sourceChips(sources: readonly ItemSource[], max: number, serverMore = 0): { chips: SourceChip[]; more: number } {
  const seen = new Set<string>();
  const all: SourceChip[] = [];
  for (const s of sources) {
    const k = `${s.jira}|${s.pr}`;
    if (seen.has(k)) continue;
    seen.add(k);
    all.push({ label: `${s.jira} · ${s.pr}`, jira: s.jira, pr: s.pr });
  }
  return { chips: all.slice(0, max), more: Math.max(0, all.length - max) + serverMore };
}

/** Section items for the list: all of them, or only the flagged ones. */
export function visibleSectionItems(section: Pick<ChecklistSection, "items">, onlyFlagged: boolean): ChecklistItem[] {
  return onlyFlagged ? section.items.filter(isFlagged) : section.items;
}

/**
 * The text of ONE section, made by the same renderer as the whole-checklist Copy (so the two
 * cannot drift): render a copy of the checklist holding only that section and cut the document
 * header away.
 */
export function sectionText(cl: Checklist, id: SectionId): string {
  const section = cl.sections.find((s) => s.id === id);
  if (!section) return "";
  const slim: Checklist = { ...cl, sections: [section], conflicts: [], unknownsByOwner: [], warnings: [], signoffs: [], held: [], scope: { ...cl.scope, jiras: [] } };
  const text = renderText(slim);
  const at = text.indexOf(`## ${section.number}. ${section.title}`);
  return at >= 0 ? text.slice(at) : text;
}

/** Whole-checklist Copy. */
export function wholeText(cl: Checklist): string {
  return renderText(cl);
}

/** Conflicts of one section (for its header chip), preserving order. */
export function conflictsOf(cl: Pick<Checklist, "conflicts">, id: SectionId): Conflict[] {
  return cl.conflicts.filter((c) => c.section === id);
}

const CONFLICT_LABELS: Record<string, string> = {
  branch_mismatch: "Branch differs from the review comment",
  config_default: "Different defaults",
  config_env_value: "Different values per environment",
  downtime: "Downtime disagrees",
  order_cycle: "Deploy order loop",
  prod_branch: "Different prod branches",
  bundle_sdk: "Different bundle SDK builds",
  deploy_branch: "Different deploy branches",
};

/** A conflict kind code in plain words; a kind this UI has not heard of is humanised (`some_new_kind` -> `Some new kind`). */
export function conflictLabel(kind: string): string {
  return CONFLICT_LABELS[kind] ?? humanize(kind);
}

/** Conflicts counted per kind (in order of first appearance), for the summary line; the total count itself is the server's. */
export function conflictKindCounts(conflicts: ReadonlyArray<{ kind: string }>): Array<{ kind: string; label: string; count: number }> {
  const m = new Map<string, number>();
  for (const c of conflicts) m.set(c.kind, (m.get(c.kind) ?? 0) + 1);
  return [...m].map(([kind, count]) => ({ kind, label: conflictLabel(kind), count }));
}

/** Text of the conflicts block (Copy of the block). */
export function conflictsText(conflicts: readonly Conflict[]): string {
  const L: string[] = [];
  for (const c of conflicts) {
    L.push(`- [${conflictLabel(c.kind)}] ${c.title}`);
    for (const v of c.variants) L.push(`    * ${v.text}${v.sources.length ? ` [${formatSources(v.sources)}]` : ""}`);
  }
  return L.join("\n");
}

/** Text of the unknowns block (Copy of the block), grouped by owner as shown. */
export function unknownsText(groups: Checklist["unknownsByOwner"]): string {
  const L: string[] = [];
  for (const g of groups) {
    L.push(`### ${g.owner || "owner not named"} (${g.items.length + (g.more ?? 0)})`);
    for (const u of g.items) L.push(`- ${u.text}${u.sources.length ? ` [${formatSources(u.sources, u.moreSources)}]` : ""}`);
    if (g.more) L.push(`- ... ${g.more} more`);
  }
  return L.join("\n");
}

// ---------------------------------------------------------------------------------------------
// branches
// ---------------------------------------------------------------------------------------------

/**
 * The same patterns the server accepts (service.ts BRANCH_RE / SEARCH_RE); a client copy because that module is
 * server-only. view-model.test.ts compares them with the server's, so they cannot drift apart.
 */
export const BRANCH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,199}$/;
export const BRANCH_QUERY_RE = /^[A-Za-z0-9._\-/]{0,100}$/;

export function isValidBranchName(name: string): boolean {
  const n = name.trim();
  return BRANCH_NAME_RE.test(n) && !n.includes("..") && !n.includes("//") && !n.endsWith("/");
}

/** The server's search rule: letters, digits . _ - /, at most 100, no "..", no "//", no leading "/" (else 400). */
export function isValidBranchQuery(q: string): boolean {
  const t = q.trim();
  return BRANCH_QUERY_RE.test(t) && !t.includes("..") && !t.includes("//") && !t.startsWith("/");
}

export interface BranchHint {
  /** What the records say the prod branch is ("release/2.1 / main"), or null. */
  hint: string | null;
  /** The picked branch differs from the hint (the server's `branch_mismatch` conflict). */
  mismatch: Conflict | null;
}

/**
 * Per repo: the records' prod-branch hint and the server's mismatch conflict, read from the
 * checklist (`prod:<repo>` items and `branch_mismatch` conflicts of the prodBranch section).
 */
export function branchHints(cl: Pick<Checklist, "sections" | "conflicts"> | null, repo: string): BranchHint {
  if (!cl) return { hint: null, mismatch: null };
  const sec = cl.sections.find((s) => s.id === "prodBranch");
  const item = sec?.items.find((i) => i.key === `prod:${repo}`);
  const prefix = `${repo}: `;
  let hint: string | null = null;
  if (item) {
    hint = item.text.startsWith(prefix) ? item.text.slice(prefix.length) : item.text;
  }
  const mismatch = cl.conflicts.find((c) => c.kind === "branch_mismatch" && c.itemKey === `pick:${repo}`) ?? null;
  return { hint, mismatch };
}

/** Picks to PUT: every repo with a branch, sorted, at most 30 (the server cap). */
export function branchPayload(picks: Readonly<Record<string, string>>): Array<{ repo: string; branch: string }> {
  return Object.entries(picks)
    .filter(([, b]) => b.trim() !== "")
    .map(([repo, branch]) => ({ repo, branch: branch.trim() }))
    .sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0))
    .slice(0, 30);
}

export function branchesDirty(saved: ReadonlyArray<{ repo: string; branch: string }>, picks: Readonly<Record<string, string>>): boolean {
  const a = JSON.stringify(branchPayload(Object.fromEntries(saved.map((b) => [b.repo, b.branch]))));
  const b = JSON.stringify(branchPayload(picks));
  return a !== b;
}

// ---------------------------------------------------------------------------------------------
// sign-off diff, mark done, statuses
// ---------------------------------------------------------------------------------------------

/** "2 added, 1 removed, 3 changed" (and how many entries the diff itself left out). */
export function diffSummary(diff: NonNullable<ChangesResponse["diff"]>): string {
  const { added, removed, changed } = diff.counts;
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  if (changed) parts.push(`${changed} changed`);
  if (!parts.length) return diff.onlyMeta ? "scope or readiness changed (no checklist line differs)" : "no line differs";
  return parts.join(", ");
}

/**
 * Fetch GET changes? Only when the server says this user is a signer (`permissions.changes`; the endpoint
 * is 403 for everybody else and 409 inputs_stale while the data is unreadable) and a reset has happened.
 */
export function shouldFetchChanges(v: ChangesView): boolean {
  return v.permissions.changes && !v.needsRefresh && !!v.movement.hash && v.events.some((e) => e.type === "checklist_changed") && !viewerSignedCurrent(v);
}

type ChangesView = Pick<MovementView, "permissions" | "needsRefresh" | "events" | "signers" | "me"> & { movement: Pick<MovementView["movement"], "hash"> };

/** The viewer holds at least one slot and every slot they hold is signed on the CURRENT checklist: there is nothing left to be told about. */
export function viewerSignedCurrent(v: Pick<MovementView, "signers" | "me">): boolean {
  const mine = v.signers.filter((s) => v.me.slots.includes(s.slot));
  return mine.length > 0 && mine.every((s) => s.signedCurrent);
}

/**
 * What the cached /changes answer belongs to: the checklist hash AND the time of the latest reset. A reset that brings the hash back
 * to an earlier value (an edit undone) is still a new reset, so it must fetch again, and the cache is never reused across it.
 */
export function changesKey(v: Pick<MovementView, "events"> & { movement: Pick<MovementView["movement"], "hash"> }): string {
  const reset = v.events.find((e) => e.type === "checklist_changed")?.at ?? "";
  return `${v.movement.hash ?? ""}|${reset}`;
}

/** Show the banner: the server says the viewer is a signer, they have not signed the current checklist, the cache is for THIS hash and reset, and it holds a difference. */
export function changesBannerVisible(v: ChangesView, cached: { key: string; data: Pick<ChangesResponse, "unchanged" | "diff" | "snapshotMissing" | "signedHash"> } | null): boolean {
  if (!cached || cached.key !== changesKey(v) || viewerSignedCurrent(v)) return false;
  return showChangesBanner(v.permissions.changes, cached.data);
}

/** Show the "changed since you signed" banner? Only for someone who may sign and has something to compare. */
export function showChangesBanner(canSignSomething: boolean, changes: Pick<ChangesResponse, "unchanged" | "diff" | "snapshotMissing" | "signedHash"> | null): boolean {
  if (!canSignSomething || !changes) return false;
  if (changes.unchanged) return false;
  return !!changes.diff || changes.snapshotMissing;
}

export type DoneResult = "moved" | "held";

export interface DoneRow {
  issueId: string;
  key: string;
  summary: string;
  result: DoneResult;
  comment: string;
}

/** The included Jiras, prefilled as moved (what the server does too when no results are sent). */
export function doneRows(items: ReadonlyArray<Pick<ItemView, "issueId" | "key" | "summary" | "included" | "readiness">>): DoneRow[] {
  return items.filter((i) => i.included && i.readiness !== "blocked").map((i) => ({ issueId: i.issueId, key: i.key, summary: i.summary, result: "moved", comment: "" }));
}

/** The delivery status Flux proposes for a result. */
export function proposedStatusFor(result: DoneResult): "delivered" | "not_delivered" {
  return result === "moved" ? "delivered" : "not_delivered";
}

export const MAX_DONE_COMMENT = 300;
/** The server refuses a body over 64 KB (413); the client keeps its own to 48 KB so a 200-row done always fits, whatever the characters. */
export const DONE_BODY_BUDGET_BYTES = 48 * 1024;

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** Cuts `text` (by code points, never in the middle of one) until its JSON-encoded form is at most `maxBytes`. */
function cutToBytes(text: string, maxBytes: number): string {
  const cps = Array.from(text);
  let lo = 0;
  let hi = cps.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (utf8Bytes(JSON.stringify(cps.slice(0, mid).join(""))) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return cps.slice(0, lo).join("").trim();
}

export interface DonePayload {
  comment?: string;
  results: Array<{ issueId: string; result: DoneResult; comment: string | null }>;
}

/**
 * Body of POST /done plus whether any comment had to be shortened to keep the whole body under
 * DONE_BODY_BUDGET_BYTES (the per-row cap of MAX_DONE_COMMENT characters still applies first). The room left after
 * the fixed parts is shared equally by the rows that have a comment.
 */
export function fitDonePayload(rows: readonly DoneRow[], comment: string): { payload: DonePayload; trimmed: boolean } {
  const c = comment.trim().slice(0, 500);
  const results = rows.map((r) => ({ issueId: r.issueId, result: r.result, comment: r.comment.trim().slice(0, MAX_DONE_COMMENT) || null }));
  const payload: DonePayload = { ...(c ? { comment: c } : {}), results };
  if (utf8Bytes(JSON.stringify(payload)) <= DONE_BODY_BUDGET_BYTES) return { payload, trimmed: false };
  const withComments = results.filter((r) => r.comment !== null);
  const fixed = utf8Bytes(JSON.stringify({ ...payload, results: results.map((r) => ({ ...r, comment: null })) }));
  const room = Math.max(0, DONE_BODY_BUDGET_BYTES - fixed - 64);
  const per = withComments.length ? Math.floor(room / withComments.length) - 8 : 0;
  let trimmed = false;
  for (const r of withComments) {
    const cut = per > 2 ? cutToBytes(r.comment!, per) : "";
    if (cut !== r.comment) trimmed = true;
    r.comment = cut || null;
  }
  return { payload, trimmed };
}

/** Body of POST /done: every row's result (and its comment, cut to the caps). */
export function buildDonePayload(rows: readonly DoneRow[], comment: string): DonePayload {
  return fitDonePayload(rows, comment).payload;
}

/** Jiras of the movement that are NOT in the done list (unticked, or blocked and not overridden): the server records them as held. */
export function notSelectedCount(items: ReadonlyArray<Pick<ItemView, "included" | "readiness">>): number {
  return items.filter((i) => !(i.included && i.readiness !== "blocked")).length;
}

/**
 * What a "done" will record, and what the confirm step will propose: every row marked moved is moved; every row marked held AND every
 * Jira that was not selected is held (`notSelected`, from notSelectedCount). Moved become Delivered, held become Not delivered, so
 * the counter, the dialog text and the proposal all come from these numbers. `held` includes `notSelected`.
 */
export function doneCounts(rows: readonly DoneRow[], notSelected = 0): { moved: number; held: number; notSelected: number } {
  let moved = 0;
  for (const r of rows) if (r.result === "moved") moved++;
  return { moved, held: rows.length - moved + notSelected, notSelected };
}

/** The sentence under the counter and in the description, with the same numbers ("1 not selected, recorded as held"). */
export function notSelectedNote(notSelected: number): string {
  return notSelected > 0 ? `${notSelected} Jira${notSelected === 1 ? " was" : "s were"} not selected and will be recorded as held.` : "";
}

export type SignerSearchPhase = "short" | "loading" | "error" | "empty" | "results";

/**
 * What the signer search shows. `settled` is the last ANSWERED search (its text, its results or its error). "No matching Flux user"
 * is only true when the search for THIS text was answered with nothing: while it is still running (a slow first request) it says
 * "Searching", and a failed one says so instead of claiming there is nobody.
 */
export function signerSearchPhase(text: string, valid: boolean, settled: { text: string; count: number; error: string | null } | null): SignerSearchPhase {
  if (!valid) return "short";
  if (!settled || settled.text !== text.trim()) return "loading";
  if (settled.error) return "error";
  return settled.count > 0 ? "results" : "empty";
}

/**
 * Is "Copy" (the whole checklist) available? Always, unless the movement itself could not be loaded or a copy is already running: the
 * checklist is fetched on click when it is not loaded yet, so a missing checklist is never a reason to switch the button off.
 */
export function copyAllEnabled(movementLoaded: boolean, inFlight: boolean): boolean {
  return movementLoaded && !inFlight;
}

/** No Jira is effectively selected (nothing ticked, or only blocked ones): signing cannot start. An empty movement is not "nothing selected". */
export function nothingSelected(items: ReadonlyArray<Pick<ItemView, "included">>): boolean {
  return items.length > 0 && !items.some((i) => i.included);
}

export const NOTHING_SELECTED_HINT = "No Jira is selected yet. Tick the ready Jiras that should move; signing starts once at least one is selected.";

/**
 * The reason to print as text (not only in a tooltip) next to a disabled Start / Mark done / Confirm: only for the people the button is for
 * (the deployer or an admin; for anyone else the tooltip says "only the deployer"), and only while the movement is not frozen.
 */
export function pendingActionReason(
  v: { status: string; environment: string; me: { isAdmin: boolean; slots: readonly string[] } },
  a: { start: ActionState; done: ActionState; confirm: ActionState }
): { action: "start" | "done" | "confirm"; reason: string } | null {
  if (!(v.me.isAdmin || v.me.slots.includes("deployer"))) return null;
  if (v.status === "cancelled") return null;
  if (v.status === "in_progress") return !a.done.allowed && a.done.reason ? { action: "done", reason: a.done.reason } : null;
  if (v.status === "done") return v.environment === "prod" && !a.confirm.allowed && a.confirm.reason ? { action: "confirm", reason: a.confirm.reason } : null;
  return !a.start.allowed && a.start.reason ? { action: "start", reason: a.start.reason } : null;
}

/** Why Sign is off for someone who holds the slot while no Jira is selected (the server refuses a sign-off on an empty selection). */
export const NOTHING_SELECTED_REASON = "Tick at least one ready Jira before signing";

/** The line under a repo whose saved branch pick is used only by held (unticked or blocked) Jiras. */
export const HELD_ONLY_NOTE = "Not part of the checklist until one of those Jiras is ticked.";

/** The server flags such a pick `heldOnly` (listAffectedRepos); anything else, or no entry, is a normal row. */
export function isHeldOnly(aff: { heldOnly?: boolean } | null | undefined): boolean {
  return aff?.heldOnly === true;
}

/** Prod movements propose and confirm delivery statuses; demo / uat finish at "done" (the server answers 409 not_prod). */
export function hasStatusStep(environment: string): boolean {
  return environment === "prod";
}

/** What the Done dialog says before a demo / uat movement is marked done (the server's own note is shown after it: GET confirm-statuses `note`). */
export function nonProdDoneHint(environment: string): string {
  return `This is a ${envLabel(environment)} movement: marking it done finishes it. Delivery statuses are not proposed or changed for it.`;
}

/** The server's reason a proposal is left alone ("already delivered"), or null when it can be written. */
export function proposalSkip(p: { skipReason?: string | null }): string | null {
  return p.skipReason ? p.skipReason : null;
}

/** The confirm step's heading line: a proposal before the write ("2 delivered, 0 not delivered; 2 will change"), what happened after it ("2 updated, 0 unchanged, 0 skipped"). */
export function confirmHeading(proposals: { counts: { delivered: number; notDelivered: number; willChange: number }; missing: number }, outcome: { updated: number; unchanged: number; skipped: number } | null): string {
  if (outcome) return confirmSummary(outcome);
  const missing = proposals.missing > 0 ? `; ${proposals.missing} no longer in the delivery` : "";
  return `${proposals.counts.delivered} delivered, ${proposals.counts.notDelivered} not delivered; ${proposals.counts.willChange} will change${missing}`;
}

/** The "Now" column of a proposal row: its status before the write, the proposed one once that row was updated (or was already there), the old one if it was skipped. */
export function nowStatusAfter<S extends string>(current: S, to: S, outcome: "updated" | "unchanged" | "skipped" | undefined): S {
  return outcome === "updated" || outcome === "unchanged" ? to : current;
}

/** "3 updated, 1 unchanged, 2 skipped" */
export function confirmSummary(c: { updated: number; unchanged: number; skipped: number }): string {
  return `${c.updated} updated, ${c.unchanged} unchanged, ${c.skipped} skipped`;
}

// ---------------------------------------------------------------------------------------------
// API errors
// ---------------------------------------------------------------------------------------------

export interface ApiErrorBody {
  error?: unknown;
  code?: unknown;
  currentHash?: unknown;
  keys?: unknown;
  /** 400 "The <slot> (<email>) is not a Flux user" names the slot. */
  slot?: unknown;
  refreshError?: unknown;
}

/** What every screen says when the login is gone (requireAuth redirects to the sign-in page, which fetch follows to HTML). */
export const SESSION_EXPIRED = "Your session expired; reload the page and sign in";

/** Which buttons the panel offers when the movement itself could not be loaded: a 404 (gone) or 401 (session) is not helped by Retry, only Close. */
export function loadErrorActions(status: number | null): { retry: boolean } {
  return { retry: !(status === 404 || status === 401) };
}

/** Body of POST /cancel: the reason is optional, an empty one is allowed (and simply not sent). */
export function cancelBody(reason: string): { reason?: string } {
  const r = reason.trim().slice(0, 500);
  return r ? { reason: r } : {};
}

/**
 * The test ids of the controls that can open a nested dialog, most specific first: when the dialog closes, focus goes to the first
 * one that still exists (an Override button turns into Revoke, Mark done into Confirm statuses), else the row's expander.
 */
export function openerTestIds(kind: "override" | "revoke" | "cancel" | "signers" | "done" | "create", key = ""): string[] {
  switch (kind) {
    case "override":
    case "revoke":
      return [`movement-override-${key}`, `movement-revoke-${key}`, `movement-jira-toggle-${key}`];
    case "cancel":
      return ["movement-cancel", "movement-start", "movement-signoff-expand"];
    case "signers":
      return ["movement-change-signers", "movement-signoff-expand"];
    case "done":
      return ["movement-mark-done", "movement-confirm-statuses", "movement-signoff-expand"];
    case "create":
      return [`movement-start-${key}`, `movement-chip-${key}`];
  }
}

/** One readable line for a failed call (server messages are already user-safe). */
export function describeApiError(status: number, body: ApiErrorBody | null | undefined, fallback: string): string {
  const msg = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : "";
  if (msg) return msg;
  if (status === 401) return SESSION_EXPIRED;
  if (status === 403) return "You are not allowed to do this";
  if (status === 404) return "Not found; it may have been removed";
  if (status === 408 || status === 504) return "The server took too long to answer";
  if (status >= 500) return "The server had a problem; try again";
  return fallback;
}

/** A 409 that carries the current checklist hash: the one the user reviewed is stale. */
export function isStaleHash(status: number, body: ApiErrorBody | null | undefined): boolean {
  return status === 409 && typeof body?.currentHash === "string";
}

/** 409 `inputs_stale` (stored Jira data unreadable) or `refresh_failed` (the last refresh did not persist): only a Refresh fixes it. */
export function refreshNeededCode(status: number, body: ApiErrorBody | null | undefined): "inputs_stale" | "refresh_failed" | null {
  if (status !== 409) return null;
  return body?.code === "inputs_stale" || body?.code === "refresh_failed" ? body.code : null;
}

/** The sentence shown with the Refresh offer for that code. */
export function refreshNeededMessage(code: "inputs_stale" | "refresh_failed", body: ApiErrorBody | null | undefined): string {
  if (code === "inputs_stale") return "The stored Jira data must be re-read before this can be done. Use Refresh, then try again.";
  const why = typeof body?.refreshError === "string" && body.refreshError ? ` (${body.refreshError})` : "";
  return `The last refresh failed${why}, so nothing can be approved or started on the old data. Use Refresh, then try again.`;
}

/** The signer slot a 400 names ("The ba (x@y.com) is not a Flux user"), so the message can sit on that field. */
export function slotFromError(body: ApiErrorBody | null | undefined): MovementSlot | null {
  const s = body?.slot;
  return typeof s === "string" && (MOVEMENT_SLOT_VALUES as readonly string[]).includes(s) ? (s as MovementSlot) : null;
}

/** The create call's failures, in words the user can act on. */
export function describeCreateError(status: number, body: ApiErrorBody | null | undefined, fallback: string): string {
  const base = describeApiError(status, body, fallback);
  if (status === 409 && body?.code === "delivery_closed") return `${base}. Reopen the delivery first if it should still be moved.`;
  return base;
}

// ---------------------------------------------------------------------------------------------
// URLs: the movement page, the way back, the old deep link, the completion hand-over
// ---------------------------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = encodeURIComponent;

/** A movement is its own page: `/projects/<project>/deliveries/<delivery>/movements/<movement>` (the notification e-mail links here too). */
export function movementPagePath(projectId: string, deliveryId: string, movementId: string): string {
  return `/projects/${enc(projectId)}/deliveries/${enc(deliveryId)}/movements/${enc(movementId)}`;
}

/** The delivery tab with that delivery scrolled to and highlighted: the standing "Back to delivery" link. */
export function deliveryBackPath(projectId: string, deliveryId: string): string {
  return `/projects/${enc(projectId)}?tab=delivery-tracker&delivery=${enc(deliveryId)}`;
}

export interface CompletionParams {
  environment: MovementEnvironment;
  /** Statuses the confirm step updated (prod); null for demo / uat, which have no status step. */
  updated: number | null;
  /** Rows the confirm step skipped (a gate, "already delivered"): more than 0 means the finish needs a look, so it is not reported as a success. */
  skipped: number;
}

/**
 * The way back after a finished movement: the delivery tab, which reloads its list and says what happened. A clean finish carries `updated=1`;
 * one with skipped rows carries `done=1&skipped=N` instead, so the tab never claims a success the user did not get.
 */
export function completedBackPath(projectId: string, deliveryId: string, c: CompletionParams): string {
  const n = c.updated !== null ? `&n=${Math.max(0, Math.trunc(c.updated))}` : "";
  const flag = c.skipped > 0 ? `done=1&skipped=${Math.max(0, Math.trunc(c.skipped))}` : "updated=1";
  return `${deliveryBackPath(projectId, deliveryId)}&${flag}&env=${enc(c.environment)}${n}`;
}

export type CompletionArrival = CompletionParams & { kind: "completed" | "attention" };

/** Reads the hand-over of {@link completedBackPath}; null unless `updated=1` (a clean finish) or `done=1&skipped=N` (needs a look) with a known environment. */
export function parseCompletionParams(params: { get(name: string): string | null }): CompletionArrival | null {
  const env = params.get("env");
  if (!(MOVEMENT_ENVIRONMENT_VALUES as readonly string[]).includes(env ?? "")) return null;
  const num = (v: string | null) => (v !== null && /^\d{1,4}$/.test(v) ? Number(v) : null);
  const n = num(params.get("n"));
  const environment = env as MovementEnvironment;
  if (params.get("updated") === "1") return { kind: "completed", environment, updated: n, skipped: 0 };
  const skipped = num(params.get("skipped"));
  if (params.get("done") === "1" && skipped !== null && skipped > 0) return { kind: "attention", environment, updated: n, skipped };
  return null;
}

/** "Movement to PROD completed: 3 statuses updated"; a finish with skipped rows is neutral ("finished with 2 skipped; check the statuses"), never "completed". */
export function completionToastText(c: CompletionParams): string {
  const env = envLabel(c.environment).toUpperCase();
  if (c.skipped > 0) return `Movement to ${env} finished with ${c.skipped} skipped; check the statuses`;
  const head = `Movement to ${env} completed`;
  if (c.updated === null) return head;
  return `${head}: ${c.updated} status${c.updated === 1 ? "" : "es"} updated`;
}

export interface DeliveryLink {
  deliveryId: string;
}

/** `delivery=<uuid>` of the URL (a UUID only): the card to scroll to and highlight. It never opens anything. */
export function parseDeliveryLink(params: { get(name: string): string | null }): DeliveryLink | null {
  const d = params.get("delivery")?.trim() ?? "";
  return UUID_RE.test(d) ? { deliveryId: d.toLowerCase() } : null;
}

/**
 * An older e-mail or bookmark: `?tab=delivery-tracker&delivery=<id>&movement=<id>` opened the panel on the tab. A movement now has its own
 * page, so such a link is redirected there; `delivery` alone (no movement) is not a redirect. null = leave the URL alone.
 */
export function legacyMovementRedirect(params: { get(name: string): string | null }, projectId: string): string | null {
  const d = params.get("delivery")?.trim() ?? "";
  const m = params.get("movement")?.trim() ?? "";
  if (!UUID_RE.test(d) || !UUID_RE.test(m)) return null;
  return movementPagePath(projectId, d.toLowerCase(), m.toLowerCase());
}

/** The query string without the hand-over keys (`updated`, `done`, `skipped`, `env`, `n`); `tab` and `delivery` stay, in order. */
export function withoutCompletionParams(search: string): string {
  const p = new URLSearchParams(search);
  for (const k of ["updated", "done", "skipped", "env", "n"]) p.delete(k);
  return p.toString();
}

/**
 * Is this URL a NEW arrival at a delivery card? `prev` is the key of the arrival already acted on (null = none, or the URL had no
 * delivery link since). The key is the whole query string, so a completion arrival differs from a plain one. `clear`: the URL carries
 * hand-over keys that must be dropped (always, handled or not); `next` is what to remember afterwards: the CLEANED string, so the
 * replace that drops the keys is not mistaken for another arrival. No delivery link resets everything (the next visit is new).
 */
export function arrivalStep(prev: string | null, linkedId: string | null, search: string): { fresh: boolean; clear: boolean; next: string | null } {
  if (!linkedId) return { fresh: false, clear: false, next: null };
  const cleaned = withoutCompletionParams(search);
  return { fresh: search !== prev, clear: cleaned !== search, next: cleaned };
}

/** The list on screen is older than it should be when someone comes back: after a completed movement (older than 2 s) or in any case after 10 s. */
export function listIsStale(loadedAt: number | null, now: number, afterCompletion: boolean): boolean {
  if (loadedAt === null) return true;
  const age = now - loadedAt;
  return age > 10_000 || (afterCompletion && age > 2_000);
}

/** How long the create dialog may keep saying "Opening the movement…" when the page does not arrive. */
export const OPENING_TIMEOUT_MS = 15_000;

export type CreateReleaseReason = "route" | "visible" | "timeout";

/**
 * Must the create dialog let go of its "opening" state? It is only waiting for a navigation, so it ends by itself: the route moved away
 * from the project page (the page is arriving), the delivery tab was shown again after being hidden (the user came back), or the page did
 * not arrive within OPENING_TIMEOUT_MS. null = keep waiting (or nothing is opening).
 */
export function createReleaseReason(s: { openingSince: number | null; now: number; pathname: string | null; projectPath: string; becameVisible: boolean }): CreateReleaseReason | null {
  if (s.openingSince === null) return null;
  if (s.becameVisible) return "visible";
  if (s.pathname !== null && s.pathname !== s.projectPath) return "route";
  if (s.now - s.openingSince >= OPENING_TIMEOUT_MS) return "timeout";
  return null;
}

/**
 * What the create dialog allows. While the POST runs it cannot be dismissed (a half-sent create must not be abandoned); once the movement
 * exists and the navigation has started ("opening") it can always be closed: Cancel becomes Close, Esc and the overlay work, the X shows.
 */
export function createDialogUi(busy: boolean, opening: boolean): { canDismiss: boolean; cancelDisabled: boolean; cancelLabel: string } {
  const locked = busy && !opening;
  return { canDismiss: !locked, cancelDisabled: locked, cancelLabel: opening ? "Close" : "Cancel" };
}

/** The app-wide delivery reminder banner (fixed to the bottom) would cover the movement page's sticky sign-off bar, so it is not shown there. */
export function showDeliveryBannerOn(pathname: string | null | undefined): boolean {
  return !(pathname ?? "").includes("/movements/");
}

export const AUTO_RETURN_MS = 2000;

export interface SkippedRow {
  key: string;
  reason: string;
}

export interface CompletionPlan {
  /** "completed": all done; "attention": done, but a row was skipped or something failed, so the user must read it. */
  state: "completed" | "attention";
  /** Go back to the delivery by itself after AUTO_RETURN_MS (cancelable). Never when something needs reading. */
  autoReturn: boolean;
  message: string;
  /** The hand-over for the way back; null when nothing should be claimed (a failed confirm). */
  completion: CompletionParams | null;
  /** The rows the confirm step left alone, with the reason, for the banner (it stays visible after the confirm dialog closes). */
  skippedRows: SkippedRow[];
}

/**
 * What happens when a movement is finished. demo / uat: done is the end (`confirm` null). prod: the end is the confirm step; its counts say
 * whether rows were skipped (a gate, or "already delivered"). Skipped rows or an error mean: stay, show them, no automatic return, and the way
 * back does not report a success.
 */
export function completionPlan(environment: MovementEnvironment, confirm: { updated: number; skipped: number; skippedRows?: SkippedRow[] } | null, failed = false): CompletionPlan {
  const skipped = confirm?.skipped ?? 0;
  const updated = environment === "prod" && confirm ? confirm.updated : null;
  const base = { skippedRows: confirm?.skippedRows ?? [] };
  if (failed) {
    return { ...base, state: "attention", autoReturn: false, message: "The movement is done, but the delivery statuses could not be confirmed. Try again, or go back to the delivery.", completion: null };
  }
  if (skipped > 0) {
    return {
      ...base,
      state: "attention",
      autoReturn: false,
      message: `${updated ?? 0} status${updated === 1 ? "" : "es"} updated, ${skipped} skipped. The skipped ones were left as they are; the reasons are listed below.`,
      completion: { environment, updated, skipped },
    };
  }
  const detail = updated !== null ? `${updated} status${updated === 1 ? "" : "es"} updated` : "";
  return { ...base, state: "completed", autoReturn: true, message: `Movement to ${envLabel(environment)} completed${detail ? `: ${detail}` : ""}`, completion: { environment, updated, skipped: 0 } };
}

/** At most `max` skipped rows for the banner, and how many were left out. */
export function skippedPreview(rows: readonly SkippedRow[], max = 10): { shown: SkippedRow[]; more: number } {
  return { shown: rows.slice(0, max), more: Math.max(0, rows.length - max) };
}

// ---------------------------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------------------------

/** Appends a page of events, dropping any id already shown (a new event can shift pages). */
export function mergeEvents(shown: readonly MovementEventRow[], page: readonly MovementEventRow[]): MovementEventRow[] {
  const seen = new Set(shown.map((e) => e.id));
  return [...shown, ...page.filter((e) => !seen.has(e.id))];
}

/**
 * A reload of the FIRST page while later pages are loaded: the fresh first page goes on top, everything already loaded that is not in it stays below.
 * The cursor stays the one of the deepest page loaded (a first page alone gives its own).
 */
export function mergeFirstPage(shown: readonly MovementEventRow[], shownNext: string | null, page: readonly MovementEventRow[], pageNext: string | null): { events: MovementEventRow[]; next: string | null } {
  const fresh = new Set(page.map((e) => e.id));
  const rest = shown.filter((e) => !fresh.has(e.id));
  const loadedMore = shown.length > page.length && rest.length > 0;
  return { events: [...page, ...rest], next: loadedMore ? shownNext : pageNext };
}

/** One short line of what an event's small `detail` says (reason, key, slot, counts); null when there is nothing worth showing. */
export function eventDetail(type: string, detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
  const keys = Array.isArray(d.keys) ? d.keys.filter((k): k is string => typeof k === "string").slice(0, 5) : [];
  const more = Array.isArray(d.keys) && d.keys.length > 5 ? ` +${d.keys.length - 5}` : "";
  const parts: string[] = [];
  if (keys.length) parts.push(keys.join(", ") + more);
  if (str(d.key)) parts.push(str(d.key)!);
  if (str(d.slot)) parts.push(str(d.slot)!);
  if (typeof d.moved === "number" || typeof d.held === "number") parts.push(`${d.moved ?? 0} moved, ${d.held ?? 0} held`);
  if (str(d.reason)) parts.push(`reason: ${str(d.reason)}`);
  if (str(d.comment)) parts.push(`comment: ${str(d.comment)}`);
  if (str(d.message) && (type === "refresh_failed" || parts.length === 0)) parts.push(str(d.message)!);
  return parts.length ? parts.join(" · ") : null;
}

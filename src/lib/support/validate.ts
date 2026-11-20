// Pure body validation for the support ticket routes.

import { isValidDateString } from "@/lib/validation";
import { PRIORITIES, SUPPORT_CATEGORIES, type OwnerSide, type PeriodMode, type SlaTargets, type SupportCategory } from "./types";
import type { SettingsInput } from "./store";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type TicketPatch = Partial<{
  category: SupportCategory | null;
  firstRespondedAt: Date | null;
  usersReported: number | null;
  usersImpacted: number | null;
  eta: string | null;
  raisedAt: Date | null;
  rcaShared: boolean;
}>;

const ALLOWED = [
  "category",
  "firstRespondedAt",
  "usersReported",
  "usersImpacted",
  "eta",
  "raisedAt",
  "rcaShared",
];
const FUTURE_SLACK_MS = 60_000;

function parseIso(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseTicketPatch(body: unknown, now: Date = new Date()): Result<TicketPatch> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !ALLOWED.includes(k));
  if (unknown.length) return { ok: false, error: `Unknown field: ${unknown[0]}` };

  const out: TicketPatch = {};
  if ("category" in b) {
    const v = b.category;
    if (v !== null && !(typeof v === "string" && (SUPPORT_CATEGORIES as readonly string[]).includes(v))) {
      return { ok: false, error: "Invalid category" };
    }
    out.category = v as SupportCategory | null;
  }
  for (const key of ["usersReported", "usersImpacted"] as const) {
    if (key in b) {
      const v = b[key];
      if (v !== null && !(typeof v === "number" && Number.isInteger(v) && v >= 0)) {
        return { ok: false, error: `${key} must be a non-negative integer or null` };
      }
      out[key] = v as number | null;
    }
  }
  if ("firstRespondedAt" in b) {
    const v = b.firstRespondedAt;
    if (v === null) out.firstRespondedAt = null;
    else {
      const d = parseIso(v);
      if (!d) return { ok: false, error: "firstRespondedAt must be an ISO timestamp or null" };
      if (d.getTime() > now.getTime() + FUTURE_SLACK_MS) {
        return { ok: false, error: "firstRespondedAt cannot be in the future" };
      }
      out.firstRespondedAt = d;
    }
  }
  if ("eta" in b) {
    const v = b.eta;
    if (v !== null && !isValidDateString(v)) {
      return { ok: false, error: "eta must be YYYY-MM-DD or null" };
    }
    out.eta = v as string | null;
  }
  // Raised time may predate the Jira creation time (that's the point) but not
  // the future. null clears it (falls back to Jira creation).
  if ("raisedAt" in b) {
    const v = b.raisedAt;
    if (v === null) out.raisedAt = null;
    else {
      const d = parseIso(v);
      if (!d) return { ok: false, error: "raisedAt must be an ISO timestamp or null" };
      if (d.getTime() > now.getTime() + FUTURE_SLACK_MS) {
        return { ok: false, error: "raisedAt cannot be in the future" };
      }
      out.raisedAt = d;
    }
  }
  if ("rcaShared" in b) {
    if (typeof b.rcaShared !== "boolean") return { ok: false, error: "rcaShared must be a boolean" };
    out.rcaShared = b.rcaShared;
  }
  return { ok: true, value: out };
}

/**
 * Cross-field check for a ticket patch against the stored ticket: the first
 * response may not precede the effective raised time (Flux raised time, else
 * Jira creation). A response before the ticket was raised would count as 0
 * minutes and flatter the client-facing Avg Response Time. Returns the error
 * message, or null when the patch is consistent.
 */
export function ticketTimesError(
  stored: { jiraCreatedAt: Date | null; raisedAt: Date | null; firstRespondedAt: Date | null },
  patch: TicketPatch,
): string | null {
  const touchesRaised = "raisedAt" in patch;
  const touchesResponse = "firstRespondedAt" in patch;
  if (!touchesRaised && !touchesResponse) return null;
  const raisedAt = touchesRaised ? (patch.raisedAt ?? null) : stored.raisedAt;
  const effectiveRaised = raisedAt ?? stored.jiraCreatedAt;
  const response = touchesResponse ? (patch.firstRespondedAt ?? null) : stored.firstRespondedAt;
  if (!response || !isBeforeTicketCreated(response, effectiveRaised)) return null;
  return touchesRaised
    ? "Raised time can't be after the first response"
    : "First response is before the ticket was raised";
}

export function parseOwnershipBody(
  body: unknown,
  now: Date = new Date(),
): Result<{ side: OwnerSide; at: Date }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => k !== "side" && k !== "at");
  if (unknown.length) return { ok: false, error: `Unknown field: ${unknown[0]}` };
  if (b.side !== "salescode" && b.side !== "client") {
    return { ok: false, error: "side must be 'salescode' or 'client'" };
  }
  let at = now;
  if (b.at !== undefined && b.at !== null) {
    const d = parseIso(b.at);
    if (!d) return { ok: false, error: "at must be an ISO timestamp" };
    at = d;
  }
  return { ok: true, value: { side: b.side, at } };
}

// ---- Settings ----

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function parseEmails(v: unknown, label: string): Result<string[]> {
  if (!Array.isArray(v)) return { ok: false, error: `${label} must be an array` };
  const out: string[] = [];
  for (const e of v) {
    if (typeof e !== "string") return { ok: false, error: `${label} must contain strings` };
    const email = e.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { ok: false, error: `Invalid email in ${label}: ${e}` };
    if (!out.includes(email)) out.push(email);
  }
  return { ok: true, value: out };
}

export function parseSettingsBody(body: unknown): Result<SettingsInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.enabled !== "boolean") return { ok: false, error: "enabled must be a boolean" };
  const supportLabel = typeof b.supportLabel === "string" ? b.supportLabel.trim() : "";
  if (!supportLabel) return { ok: false, error: "supportLabel is required" };
  const sharedBy = typeof b.sharedBy === "string" ? b.sharedBy.trim() : "";
  if (!sharedBy) return { ok: false, error: "sharedBy is required" };

  const to = parseEmails(b.toEmails, "toEmails");
  if (!to.ok) return to;
  const cc = parseEmails(b.ccEmails, "ccEmails");
  if (!cc.ok) return cc;
  if (b.enabled && to.value.length === 0) {
    return { ok: false, error: "At least one To recipient is required to enable the report" };
  }

  if (!(["mtd", "ytd", "custom"] as unknown[]).includes(b.periodMode)) {
    return { ok: false, error: "periodMode must be mtd, ytd or custom" };
  }
  const periodMode = b.periodMode as PeriodMode;
  let periodStart: string | null = null;
  if (periodMode === "custom") {
    if (!isValidDateString(b.periodStart)) {
      return { ok: false, error: "periodStart (YYYY-MM-DD) is required for a custom period" };
    }
    periodStart = b.periodStart;
  }

  const slaIn = b.sla;
  if (!slaIn || typeof slaIn !== "object" || Array.isArray(slaIn)) {
    return { ok: false, error: "sla is required" };
  }
  const sla = {} as SlaTargets;
  for (const p of PRIORITIES) {
    const v = (slaIn as Record<string, unknown>)[p];
    if (!v || typeof v !== "object") return { ok: false, error: `sla.${p} is required` };
    const { responseMin, resolutionMin } = v as Record<string, unknown>;
    for (const [k, n] of [["responseMin", responseMin], ["resolutionMin", resolutionMin]] as const) {
      if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
        return { ok: false, error: `sla.${p}.${k} must be a positive integer` };
      }
    }
    sla[p] = { responseMin: responseMin as number, resolutionMin: resolutionMin as number };
  }

  const oh = b.officeHours;
  if (!oh || typeof oh !== "object" || Array.isArray(oh)) {
    return { ok: false, error: "officeHours is required" };
  }
  const { start, end, days } = oh as Record<string, unknown>;
  if (typeof start !== "string" || !HHMM_RE.test(start)) {
    return { ok: false, error: "officeHours.start must be HH:MM" };
  }
  if (typeof end !== "string" || !(HHMM_RE.test(end) || end === "24:00")) {
    return { ok: false, error: "officeHours.end must be HH:MM or 24:00" };
  }
  if (toMinutes(start) >= toMinutes(end)) {
    return { ok: false, error: "officeHours.start must be before end" };
  }
  if (
    !Array.isArray(days) ||
    days.length === 0 ||
    !days.every((d) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6) ||
    new Set(days).size !== days.length
  ) {
    return { ok: false, error: "officeHours.days must be a non-empty list of distinct integers 0-6" };
  }

  const ids = b.approverUserIds;
  if (!Array.isArray(ids) || !ids.every((s) => typeof s === "string" && s.trim() !== "")) {
    return { ok: false, error: "approverUserIds must be an array of non-empty strings" };
  }
  const approverUserIds = [...new Set((ids as string[]).map((s) => s.trim().toLowerCase()))];

  return {
    ok: true,
    value: {
      enabled: b.enabled,
      supportLabel,
      periodMode,
      periodStart,
      toEmails: to.value,
      ccEmails: cc.value,
      approverUserIds,
      sharedBy,
      sla,
      officeHours: { start, end, days: days as number[] },
    },
  };
}

/**
 * True when `at` is earlier than the ticket's effective raised time (Flux
 * raised time, else Jira creation). A ticket with no such time is never
 * "before" it.
 */
export function isBeforeTicketCreated(at: Date, raisedAt: Date | null): boolean {
  return raisedAt !== null && at.getTime() < raisedAt.getTime();
}

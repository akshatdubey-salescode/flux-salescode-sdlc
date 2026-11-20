// Pure body validation for the support ticket routes.

import { isValidDateString } from "@/lib/validation";
import { SUPPORT_CATEGORIES, type OwnerSide, type SupportCategory } from "./types";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type TicketPatch = Partial<{
  category: SupportCategory | null;
  firstRespondedAt: Date | null;
  usersReported: number | null;
  usersImpacted: number | null;
  eta: string | null;
}>;

const ALLOWED = ["category", "firstRespondedAt", "usersReported", "usersImpacted", "eta"];
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
  return { ok: true, value: out };
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

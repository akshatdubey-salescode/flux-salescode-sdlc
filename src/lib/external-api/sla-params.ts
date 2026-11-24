// Query-param parsing for GET /api/v1/sla-violations. Pure (no DB), so it is
// unit-tested. Bad input is a 400 with a reason, as on the bug routes.

export const SLA_DEFAULT_LIMIT = 200;
export const SLA_MAX_LIMIT = 1000;

export type SlaStatus = "open" | "resolved" | "all";

export type SlaQuery = {
  status: SlaStatus;
  limit: number;
  offset: number;
};

function parseIntParam(v: string): number | null {
  return /^\d+$/.test(v) ? Number(v) : null;
}

export function parseSlaQuery(
  params: URLSearchParams
): { ok: true; query: SlaQuery } | { ok: false; message: string } {
  const get = (k: string) => {
    const v = params.get(k);
    return v === null || v.trim() === "" ? null : v.trim();
  };

  const status = (get("status") ?? "open").toLowerCase();
  if (status !== "open" && status !== "resolved" && status !== "all") {
    return { ok: false, message: "'status' must be one of: open, resolved, all." };
  }

  let limit = SLA_DEFAULT_LIMIT;
  const rawLimit = get("limit");
  if (rawLimit !== null) {
    const n = parseIntParam(rawLimit);
    if (n === null || n < 1 || n > SLA_MAX_LIMIT) {
      return { ok: false, message: `'limit' must be an integer from 1 to ${SLA_MAX_LIMIT}.` };
    }
    limit = n;
  }

  let offset = 0;
  const rawOffset = get("offset");
  if (rawOffset !== null) {
    const n = parseIntParam(rawOffset);
    if (n === null) return { ok: false, message: "'offset' must be a non-negative integer." };
    offset = n;
  }

  return { ok: true, query: { status, limit, offset } };
}

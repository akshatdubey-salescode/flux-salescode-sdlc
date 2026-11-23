/**
 * Pure helpers of GET /api/deliveries/[id]/movements/signer-candidates: validating the search text, building a safe
 * ILIKE pattern, and shaping `users` rows into {email, name}. The `users` table has no name column (its id is the
 * e-mail), so a display name is derived from the local part ("aakash.patel@salescode.ai" -> "Aakash Patel").
 */

export const SIGNER_QUERY_MIN = 2;
export const SIGNER_QUERY_MAX = 60;
export const SIGNER_CANDIDATES_LIMIT = 20;
/** A search of 4 words is plenty ("aakash patel salescode ai"); more only widens the query for nothing. */
const MAX_TERMS = 4;

/** Letters, digits and the characters of an e-mail address, plus spaces between words. */
const QUERY_RE = /^[A-Za-z0-9._%+@\- ]+$/;

export type QueryCheck = { ok: true; terms: string[] } | { ok: false; error: string };

/** The trimmed text must be 2..60 characters of the allowed set; it is split into at most 4 lower-case words. */
export function validateSignerQuery(raw: unknown): QueryCheck {
  const q = typeof raw === "string" ? raw.trim() : "";
  if (q.length < SIGNER_QUERY_MIN) return { ok: false, error: `Type at least ${SIGNER_QUERY_MIN} characters` };
  if (q.length > SIGNER_QUERY_MAX) return { ok: false, error: `At most ${SIGNER_QUERY_MAX} characters` };
  if (!QUERY_RE.test(q)) return { ok: false, error: "Use letters, digits and . _ % + @ - only" };
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length > MAX_TERMS) return { ok: false, error: `At most ${MAX_TERMS} words` };
  return { ok: true, terms };
}

/** `%` and `_` (and the escape character itself) mean themselves in the pattern: `a_b` must not match `axb`. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `%term%` for each word, ready for `ILIKE ... ESCAPE '\'`. */
export function likePatterns(terms: readonly string[]): string[] {
  return terms.map((t) => `%${escapeLike(t)}%`);
}

/** "aakash.patel+test@salescode.ai" -> "Aakash Patel"; a local part with no letters falls back to the whole address. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local
    .replace(/\+.*$/, "")
    .split(/[._\-]+/)
    .filter((w) => /[A-Za-z]/.test(w));
  if (words.length === 0) return email;
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

export interface SignerCandidate {
  email: string;
  name: string;
}

/** Rows of `users` (id = e-mail) to at most 20 candidates, sorted by address, without duplicates. */
export function shapeSignerCandidates(rows: ReadonlyArray<{ id: string }>, limit = SIGNER_CANDIDATES_LIMIT): SignerCandidate[] {
  const seen = new Set<string>();
  const out: SignerCandidate[] = [];
  for (const r of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const email = r.id.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: nameFromEmail(email) });
    if (out.length >= limit) break;
  }
  return out;
}

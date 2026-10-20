// Reviewer assignment rules, shared by the submission page and the commit API.

export const MAX_REVIEWERS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ReviewerInput = { email: string; name?: string | null };

export function validateReviewers(
  input: unknown,
  committerEmail: string,
): { ok: true; reviewers: { email: string; name: string | null }[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "Assign at least one reviewer." };
  }
  const committer = committerEmail.trim().toLowerCase();
  const seen = new Set<string>();
  const reviewers: { email: string; name: string | null }[] = [];

  for (const r of input as ReviewerInput[]) {
    const email = typeof r?.email === "string" ? r.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email)) return { ok: false, error: `"${String(r?.email ?? "")}" is not a valid email address.` };
    if (email === committer) {
      return { ok: false, error: "You can't review your own submission. Choose someone else as reviewer." };
    }
    if (seen.has(email)) continue;
    seen.add(email);
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 120) : null;
    reviewers.push({ email, name });
  }
  if (reviewers.length > MAX_REVIEWERS) {
    return { ok: false, error: `At most ${MAX_REVIEWERS} reviewers can be assigned.` };
  }
  return { ok: true, reviewers };
}

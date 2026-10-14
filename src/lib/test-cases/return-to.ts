// Where a TC page should send the user back to (the Delivery / Sprint tab they
// came from). Carried in a `from` query param, so it must be treated as
// untrusted input: only same-site relative paths are ever followed.

const MAX_LENGTH = 500;

export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > MAX_LENGTH) return null;
  // Same-site paths only: "//host" and "/\host" are protocol-relative / browser-normalised to other origins.
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\\]/.test(v)) return null;
  return v;
}

/** Appends `from` to an internal href, keeping any existing query. No-op without a valid return path. */
export function withReturnTo(href: string, returnTo: string | null | undefined): string {
  const safe = safeReturnTo(returnTo);
  if (!safe) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(safe)}`;
}

/** "Back to Delivery Tracking" etc. for the project tabs the chips live on; plain "Back" otherwise. */
export function returnLabel(returnTo: string | null | undefined): string {
  const safe = safeReturnTo(returnTo);
  if (!safe) return "Back";
  if (safe.includes("tab=delivery-tracker")) return "Back to Delivery Tracking";
  if (safe.includes("tab=sprint-tracker")) return "Back to Sprint Tracking";
  return "Back";
}

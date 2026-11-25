// Pure helpers for the support Settings form. No server/DB imports, so they
// are safe for client components and unit-testable.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Splits typed or pasted text into email chips (on commas, semicolons and
 * whitespace), lowercased, deduplicated against `existing` and each other.
 * Anything that isn't an email comes back in `invalid` so the input can keep it.
 */
export function parseEmailChips(
  text: string,
  existing: readonly string[] = [],
): { added: string[]; invalid: string[] } {
  const seen = new Set(existing.map((e) => e.toLowerCase()));
  const added: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_RE.test(email)) {
      invalid.push(part.trim());
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    added.push(email);
  }
  return { added, invalid };
}

export type SettingsField =
  | "enabled"
  | "supportLabel"
  | "sharedBy"
  | "toEmails"
  | "ccEmails"
  | "period"
  | "sla"
  | "officeHours"
  | "approvers"
  | "email"
  | "schedule"
  | "form";

/**
 * Which form section a PUT /settings validation error belongs to, so it can be
 * shown inline next to that section. Matches the messages in
 * `parseSettingsBody` (src/lib/support/validate.ts).
 */
export function settingsErrorField(error: string): SettingsField {
  if (/^enabled\b/.test(error)) return "enabled";
  if (/^supportLabel\b/.test(error)) return "supportLabel";
  if (/^sharedBy\b/.test(error)) return "sharedBy";
  if (/toEmails|To recipient/.test(error)) return "toEmails";
  if (/ccEmails/.test(error)) return "ccEmails";
  if (/^period(Mode|Start)\b/.test(error)) return "period";
  if (/^sla\b/.test(error)) return "sla";
  if (/^officeHours\b/.test(error)) return "officeHours";
  if (/^approverUserIds\b/.test(error)) return "approvers";
  if (/^(clientName|subjectTemplate)\b/.test(error)) return "email";
  if (/^(frequency|weeklyDay)\b/.test(error)) return "schedule";
  return "form";
}

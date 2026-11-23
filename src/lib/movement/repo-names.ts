/**
 * Repo spellings in review comments. Records name PRs in free text (`flutter #49`, `auth-service #332`);
 * the same PR can be written with a short alias and with the full repo name by two comments.
 */
import { normalizeRepo, prKey } from "./record";

export { normalizeRepo, prKey };

/**
 * Short names reviewers use -> repo name. Used only when the alias target is a repo the records
 * themselves name; extend it when a new alias shows up in real records.
 */
export const REPO_ALIASES: Readonly<Record<string, string>> = {
  flutter: "channelkart-flutter",
  "auth-service": "salescode-auth-service",
  auth: "salescode-auth-service",
  kpi: "kpi-dashboard",
};

/**
 * Map a repo name found in a record to the name the other records use: an entry of REPO_ALIASES whose
 * target is a repo the records name wins (`flutter` -> `channelkart-flutter`); otherwise the name as
 * written. There is deliberately NO prefix/suffix guessing: `channelkart` must never become
 * `channelkart-flutter`. An unresolved sibling is its own PR that needs a record under the name it
 * was written with.
 */
export function resolveRepoAlias(name: string, known: Iterable<string> = []): string {
  const n = normalizeRepo(name);
  const alias = REPO_ALIASES[n];
  if (!alias) return n;
  for (const k of known) if (normalizeRepo(k) === alias) return alias;
  return n;
}

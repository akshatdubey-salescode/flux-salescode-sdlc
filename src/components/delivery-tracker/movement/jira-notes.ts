/**
 * Plain-language reading of a Jira's blockers and warnings for the Jiras table. Each Jira carries ONE review comment (the union of its PRs);
 * the checklist is read only from it, never from the PRs. The server sends each note as `{code, message}`; the table needs them keyed by code:
 * no review comment, a PR named by an older per-PR comment that has none, a Jira that could not be read, and so on. Everything here is pure
 * (no React, no fetch) and tested. A note with a shape this UI does not know is still shown as the server wrote it (plain wording), so a new
 * kind never disappears.
 */
import type { ItemNote } from "./api-types";

// ---------------------------------------------------------------------------------------------
// wording
// ---------------------------------------------------------------------------------------------

/** The tab says "review comment" for the Jira comment (the server's "deployment record" is rewritten; the help explains it once). */
export function plainWording(s: string): string {
  return s.replace(/deployment records/gi, (m) => (m[0] === "D" ? "Review comments" : "review comments")).replace(/deployment record/gi, (m) => (m[0] === "D" ? "Review comment" : "review comment"));
}

/** The one place the review comment is explained. */
export const RECORD_HELP =
  "Each Jira carries one review comment: the Jira comment, posted by the review agent when you ask for it, that lists every merged PR of the Jira and everything needed to deploy it (services, configs, DB changes, order, rollback, what to test). Everything in the checklist is read from these comments, never from the PRs themselves. A Jira can move only when it has one.";

/** Cut to `max` characters with an ellipsis (the full text goes in a tooltip). */
export function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

// ---------------------------------------------------------------------------------------------
// blockers by code
// ---------------------------------------------------------------------------------------------

/** What kind of problem a blocker is (several codes can share a kind). */
export type BlockerKind = "no_comment" | "not_covered" | "unreadable" | "incomplete";

export function blockerKind(code: string): BlockerKind | null {
  switch (code) {
    case "no_record":
    case "pr_no_record": // written before reviews were per Jira; still read from stored rows
      return "no_comment";
    case "sibling_no_record":
      return "not_covered";
    case "tree_unreadable":
      return "unreadable";
    case "tree_incomplete":
      return "incomplete";
    default:
      return null;
  }
}

/** The distinct kinds present, most useful first. */
export function blockerKinds(blockers: ReadonlyArray<Pick<ItemNote, "code">>): BlockerKind[] {
  const order: BlockerKind[] = ["no_comment", "not_covered", "unreadable", "incomplete"];
  const present = new Set(blockers.map((b) => blockerKind(b.code)).filter((k): k is BlockerKind => k !== null));
  return order.filter((k) => present.has(k));
}

export interface NotCovered {
  /** `repo#123` as the server names it. */
  prKey: string;
  repo: string;
  number: number;
}

const SIBLING_RE = /^([A-Za-z0-9._-]+)#(\d+) is named as a sibling in the record of/i;

/** The PRs a `sibling_no_record` note says no review comment covers (an older per-PR comment names them); other notes give none. */
export function notCoveredPrs(blockers: ReadonlyArray<Pick<ItemNote, "code" | "message">>): NotCovered[] {
  const out: NotCovered[] = [];
  for (const b of blockers) {
    if (b.code !== "sibling_no_record") continue;
    const m = SIBLING_RE.exec(b.message);
    if (m && !out.some((p) => p.prKey === `${m[1]}#${m[2]}`)) out.push({ prKey: `${m[1]}#${m[2]}`, repo: m[1], number: Number(m[2]) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// the row's "Why" and the expansion's "What to do"
// ---------------------------------------------------------------------------------------------

const KIND_WHY: Record<Exclude<BlockerKind, "not_covered">, string> = {
  no_comment: "Review not posted yet",
  unreadable: "Jira could not be read",
  incomplete: "Too many sub-Jiras to check",
};

export const WHY_MAX = 60;

/**
 * The one short sentence in the row's "Why" column (about 60 characters at most). The checklist comes only from the review comment on the Jira,
 * so a missing one reads as "not posted yet", never as if PRs were read:
 * - no review comment (code no_record): "Review not posted yet";
 * - an older per-PR comment names a PR that has no review comment: "Partly reviewed: repo#9 not covered" (+N more);
 * - the Jira or its comments could not be read: "Jira could not be read" / "Too many sub-Jiras to check";
 * - overridden: who and why; ready: "1 review comment · 2 PRs".
 * With several kinds of problem: the first, then "+K more problem(s)".
 */
export function whyText(item: {
  key: string;
  readiness: "ready" | "blocked" | "override";
  blockers: ReadonlyArray<Pick<ItemNote, "code" | "message">>;
  override: { reason: string; by: string | null } | null;
  recordCount: number;
  reviews?: number;
  prs?: { covered: number };
}): string {
  if (item.readiness === "override") {
    const who = item.override?.by ? ` by ${item.override.by}` : "";
    return truncate(`Overridden${who}: ${item.override?.reason ?? ""}`.replace(/: $/, ""), WHY_MAX);
  }
  if (item.readiness === "ready") {
    const reviews = item.reviews ?? item.recordCount;
    if (!(reviews > 0)) return "No PR to move";
    const covered = item.prs?.covered ?? 0;
    return `${reviews} review comment${reviews === 1 ? "" : "s"}${covered > 0 ? ` · ${covered} PR${covered === 1 ? "" : "s"}` : ""}`;
  }
  const kinds = blockerKinds(item.blockers);
  if (kinds.length === 0) return item.blockers[0] ? truncate(plainWording(item.blockers[0].message), WHY_MAX) : "Blocked";
  const first = kinds[0];
  let text: string;
  if (first === "not_covered") {
    const prs = notCoveredPrs(item.blockers);
    text = prs.length === 0 ? "Partly reviewed" : `Partly reviewed: ${prs[0].prKey} not covered${prs.length > 1 ? ` (+${prs.length - 1} more)` : ""}`;
  } else text = KIND_WHY[first];
  const more = kinds.length - 1;
  return truncate(more > 0 ? `${text} · +${more} more problem${more === 1 ? "" : "s"}` : text, WHY_MAX + 14);
}

/** The full "why" for a tooltip: every blocker sentence in plain wording. */
export function whyTitle(item: { blockers: ReadonlyArray<Pick<ItemNote, "message">>; override: { reason: string; by: string | null } | null; readiness: string }): string {
  if (item.readiness === "override" && item.override) return `Overridden${item.override.by ? ` by ${item.override.by}` : ""}: ${item.override.reason}`;
  return item.blockers.map((b) => plainWording(b.message)).join("\n");
}

/** One "what to do" line per kind of blocker, in plain words. `key` is the Jira being looked at. */
export function todoLines(blockers: ReadonlyArray<Pick<ItemNote, "code">>, key: string): Array<{ kind: BlockerKind; text: string }> {
  const text: Record<BlockerKind, string> = {
    no_comment: `The review comment has not been posted on ${key}. Ask the reviewer to post one (the Jira comment with the DEPLOYMENT-RECORD marker), or an admin can override with a reason.`,
    not_covered: `A review comment on ${key} names PRs that no review comment covers. Ask the reviewer to post the review comment that covers them, or an admin can override with a reason.`,
    unreadable: "Jira could not be read. Press Refresh; if it keeps failing, check the Jira connection, or an admin can override.",
    incomplete: `${key} has too many sub-Jiras to check. Split the delivery, or an admin can override with a reason.`,
  };
  return blockerKinds(blockers).map((kind) => ({ kind, text: text[kind] }));
}

// ---------------------------------------------------------------------------------------------
// warnings: what / where
// ---------------------------------------------------------------------------------------------

const WHERE_PREFIX = /^([A-Za-z0-9._-]+#\d+|[A-Z][A-Z0-9]+-\d+): ([\s\S]*)$/;

/**
 * A warning split into "where" (a PR, a Jira, or the review comment) and the text, in plain wording.
 * - stale_record: "PR repo#9 has new commits since the review: reviewed abc, now def" -> where repo#9, "New commits since the review on repo#9: reviewed abc, now def";
 * - record_status: "CAV-7280 (demo): HELD in the DEMO movement" -> where "CAV-7280 (demo)", text "HELD in the DEMO movement";
 * - a message that starts with a PR or Jira key and a colon: that key is the where.
 */
export function warningParts(note: Pick<ItemNote, "code" | "message">): { where: string | null; text: string } {
  const stale = /^PR ([A-Za-z0-9._-]+#\d+) has new commits since the review: ([\s\S]*)$/.exec(note.message);
  if (stale) return { where: stale[1], text: `New commits since the review on ${stale[1]}: ${stale[2]}` };
  const status = /^([A-Z][A-Z0-9]+-\d+) \(([^)]*)\): ([\s\S]*)$/.exec(note.message);
  if (status) return { where: `${status[1]} (${status[2]})`, text: plainWording(status[3]) };
  const m = WHERE_PREFIX.exec(note.message);
  if (m) return { where: m[1], text: plainWording(m[2]) };
  if (note.code === "linked_pr_no_record") {
    const l = /^([A-Z][A-Z0-9]+-\d+) \(linked ([A-Z][A-Z0-9]+-\d+)\) has no deployment record/.exec(note.message);
    if (l) return { where: l[1], text: `Linked issue of ${l[2]} has no review comment (linked issues do not block)` };
  }
  const own = /^(?:Comments of|Only the newest \d+ comments of) ([A-Z][A-Z0-9]+-\d+)/.exec(note.message);
  if (own) return { where: own[1], text: plainWording(note.message) };
  return { where: null, text: plainWording(note.message) };
}

export const WARNINGS_COLLAPSED = 5;

/** The warning rows to show now: the first few, or all when expanded. */
export function warningRows<T>(rows: readonly T[], showAll: boolean, max = WARNINGS_COLLAPSED): { shown: T[]; hidden: number } {
  if (showAll || rows.length <= max) return { shown: [...rows], hidden: 0 };
  return { shown: rows.slice(0, max), hidden: rows.length - max };
}

// ---------------------------------------------------------------------------------------------
// copying the Jiras
// ---------------------------------------------------------------------------------------------

/** KEY order that reads naturally: CAV-9 before CAV-10 (project prefix first, then the number). */
export function compareKeys(a: string, b: string): number {
  const split = (k: string): [string, number] => {
    const m = /^(.*?)-?(\d+)$/.exec(k);
    return m ? [m[1], Number(m[2])] : [k, Number.NaN];
  };
  const [pa, na] = split(a);
  const [pb, nb] = split(b);
  if (pa !== pb) return pa < pb ? -1 : 1;
  if (Number.isNaN(na) || Number.isNaN(nb)) return a < b ? -1 : a > b ? 1 : 0;
  return na - nb;
}

export const COPY_SUMMARY_MAX = 140;

export type CopyJiraItem = { key: string; summary: string; readiness: "ready" | "blocked" | "override"; included: boolean };

/** The marker the "all" variant appends: ` [blocked]`, ` [ready]`, ` [overridden]` or ` [not selected]`. */
export function jiraMarker(i: Pick<CopyJiraItem, "readiness" | "included">): string {
  if (i.readiness === "blocked") return "blocked";
  if (i.readiness === "override") return "overridden";
  return i.included ? "ready" : "not selected";
}

/**
 * The Jiras of a movement as plain text for the clipboard (no checklist content, no HTML):
 *
 *   Jiras for PROD movement: Release 19 Nov (3)
 *   - CAV-7304: Account lock https://x.atlassian.net/browse/CAV-7304
 *   - CAV-7346: Partner banner https://x.atlassian.net/browse/CAV-7346 [blocked]      (the "all" variant only)
 *
 * "selected" = the effectively ticked ones; "all" = every Jira, each with its marker. Sorted naturally by key; the summary is one line,
 * cut to 140 characters; the URL is left out when the Jira base URL is not known.
 */
export function jirasCopyText(opts: { environment: string; deliveryName: string; items: readonly CopyJiraItem[]; jiraBaseUrl: string | null; variant: "selected" | "all" }): string {
  const rows = opts.items.filter((i) => opts.variant === "all" || i.included).slice().sort((a, b) => compareKeys(a.key, b.key));
  const base = opts.jiraBaseUrl && /^https?:\/\//i.test(opts.jiraBaseUrl) ? opts.jiraBaseUrl.replace(/\/+$/, "") : null;
  const name = truncate(opts.deliveryName, 200) || "delivery";
  const lines = [`Jiras for ${opts.environment.toUpperCase()} movement: ${name} (${rows.length})`];
  for (const i of rows) {
    const summary = truncate(i.summary, COPY_SUMMARY_MAX);
    const url = base ? ` ${base}/browse/${encodeURIComponent(i.key)}` : "";
    lines.push(`- ${i.key}:${summary ? ` ${summary}` : ""}${url}${opts.variant === "all" ? ` [${jiraMarker(i)}]` : ""}`);
  }
  return lines.join("\n");
}

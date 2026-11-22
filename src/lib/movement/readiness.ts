/**
 * Readiness of ONE root Jira for an environment movement. Pure: no I/O, everything comes in.
 *
 * The model: each Jira carries ONE review comment (the newest DEPLOYMENT-RECORD on the ticket) that
 * lists every PR (`facts.covers`). Flux does not look PRs up anywhere; what is covered is what the
 * comment says. STRICT rule, failing CLOSED. The Jira is BLOCKED when
 *  - no review comment was found on the root or on any non-linked node (sub-task / child) of its tree
 *    (`no_record`). Linked issues add records but never satisfy the Jira;
 *  - the Jira tree is incomplete: unreadable, or cut by the depth / 60-node cap;
 *  - (legacy, one comment per PR) a record names a sibling PR that no record on the tree covers
 *    (`sibling_no_record`). A PR a record says it "Replaces (closed)" is ignored. Sibling repo names are
 *    reconciled only through the alias table in repo-names.ts (`flutter #49` -> `channelkart-flutter#49`).
 * A union record covers every PR it lists. A record whose header names a ticket outside the tree is ignored
 * (`record_wrong_ticket`). Everything else is a warning and never blocks: record status HELD / PARTIAL /
 * BLOCKED, open unknowns, parser notes, capped / unreadable comments, a reviewed head that has moved.
 * Older tickets whose review was posted per PR still work; their earlier-phase PRs are no longer detectable
 * (there is no PR table), only the siblings the comments name.
 */
import { coversOf, isUnion, reviewedHead } from "./covers";
import { sameHead } from "./heads";
import { plainParseNotes } from "./time-format";
import { pickNewestRecords, prKey, type ParsedRecord } from "./record";
import type { IssueRecords } from "./records";
import { resolveRepoAlias } from "./repo-names";
import type { RootTree } from "./tree";

export type BlockerCode = "sibling_no_record" | "no_record" | "tree_unreadable" | "tree_incomplete";
export type WarningCode =
  | "record_status"
  | "stale_record"
  | "heads_unknown"
  | "open_unknowns"
  | "record_parse"
  | "records_capped"
  | "comments_unreadable"
  | "linked_truncated"
  | "record_wrong_ticket";

export interface Blocker {
  code: BlockerCode;
  message: string;
  /** `repo#pr` or a Jira key. */
  ref: string;
}
export interface ReadinessWarning {
  code: WarningCode;
  message: string;
  ref: string | null;
}

/** Where the newest record of a PR lives. Pointers only (this is what the DB stores). */
export interface RecordPointer {
  issueKey: string;
  prKey: string;
  repo: string;
  pr: number;
  commentId: string;
  version: number | null;
  updated: string | null;
  status: ParsedRecord["status"];
  headReviewed: string | null;
  /** `union`: one pointer per PR the comment covers, all sharing `commentId`. `pr`: a per-PR (legacy) record. */
  scope: "pr" | "union";
  /** `union`: index of the cover in the record's `facts.covers`. */
  coverIndex?: number;
}

export interface Readiness {
  root: string;
  readiness: "ready" | "blocked";
  blockers: Blocker[];
  warnings: ReadinessWarning[];
  /** The newest records the verdict rests on, one pointer per covered PR (union comments list each PR). */
  records: RecordPointer[];
  /** The same records (repo spellings reconciled), one object per review comment: what is stored and what the checklist reads. */
  recordsUsed: ParsedRecord[];
  /** Distinct PRs named across the records (covers). */
  prsCovered: number;
  /** Distinct review comments. */
  reviews: number;
}

export interface ReadinessInput {
  root: string;
  tree: RootTree;
  /** Records by the issue they were read from (loadRecords). Missing key = none found. */
  recordsByIssue: ReadonlyMap<string, IssueRecords>;
  /** `repo#pr` -> current head SHA or "unknown" (fetchPrHeads). Omit to skip the stale check. */
  heads?: ReadonlyMap<string, string>;
}

const short = (sha: string) => sha.slice(0, 10);

export function computeReadiness(input: ReadinessInput): Readiness {
  const { root, tree, recordsByIssue, heads } = input;
  const blockers: Blocker[] = [];
  const warnings: ReadinessWarning[] = [];
  const warn = (code: WarningCode, message: string, ref: string | null = null) => warnings.push({ code, message, ref });
  const nodeKind = new Map(tree.nodes.map((n) => [n.key, n.kind]));
  const treeKeys = new Set(tree.nodes.map((n) => n.key.toUpperCase()));

  // ---- the records of the tree
  const raw: Array<{ rec: ParsedRecord; home: string }> = [];
  const known = new Set<string>();
  for (const n of tree.nodes) {
    for (const r of recordsByIssue.get(n.key)?.records ?? []) {
      // A record that names another ticket (pasted from elsewhere) must not satisfy this one.
      // Agents post on the root, so any key of the tree is accepted; an unreadable key is accepted too.
      if (r.marker.key && !treeKeys.has(r.marker.key.toUpperCase())) {
        warn(
          "record_wrong_ticket",
          `A record on ${n.key} is for ${r.marker.key}, which is not part of this Jira's tree; it was ignored (${isUnion(r) ? (r.marker.target ?? "union record") : `${r.marker.repo ?? "?"}#${r.marker.pr ?? "?"}`})`,
          n.key
        );
        continue;
      }
      raw.push({ rec: r, home: n.key });
      for (const c of coversOf(r)) known.add(c.repo);
    }
  }
  // Repo spellings reconciled: marker `flutter#50` and `channelkart-flutter#50` are one PR. Copies, never the cached objects.
  const canon = (repo: string) => resolveRepoAlias(repo, known);
  const keyOf = (repo: string, pr: number) => prKey(canon(repo), pr);
  const home = new Map<ParsedRecord, string>();
  const all: ParsedRecord[] = [];
  for (const { rec, home: h } of raw) {
    let r = rec;
    const repo = rec.marker.repo ? canon(rec.marker.repo) : null;
    const covers = rec.facts.covers;
    const recanon = covers?.some((c) => canon(c.repo) !== c.repo) ?? false;
    if ((repo !== null && repo !== rec.marker.repo) || recanon) {
      r = {
        ...rec,
        marker: repo !== null && repo !== rec.marker.repo ? { ...rec.marker, repo } : rec.marker,
        facts: recanon ? { ...rec.facts, covers: covers!.map((c) => ({ ...c, repo: canon(c.repo) })) } : rec.facts,
      };
    }
    all.push(r);
    home.set(r, h);
  }

  // The newest record per PR, and the newest union per ticket (older ones are superseded).
  const picked = pickNewestRecords(all);
  const coveredBy = new Map<string, ParsedRecord>();
  for (const r of picked) for (const c of coversOf(r)) if (!coveredBy.has(keyOf(c.repo, c.pr))) coveredBy.set(keyOf(c.repo, c.pr), r);

  // ---- blockers
  const satisfying = picked.filter((r) => nodeKind.get(home.get(r) ?? "") !== "linked");
  if (satisfying.length === 0) {
    const capped = tree.nodes.some((n) => recordsByIssue.get(n.key)?.capped);
    const unreadable = tree.nodes.some((n) => recordsByIssue.get(n.key)?.error);
    blockers.push({
      code: "no_record",
      ref: root,
      message: `No review comment found on this Jira${capped ? " (only the newest comments were read)" : ""}${unreadable ? " (some Jira comments could not be read)" : ""}`,
    });
  }

  // Legacy (one record per PR): a PR a record names as a sibling must have a record of its own on the tree.
  const replaced = new Set<string>();
  for (const r of picked) {
    for (const p of r.facts.replaces ?? []) {
      const repo = p.repo ?? r.marker.repo;
      if (repo && p.state && /closed/i.test(p.state)) replaced.add(keyOf(repo, p.pr));
    }
  }
  const siblings = new Map<string, string[]>();
  for (const r of satisfying) {
    const owner = home.get(r) as string;
    for (const s of r.facts.siblings ?? []) {
      if (s.state === "closed") continue;
      const k = keyOf(s.repo, s.pr);
      if (replaced.has(k) || coveredBy.has(k)) continue;
      const owners = siblings.get(k);
      if (!owners) siblings.set(k, [owner]);
      else if (!owners.includes(owner)) owners.push(owner);
    }
  }
  for (const [k, owners] of siblings) {
    const unreadable = owners.some((o) => recordsByIssue.get(o)?.error);
    blockers.push({
      code: "sibling_no_record",
      ref: k,
      message: `${k} is named as a sibling in the record of ${owners.join(", ")} but has no record of its own${unreadable ? " (the Jira comments could not be read)" : ""}`,
    });
  }

  // Fail closed on partial data.
  for (const e of tree.errors) blockers.push({ code: "tree_unreadable", ref: root, message: e });
  if (tree.truncated) {
    blockers.push({ code: "tree_incomplete", ref: root, message: `Jira tree incomplete: ${tree.warnings.join("; ") || "a limit was reached"}` });
  }

  // ---- warnings
  if (tree.linkedTruncated) warn("linked_truncated", "Some linked issues were not listed (60-issue cap); linked issues never block", root);
  for (const n of tree.nodes) {
    const rec = recordsByIssue.get(n.key);
    if (!rec) continue;
    if (rec.error) warn("comments_unreadable", `Comments of ${n.key} could not be read fully: ${rec.error.slice(0, 120)}`, n.key);
    if (rec.capped) warn("records_capped", `Only the newest ${rec.commentsSeen} comments of ${n.key} were read; an older record may be missing`, n.key);
  }

  let unknowns = 0;
  for (const r of picked) {
    const union = isUnion(r);
    const own = !union && r.marker.repo && r.marker.pr !== null ? keyOf(r.marker.repo, r.marker.pr) : null;
    const k = own ?? `comment ${r.comment.id}`;
    if ((r.status === "PARTIAL" || r.status === "BLOCKED") && r.statusText) {
      warn("record_status", union ? `${r.marker.key ?? "?"} (${r.marker.target ?? "union record"}): ${r.statusText}` : `${k}: ${r.statusText}`, k);
    }
    unknowns += r.unknowns.length;
    const codes = [...new Set(r.warnings.map((w) => w.code))];
    if (codes.length) warn("record_parse", `${union ? (r.marker.target ?? k) : k}: ${plainParseNotes(codes)}`, k);
  }
  if (unknowns > 0) warn("open_unknowns", `${unknowns} open "unknown, owner to confirm" item${unknowns === 1 ? "" : "s"} across ${picked.length} record${picked.length === 1 ? "" : "s"}`);

  // Optional: has a covered PR moved on since the review? Needs the reviewed SHA the record wrote down.
  if (heads) {
    let unreadable = 0;
    for (const r of picked) {
      for (const c of coversOf(r)) {
        const reviewed = reviewedHead(r, c);
        if (!reviewed) continue;
        const k = keyOf(c.repo, c.pr);
        const current = heads.get(k) ?? heads.get(prKey(c.repo, c.pr));
        if (!current || current === "unknown") unreadable++;
        else if (!sameHead(reviewed, current)) warn("stale_record", `PR ${k} has new commits since the review: reviewed ${short(reviewed)}, now ${short(current)}`, k);
      }
    }
    if (unreadable > 0) warn("heads_unknown", `Current head not readable for ${unreadable} PR${unreadable === 1 ? "" : "s"}; stale check skipped for them`);
  }

  // ---- what the verdict rests on
  const pointers: RecordPointer[] = [];
  for (const r of picked) {
    const base = { issueKey: home.get(r) ?? "", commentId: r.comment.id, version: r.marker.version, updated: r.comment.updated ?? r.comment.created, status: r.status };
    if (isUnion(r)) {
      coversOf(r).forEach((c, i) =>
        pointers.push({ ...base, prKey: keyOf(c.repo, c.pr), repo: canon(c.repo), pr: c.pr, headReviewed: c.sha ?? null, scope: "union", coverIndex: i })
      );
    } else if (r.marker.repo && r.marker.pr !== null) {
      pointers.push({ ...base, prKey: keyOf(r.marker.repo, r.marker.pr), repo: canon(r.marker.repo), pr: r.marker.pr, headReviewed: r.facts.headReviewed ?? null, scope: "pr" });
    }
  }
  return {
    root,
    readiness: blockers.length ? "blocked" : "ready",
    blockers,
    warnings,
    records: pointers,
    recordsUsed: picked,
    prsCovered: coveredBy.size,
    reviews: new Set(picked.map((r) => r.comment.id)).size,
  };
}

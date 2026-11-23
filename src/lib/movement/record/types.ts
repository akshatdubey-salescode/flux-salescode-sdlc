/**
 * Types of the DEPLOYMENT-RECORD parser.
 *
 * The model is deliberately DYNAMIC. A record is a list of numbered sections plus a thin
 * JSON subset; reviewers vary wording, add sections, drop columns. So:
 *  - every field of `facts` is optional and filled by an independent best-effort extractor;
 *  - nothing is ever dropped: whatever is not structured stays in `sections[].text`;
 *  - when the readable text and the JSON disagree the readable text wins and a warning is raised.
 */

// ---------------------------------------------------------------------------------------------
// Structure-preserving block list (output of adf.ts, input of the section splitter)
// ---------------------------------------------------------------------------------------------

/** An inline run. Flags are only present when set (keeps the objects small). */
export interface Run {
  text: string;
  bold?: true;
  code?: true;
  href?: string;
}

export type Block =
  | { kind: "paragraph"; runs: Run[] }
  | { kind: "heading"; level: number; runs: Run[] }
  /** One list item (nested lists are flattened with a depth). `index` only for ordered lists. */
  | { kind: "listItem"; ordered: boolean; depth: number; index?: number; runs: Run[] }
  /**
   * A table as rows of plain cell text. `header` is true when the first row is a header row
   * (ADF tableHeader cells, or the row before a markdown `|---|` separator).
   */
  | { kind: "table"; header: boolean; rows: string[][] }
  | { kind: "code"; text: string };

export interface BlockList {
  blocks: Block[];
  /** True when a safety limit (depth 40, block count, total chars) cut the content. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------------------------
// Header / marker
// ---------------------------------------------------------------------------------------------

/** `supersedes:` of the header, or of the JSON marker. `none` becomes null at the marker level. */
export interface Supersedes {
  raw: string;
  /** First `v2` => 2 (see `versions` for a list such as "v1, v2"). */
  version: number | null;
  /** First Jira comment id (4+ digits) the record names as replaced. */
  commentId: string | null;
  versions: number[];
  commentIds: string[];
  /** `repo#pr` mentions ("supersedes: channelkart#1184"): informational, never a comment id. */
  prs: string[];
}

export interface RecordMarker {
  /** `v1` => 1; null when the header carries no version. */
  version: number | null;
  /** Jira key the record is posted on, e.g. CAV-7346. */
  key: string | null;
  /** Normalised repo name without owner: `salescode-ai/channelkart-flutter` => `channelkart-flutter`. */
  repo: string | null;
  pr: number | null;
  /** ISO 8601 (UTC) of the header date; null when absent or unparseable. */
  at: string | null;
  /** The date text exactly as written (kept for display and debugging). */
  atRaw: string | null;
  agent: string | null;
  supersedes: Supersedes | null;
  /**
   * `pr`: the record is about one PR (`repo#pr` in the header; the default). `union`: the third
   * header field is free text ("union of 2 merged PRs"): the record covers several PRs, listed in
   * `facts.covers`; `repo` and `pr` stay null.
   */
  scope?: "pr" | "union";
  /** The free text of the third header field of a `union` record. */
  target?: string;
  /** "union of 17 merged PRs" => 17: how many PRs the header says the record covers. */
  declaredPrs?: number;
  /**
   * Every older comment the `supersedes:` line names, as written: comment ids ("81643") and
   * version tokens ("v1"), from a comma / space / "and" separated list. `supersedes` keeps the
   * first of each kind for compatibility; `supersedes.commentIds` holds all the ids.
   */
  supersedesAll?: string[];
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

/**
 * The 14 sections of the Confluence page / review template. The parser decides which one a
 * section is by its number first; when the title unambiguously names a DIFFERENT known section
 * (a renumbered template) the title wins. Unknown numbers/titles stay as `null` and are kept.
 */
export type CanonicalSection =
  | "header"
  | "branches"
  | "prodBranch"
  | "deploy"
  | "restart"
  | "appRelease"
  | "database"
  | "configs"
  | "roles"
  | "compat"
  | "order"
  | "testing"
  | "risks"
  | "verify";

export type EvidenceTag = "V" | "I" | "author";

export interface SectionTag {
  tag: EvidenceTag;
  /** Text inside the bracket after the tag, e.g. `[author, rollout item 2]` => "rollout item 2". */
  detail?: string;
}

export interface SectionTable {
  /** Header cell text, in order. For a table without a header row: col1, col2, ... */
  header: string[];
  /**
   * Rows keyed by header text, so the column order and count can vary. A cell beyond the header
   * gets the key `col<N>` (1-based); a row shorter than the header simply lacks the trailing keys.
   * Duplicate header names get a `#2`, `#3` suffix.
   */
  rows: Array<Record<string, string>>;
}
/** (Rows are null-prototype objects so a header such as `__proto__` is just a key.) */

/** `unknown, owner to confirm: <who>` found in the readable text. */
export interface UnknownItem {
  /** The clause the unknown belongs to (<= 200 chars), e.g. "ckcoe's own prod branch: unknown". */
  text: string;
  /** Who must confirm ("devops", "author", "mobile lead"); null when the sentence names nobody. */
  owner: string | null;
  /** Section number the unknown was found in; null when outside any section. */
  section: number | null;
  /** Release-page row number, for an unknown found in a numbered row of a free-form record. */
  row?: number;
  /** Canonical release-row id of that row (see `ReleaseRowId`), when it has one. */
  rowId?: string;
}

export interface RecordSection {
  /** The number as written (primary key). */
  number: number;
  /** The title as written, without the trailing colon. */
  title: string;
  /** Resolved template section, or null for an unknown/extra section. */
  canonical: CanonicalSection | null;
  /**
   * The raw readable content of the section as plain text (bold/code marks stripped; list items
   * "- x"; table rows `a | b | c`; whitespace runs collapsed; each word capped at 200 chars and
   * the section at 20 KB, with a `truncated` warning when cut).
   */
  text: string;
  /**
   * Keyed tables. The configs table is dropped once its rows are in `facts.configs` (which keeps
   * every column), so the same data is not held twice; the rows stay in `text`.
   */
  tables: SectionTable[];
  tags: SectionTag[];
  /** The same objects as in `ParsedRecord.unknowns` (shared, not copied). */
  unknowns: UnknownItem[];
}

// ---------------------------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------------------------

export type Tri = "yes" | "no" | "unknown";
/** "Note": an open point or "likely to be missed" item of a free-form (dialect) record. */
export type Severity = "Blocking" | "Should-fix" | "Nitpick" | "Note";

export interface PrRef {
  /**
   * Normalised repo name (no owner). A written alias such as `flutter` / `auth-service` is
   * resolved to the record's own full repo name by unique suffix match when possible.
   */
  repo: string;
  pr: number;
  state?: "open" | "merged" | "closed" | "draft";
  /** The repo as written, only when it was resolved to a different name. */
  written?: string;
}

export interface ServiceFact {
  /** Service name; a repo-like name written as an alias is resolved (see `written`). */
  name: string;
  /** The name as written, only when it was resolved to a different full repo name. */
  written?: string;
  /** Parenthetical remark, e.g. "new private key read once at first use". */
  note?: string;
}

export interface ConfigRow {
  key: string;
  /** Where the value lives (per-LOB property, env variable, ...). */
  store?: string;
  /** Value when the key is absent. JSON `default` and `defaultWhenAbsent` both land here. */
  default?: string;
  /** Per-environment state exactly as written ("on (ckcoedemo) [author]", "unknown"). */
  demo?: string;
  uat?: string;
  prod?: string;
  /**
   * Every value of a tenant-qualified environment column, keyed by the header as written
   * ("ckcoedemo", "hfcoedemo", "ckcoe prod"). `demo`/`uat`/`prod` above hold the first non-empty
   * one, so no tenant's value is lost when several map to the same environment.
   */
  byTenant?: Record<string, string>;
  /** Columns that name a tenant without an environment ("Tenants today", "ckcoe"): the text, by header. Also in `extra`. */
  tenants?: Record<string, string>;
  /** Any other column of the table, keyed by its header text. */
  extra?: Record<string, string>;
  /** Where the row came from: the readable table, the JSON, both (merged), or free text lines. */
  source: "table" | "json" | "both" | "text";
}

export interface RiskItem {
  severity: Severity | null;
  text: string;
  source: "text" | "json";
}

/** `before` has to be deployed before `after` (`repo#pr` labels, or free text). */
export interface OrderEdge {
  before: string;
  after: string;
}

export interface OrderStep {
  text: string;
  /** `repo#pr` references found in the step (repo may be a short alias; P4 matches it). */
  refs: PrRef[];
}

export interface RoleCase {
  /** Who is tested ("admin / report admin", "Negative"); null when the clause names nobody. */
  who: string | null;
  what: string;
  negative: boolean;
}

/** The PRs a record is about: its own PR, or every PR a `union` record lists. */
export interface Cover {
  repo: string;
  pr: number;
  branch?: string;
  /** Commit sha as written (7-40 hex characters). */
  sha?: string;
  /** Free text of the PR line (e.g. "executor"). */
  note?: string;
  state?: "open" | "merged" | "closed" | "draft";
  written?: string;
  /** Approval as stated for the merged PRs ("all approved and merged by X, 17 Nov; author Y", "no formal approval"). */
  approval?: string;
}

export type RowState = "done" | "not_done" | "not_required" | "yes" | "no" | "unknown" | "other";

/** The 23 rows of the Confluence release page, by id. */
export type ReleaseRowId =
  | "meeting"
  | "services_deploy"
  | "app_release"
  | "code_reviewed"
  | "previous_data"
  | "new_app_old_data"
  | "db_queries"
  | "db_index"
  | "bundle_reviewed"
  | "bundle_sdk"
  | "configs_prod"
  | "services_restart"
  | "ui_reviewed"
  | "ui_indexdb"
  | "performance"
  | "automation_run"
  | "automation_updated"
  | "features_old_data"
  | "beta_compat"
  | "designations"
  | "old_app_version"
  | "scenarios"
  | "cherry_pick";

/** A numbered row of a free-form record ("11  Configs to add in prod   Not Done: ..."). */
export interface ReleaseRow {
  n: number;
  /** Canonical id matched by fuzzy label, else by number; null for a row that matches neither. */
  id: ReleaseRowId | null;
  label: string;
  /** The answer as written, continuation lines joined with one space. */
  answer: string;
  /** The answer line and its continuation lines separately (only when there are continuation lines). */
  lines?: string[];
  state: RowState;
  /** The answer after the state word(s) ("Not Done: x" => "x"; "unknown (QA)" => "QA"). */
  text: string;
}

/** An ALL-CAPS label of a free-form record with the lines up to the next label. */
export interface LabelledBlock {
  label: string;
  /** Text after the label plus the continuation lines, joined with newlines. */
  text: string;
  /** The same text split into its lines (sub-points keep their "1. " prefix). */
  lines: string[];
  /** The label as written, when it was normalised ("LIKELY TO BE MISSED IN TESTING" => "LIKELY TO BE MISSED"). */
  written?: string;
}

export interface RecordFacts {
  // --- header (section 1)
  /** Free text before "Status": what the PR does. */
  summary?: string;
  headReviewed?: string;
  /** "(the head has since moved to e2ad816ab0; not yet reviewed)" => e2ad816ab0. */
  headMovedTo?: string;
  headMovedUnreviewed?: boolean;
  reviewUrl?: string;
  // --- PR (section 2)
  branch?: string;
  baseBranch?: string;
  prState?: "open" | "merged" | "closed" | "draft";
  mergeable?: boolean;
  rule31?: "pass" | "fail";
  jiraIdInBranch?: boolean;
  author?: string;
  firstCommitBy?: string;
  /** Empty array = "Approver: none yet". */
  approvers?: string[];
  /** null = "not merged". */
  mergedBy?: string | null;
  siblings?: PrRef[];
  /** "Replaces #1160 (closed)". */
  /** `repo` only when the record names a PR of another repo ("Replaces channelkart#1160"). */
  replaces?: Array<{ pr: number; state: string | null; repo?: string }>;
  // --- section 3
  prodBranch?: {
    /** First concrete branch, or a pattern like `prod_blue_*`; null when unknown. */
    branch: string | null;
    isPattern?: boolean;
    unknown?: boolean;
  };
  /** Every prod branch the section names (the first is `prodBranch.branch`). */
  prodBranches?: string[];
  // --- sections 4-6
  deploy?: ServiceFact[];
  deployNone?: boolean;
  /** Sentences of section 4/5 that are statements, not service names (kept, never lost). */
  deployNotes?: string[];
  restart?: ServiceFact[];
  restartNone?: boolean;
  restartNotes?: string[];
  downtime?: Tri;
  bundleSdkBuild?: Tri;
  /** The text stays in the section (`section` is its number). */
  appRelease?: { applicable: boolean | null; refs: PrRef[]; section: number };
  // --- section 7
  database?: {
    /** The first sentence says there is no SQL / no database change. */
    noSql: boolean;
    /** Something else still has to be done (sequences, profile types, old-lock steps, owner to confirm). */
    hasAction: boolean;
    items: string[];
    sqlPaths: string[];
    section: number;
  };
  // --- section 8
  configs?: ConfigRow[];
  /** Section 8 says "none in this PR" (and/or points to a sibling). */
  configsNone?: boolean;
  configsSeeRefs?: PrRef[];
  // --- sections 9-14
  roles?: RoleCase[];
  backwardCompat?: { undo?: string; section: number };
  order?: {
    steps: OrderStep[];
    /** "text" when read from section 11, "json" when the JSON `order.steps` were used. */
    stepsSource: "text" | "json";
    /** The section-11 text was an explicit sequence (`a -> b` or numbered), not prose. */
    structured: boolean;
    /** Ordering constraints: step chain plus "after X / before Y / then Z" read from the text. */
    edges: OrderEdge[];
    /** The JSON `order.steps` as given (may be terser than the text). */
    jsonSteps?: string[];
    gates: string[];
    rollback?: string;
  };
  risks?: RiskItem[];
  testing?: { testCount?: number; noCi?: boolean; notRunByReviewer?: boolean; section: number };
  verification?: string[];
  // --- covers and the free-form ("dialect") record: label lines + numbered release rows
  /**
   * The PRs the record is about: `[its own repo#pr]` for a per-PR record, every PR listed for a
   * `union` record (`marker.scope`). Lets downstream treat both kinds uniformly.
   */
  covers?: Cover[];
  /** `STILL OPEN:` PRs of the ticket: named, never counted in `covers`. */
  stillOpen?: Cover[];
  /** PRs a later PR reverts ("do not deploy as features"): never in `covers`. */
  reverted?: Cover[];
  /** PRs merged into stack/feature branches only (base is not master/main/ckcoe): nothing is released. */
  stackOnly?: Cover[];
  /** HELD / PARTIAL / READY, as written on the STATUS line. */
  statusWord?: "HELD" | "PARTIAL" | "READY" | null;
  /** The text after that word ("in the DEMO movement (blocked) · PARTIAL"). */
  statusReason?: string;
  /** The "likely to be missed in testing" points, one per line. */
  likelyMissed?: Array<{ n: number; text: string }>;
  /** Test owner per area ("Reports - Chirag & Hemant"); `area` is null when one owner is named for everything. */
  testOwners?: Array<{ area: string | null; owner: string }>;
  /** ALL-CAPS label blocks (STATUS, WHAT, ORDER, OPEN, UNDO, VERIFY, LIKELY TO BE MISSED, ...). */
  labelled?: LabelledBlock[];
  /** The numbered release-page rows, in the order written. */
  releaseRows?: ReleaseRow[];
  /** Rows answered "Not Done": open items (`text` is the answer after the state words). */
  notDone?: Array<{ n: number; id: ReleaseRowId | null; label: string; text: string }>;
  /** Row 11 (configs to add in prod): the raw text and the identifiers (`loadout_number`) found in it. */
  configsText?: { state: RowState; text: string; keys: string[] };
  /** Row 23 (cherry-pick + re-test effort). */
  cherryPick?: { state: RowState; text: string };
}

// ---------------------------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------------------------

export type WarningCode =
  | "json_missing"
  | "json_malformed"
  | "json_disagrees"
  | "section_missing"
  | "section_duplicate"
  | "section_title_mismatch"
  | "header_mismatch"
  | "date_unparseable"
  | "extractor_failed"
  | "truncated"
  /** Info: the whole record was inside a code block and was read as ordinary text. */
  | "record_in_code_block"
  /** Info: "union of N merged PRs" does not match the number of PRs listed under MERGED PRs. */
  | "covers_count_mismatch";

export interface RecordWarning {
  code: WarningCode;
  message: string;
  /** Where: `section:8`, `json:configs[x].default`, `facts:order`, ... */
  path?: string;
  /** For aggregated warnings (`section_missing`): how many items it stands for. */
  count?: number;
}

export interface ParsedRecord {
  /** The Jira comment this was read from. `updated` drives "newest wins" for edited comments. */
  comment: { id: string; created: string | null; updated: string | null };
  marker: RecordMarker;
  /** READY | PARTIAL | BLOCKED; null when the status line is absent. */
  status: "READY" | "PARTIAL" | "BLOCKED" | null;
  /** e.g. "BLOCKED for release (4 open Should-fix, 0 Blocking)". */
  statusText: string | null;
  /** The numbers of "(N open Should-fix, M Blocking)"; null when absent. */
  counts: { blocking?: number; shouldFix?: number; nitpick?: number } | null;
  /** Text between the header lines and the first section (usually empty). */
  preamble: string;
  sections: RecordSection[];
  facts: RecordFacts;
  /** Every unknown of every section (flat, in section order). */
  unknowns: UnknownItem[];
  /**
   * The JSON block reduced to a whitelisted, depth/size-capped subset (marker, status, branches,
   * prodBranch, deploy, restart, order, configs, risks, app); null when absent or malformed.
   * Safe to JSON.stringify / structuredClone whatever the original looked like.
   */
  json: Record<string, unknown> | null;
  warnings: RecordWarning[];
  /** A safety limit cut the input; the record is still usable. */
  truncated: boolean;
  /**
   * Only for a free-form (dialect) record without numbered `**N Title:**` sections: its readable
   * text (blank runs collapsed, tabs as two spaces, <= 20 KB). Every string in `facts` and
   * `unknowns` of such a record is a contiguous piece of this text.
   */
  body?: string;
}

export interface RecordComment {
  id: string | number;
  /** ADF object, ADF as a JSON string, or markdown-ish text. */
  body: unknown;
  created?: string | null;
  updated?: string | null;
}

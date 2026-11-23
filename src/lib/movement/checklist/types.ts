/**
 * Types of the merged environment-movement checklist.
 *
 * The checklist is the UNION of the newest deployment record of every PR of every ticked Jira,
 * shaped as the 14 sections of the Confluence release page. It is pure data (JSON-safe, no
 * Dates, no undefined-vs-null tricks) so it can be hashed, diffed, gzipped into a snapshot and
 * rendered without the records it came from.
 */
import type { MovementEnvironment, MovementReadiness } from "../values";
import type { ParsedRecord } from "../record";

export type SectionId =
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

/** The 14 sections in the order of the Confluence "Production Release" page. */
export const SECTIONS: ReadonlyArray<{ id: SectionId; number: number; title: string }> = [
  { id: "header", number: 1, title: "Header and scope" },
  { id: "branches", number: 2, title: "Branches and owners" },
  { id: "prodBranch", number: 3, title: "Prod branch and cherry-pick" },
  { id: "deploy", number: 4, title: "Services to deploy" },
  { id: "restart", number: 5, title: "Services to restart or reload" },
  { id: "appRelease", number: 6, title: "App release" },
  { id: "database", number: 7, title: "Database" },
  { id: "configs", number: 8, title: "Configs to move" },
  { id: "roles", number: 9, title: "Roles and designations to test" },
  { id: "compat", number: 10, title: "Backward compatibility" },
  { id: "order", number: 11, title: "Deploy order, gates, rollback" },
  { id: "testing", number: 12, title: "Testing evidence" },
  { id: "risks", number: 13, title: "Risks and open items" },
  { id: "verify", number: 14, title: "Post-deploy verification" },
];

// --- bounds (OOM / DB-size rules of the plan) ---------------------------------------------------
export const MAX_ITEMS_PER_SECTION = 300;
export const MAX_TEXT_CHARS = 500;
export const MAX_RAW_CHARS = 2000;
/** Total raw free text kept in one checklist; past it every raw item is cut to RAW_OVER_BUDGET_CHARS. */
export const RAW_TEXT_BUDGET = 120_000;
export const RAW_OVER_BUDGET_CHARS = 300;
export const MAX_SOURCES_PER_ITEM = 24;
export const MAX_VARIANTS = 6;
export const MAX_VARIANT_SOURCES = 8;
export const MAX_CONFLICTS = 200;
export const MAX_WARNINGS = 100;
export const MAX_UNKNOWNS_PER_OWNER = 200;
/** Serialised size the checklist is condensed to stay under (60 Jiras x 4 PRs of worst-case content). */
export const MAX_CHECKLIST_BYTES = 400_000;

export type ItemSeverity = "info" | "warn" | "blocker";

export interface ItemSource {
  /** Jira key the record was read on. */
  jira: string;
  /** `repo#n` of the PR the record describes. */
  pr: string;
  /** Section number of the record the fact came from. */
  section?: number;
  /** A `union` record (`pr: "union"`): how many PRs it covers, and the first few as `repo#n` (for a tooltip). */
  n?: number;
  covers?: string[];
}

export type ConflictKind =
  | "prod_branch"
  | "config_default"
  | "config_env_value"
  | "downtime"
  | "deploy_branch"
  | "bundle_sdk"
  | "branch_mismatch"
  | "order_cycle"
  /** The same release-page row is answered differently by two records ("Done" vs "Not done"). */
  | "row_state";

export interface ConflictVariant {
  text: string;
  sources: ItemSource[];
}

export interface EnvInfo {
  /** The environment this movement targets. */
  target: MovementEnvironment;
  /** Value for the target environment; null when no record states one. */
  targetValue: string | null;
  /** Per environment; null = unknown (shown muted unless it is the target). */
  values: { demo: string | null; uat: string | null; prod: string | null };
}

export interface ConfigInfo {
  key: string;
  /** Other names the record gives the same setting ("(or property x)"). */
  aliases?: string[];
  store?: string;
  default?: string;
}

export interface ChecklistItem {
  /** Stable id across rebuilds: `section|key`. */
  id: string;
  /** Short hash of the item's content: changes whenever the item changes. */
  ih: string;
  /** Normalised dedupe key, unique within its section. */
  key: string;
  /** <= 500 chars, or <= 2000 chars when `raw`. */
  text: string;
  sources: ItemSource[];
  /** Sources beyond the cap (`MAX_SOURCES_PER_ITEM`). */
  moreSources?: number;
  severity?: ItemSeverity;
  /** The original word of a risk (Blocking / Should-fix / Nitpick). */
  label?: string;
  conflict?: { kind: ConflictKind; variants: ConflictVariant[] };
  /** The text is the record's own free text (cut), not a structured fact. */
  raw?: true;
  /** The target environment's value is unknown (configs) or a prod branch is unconfirmed. */
  needsAttention?: true;
  env?: EnvInfo;
  config?: ConfigInfo;
  /** Position in the merged deploy order (1-based); order steps only. */
  seq?: number;
  /** Jira the item is grouped under (gates and rollback steps). */
  group?: string;
  /** Jiras whose records name this step (deploy-order steps). */
  jiras?: string[];
  /** Identifiers found in a free-text answer (the config keys of release-page row 11), for the UI to show as chips. */
  chips?: string[];
  /** For the collapsed "N more" item. */
  count?: number;
  /**
   * Release-page rows merged over several Jiras: each answer once, with the Jiras that gave it and the instruction they wrote
   * (the Jiras that wrote the same words are one entry). `text` of the item holds the same content as one line for text exports.
   */
  answers?: Array<{ state: string; text: string; jiras: string[] }>;
}

export interface ChecklistSection {
  id: SectionId;
  number: number;
  title: string;
  items: ChecklistItem[];
}

export interface Conflict {
  /** Stable id: `section|itemKey|kind` (plus `|sub` when one item has several of a kind, e.g. per-env values). */
  id: string;
  sub?: string;
  kind: ConflictKind;
  section: SectionId;
  /** Key of the item that carries the conflict. */
  itemKey: string;
  title: string;
  severity: ItemSeverity;
  variants: ConflictVariant[];
}

export interface UnknownEntry {
  text: string;
  sources: ItemSource[];
  moreSources?: number;
}

export interface UnknownsGroup {
  /** Lower-case owner ("devops", "author", "mobile lead"); "" when the record names nobody. */
  owner: string;
  items: UnknownEntry[];
  /** Entries beyond the cap. */
  more?: number;
}

export interface ChecklistWarning {
  code: string;
  message: string;
  sources: ItemSource[];
  /** For the aggregated "+N more" entry. */
  count?: number;
}

export interface SignoffEntry {
  by: string;
  at: string;
}

export interface SignoffSummary {
  jira: string;
  dev: SignoffEntry | "missing";
  tester: SignoffEntry | "missing";
  /** Either is missing: highlighted by the UI, never blocking. */
  anyMissing: boolean;
}

export interface HeldJira {
  jira: string;
  summary?: string;
  readiness: MovementReadiness;
  override?: { reason: string; by: string };
}

export interface ScopeJira {
  jira: string;
  summary?: string;
  readiness: MovementReadiness;
  override?: { reason: string; by: string };
  prs: string[];
}

export type SeverityCounts = Record<ItemSeverity, number>;

export interface ChecklistStats {
  jiras: number;
  included: number;
  held: number;
  records: number;
  /** Review comments read (a union comment counts once however many PRs it covers); `prs` counts distinct PRs covered. */
  comments: number;
  prs: number;
  items: number;
  conflicts: number;
  unknowns: number;
  needsAttention: number;
  /** Items (no severity counts as info) and conflicts by severity. */
  bySeverity: { items: SeverityCounts; conflicts: SeverityCounts };
}

export interface Checklist {
  version: 1;
  /** sha256 of the content (`hashChecklist`). */
  hash: string;
  /** One line: "7 PRs, 2 conflicts, 15 need attention, 23 unknowns". */
  summary: string;
  environment: MovementEnvironment;
  scope: { jiras: ScopeJira[]; branches: Array<{ repo: string; branch: string }> };
  sections: ChecklistSection[];
  unknownsByOwner: UnknownsGroup[];
  conflicts: Conflict[];
  warnings: ChecklistWarning[];
  signoffs: SignoffSummary[];
  held: HeldJira[];
  stats: ChecklistStats;
}

// --- input ---------------------------------------------------------------------------------------

export interface ChecklistJiraInput {
  key: string;
  summary?: string;
  /** Ticked by the user (records-valid Jiras are ticked by default). Unticked ones are only listed in `held`. */
  included: boolean;
  readiness: MovementReadiness;
  override?: { reason: string; by: string };
  signoffs?: { dev?: SignoffEntry; tester?: SignoffEntry };
  /** Newest record per PR, already chosen (`pickNewestPerPr`). */
  records: ParsedRecord[];
}

export interface ChecklistInput {
  environment: MovementEnvironment;
  jiras: ChecklistJiraInput[];
  /** The user's branch picks per repo. */
  branches: Array<{ repo: string; branch: string }>;
}

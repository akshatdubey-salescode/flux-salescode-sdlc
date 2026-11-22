/**
 * The checklist of ONE Jira (GET items/<issueId>/checklist: the same 14 sections, built from that Jira's review comment only) shaped for
 * reading: a header strip, the 23 rows of the release page as a table, the PRs, services, configs, database / app / compat, testing, the
 * order with rollback, and the open questions. Pure: it only sorts the checklist's items by their key (`row:`, `cover:`, `svc:`, `cfg:`,
 * `step:` ...). Anything it does not recognise lands in `other`, so no line of the checklist is ever dropped.
 */
import type { ReleaseRowId } from "@/lib/movement/record/types";
import type { Checklist, ChecklistItem, JiraServices } from "./api-types";
import type { EnvInfo, ItemSeverity } from "@/lib/movement/checklist/types";
import { NOT_REPO } from "@/lib/movement/record/util";
import { buildJiraCards, cardsText } from "./jira-cards";

// ---------------------------------------------------------------------------------------------
// the release page rows
// ---------------------------------------------------------------------------------------------

/** The 23 rows of the Confluence release page in the page's order (row number = position + 1; the server's own order). */
export const RELEASE_ROW_ORDER: readonly ReleaseRowId[] = [
  "meeting",
  "services_deploy",
  "app_release",
  "code_reviewed",
  "previous_data",
  "new_app_old_data",
  "db_queries",
  "db_index",
  "bundle_reviewed",
  "bundle_sdk",
  "configs_prod",
  "services_restart",
  "ui_reviewed",
  "ui_indexdb",
  "performance",
  "automation_run",
  "automation_updated",
  "features_old_data",
  "beta_compat",
  "designations",
  "old_app_version",
  "scenarios",
  "cherry_pick",
];

export type RowStateKind = "done" | "notdone" | "na" | "yes" | "no" | "unknown" | "other";

export interface RowEntry {
  id: string;
  /** 1..23 on the release page; rows the page does not know (`n7:label`) keep their own number. */
  n: number;
  label: string;
  state: RowStateKind;
  /** What follows the state word ("param X is set in prod"). */
  details: string;
  needsAttention: boolean;
  chips: string[];
}

const STATE_WORDS: Array<[RegExp, RowStateKind]> = [
  [/^Not required\b/i, "na"],
  [/^Not done\b/i, "notdone"],
  [/^Done\b/i, "done"],
  [/^Yes\b/i, "yes"],
  [/^No\b/i, "no"],
  [/^Unknown\b/i, "unknown"],
];

/** `row:<id>` item -> its row: "<label>: <State> <details>"; a free-text answer keeps state "other". */
export function parseRowItem(item: Pick<ChecklistItem, "key" | "text" | "needsAttention" | "chips">): RowEntry | null {
  if (!item.key.startsWith("row:")) return null;
  const id = item.key.slice(4);
  const at = item.text.indexOf(": ");
  const label = at > 0 ? item.text.slice(0, at) : item.text;
  const rest = at > 0 ? item.text.slice(at + 2).trim() : "";
  let state: RowStateKind = "other";
  let details = rest;
  for (const [re, s] of STATE_WORDS) {
    const m = re.exec(rest);
    if (m) {
      state = s;
      details = rest.slice(m[0].length).trim();
      break;
    }
  }
  const idx = (RELEASE_ROW_ORDER as readonly string[]).indexOf(id);
  const own = /^n(\d+):/.exec(id);
  const n = idx >= 0 ? idx + 1 : own ? Number(own[1]) : 99;
  return { id, n, label, state, details, needsAttention: !!item.needsAttention, chips: item.chips ?? [] };
}

// ---------------------------------------------------------------------------------------------
// PRs
// ---------------------------------------------------------------------------------------------

export interface PrRow {
  /** `repo#n` */
  pr: string;
  branch: string | null;
  commit: string | null;
  note: string | null;
  state: string | null;
  noApproval: boolean;
}

/** `cover:` item text: "repo#9 branch sha note [state]" (branch, sha, note and state are each optional). */
export function parseCoverItem(item: Pick<ChecklistItem, "key" | "text">): PrRow | null {
  if (!item.key.startsWith("cover:")) return null;
  // a PR row needs a real `repo#number`: "before#1147" / "inside#1147" (words of a sentence under the MERGED PRs list, parsed as PRs by an older reader) are not PRs
  const ref = /^([^\s#]+)#(\d+)/.exec(item.text);
  if (ref && NOT_REPO.has(ref[1].toLowerCase())) return null;
  let text = item.text;
  const noApproval = / - no formal approval$/i.test(text);
  if (noApproval) text = text.replace(/ - no formal approval$/i, "");
  const state = /\[([a-z]+)\]$/i.exec(text);
  if (state) text = text.slice(0, state.index).trimEnd();
  const tokens = text.split(/\s+/).filter(Boolean);
  const pr = tokens.shift() ?? item.key.slice(6);
  const shaAt = tokens.findIndex((t, i) => i >= 0 && /^[0-9a-f]{7,40}$/i.test(t));
  let branch: string | null = null;
  let commit: string | null = null;
  let note: string | null = null;
  if (shaAt >= 0) {
    branch = tokens.slice(0, shaAt).join(" ") || null;
    commit = tokens[shaAt];
    note = tokens.slice(shaAt + 1).join(" ") || null;
  } else {
    branch = tokens[0] ?? null;
    note = tokens.slice(1).join(" ") || null;
  }
  return { pr, branch, commit, note, state: state ? state[1] : null, noApproval };
}

export interface NotReleased {
  kind: "open" | "reverted" | "stack";
  /** "Still open (not released): repo#1 note; repo#2" */
  text: string;
  prs: string[];
}

// ---------------------------------------------------------------------------------------------
// the view
// ---------------------------------------------------------------------------------------------

export interface ConfigRow {
  key: string;
  aliases: string[];
  store: string | null;
  default: string | null;
  env: EnvInfo | null;
  needsAttention: boolean;
}

export interface KvRow {
  group: "Database" | "App release" | "Backward compatibility";
  label: string;
  value: string;
  severity?: ItemSeverity;
  /** The checklist item's key (`db:...`, `sql:...`, `app:none`, `compat...`): lets the cards tell a repeat of a release-page row from a new fact. */
  key?: string;
}

export interface JiraChecklistView {
  header: { statusWord: string | null; statusText: string | null; severity: ItemSeverity | null; what: string | null; label: string | null; needsAttention: boolean };
  rows: RowEntry[];
  notRequired: string[];
  prs: PrRow[];
  approvals: string[];
  notReleased: NotReleased[];
  services: { deploy: string[]; restart: string[]; none: { deploy: boolean; restart: boolean }; downtime: string[]; sdk: string[]; notes: string[] };
  configs: { rows: ConfigRow[]; chips: string[]; none: string | null };
  kv: KvRow[];
  testing: { missed: string[]; owners: Array<{ text: string; warn: boolean }>; roles: string[]; other: string[] };
  order: { steps: Array<{ seq: number; label: string; severity?: ItemSeverity }>; gates: string[]; rollback: string[]; undo: string[]; verify: string[] };
  open: { groups: Array<{ owner: string; items: string[] }>; risks: Array<{ text: string; label?: string; severity?: ItemSeverity; /** an "Open: ..." line of the comment (still to do), not a risk the reviewer rated */ open?: boolean }> };
  /** The Jira's services as the server computed them from its records (the same helpers as the movement roll-up). Absent: derived from the item texts. */
  serviceList?: JiraServices;
  /** Items no block above claims: shown as a plain list, so nothing is hidden. */
  other: Array<{ section: string; text: string; severity?: ItemSeverity }>;
}

const after = (text: string, prefix: string): string => (text.startsWith(prefix) ? text.slice(prefix.length) : text);
const STATUS_WORD = /\b(HELD|PARTIAL|BLOCKED|READY)\b/i;

/** Sort the items of a one-Jira checklist into the blocks of the Jira view. */
export function buildJiraChecklistView(cl: Pick<Checklist, "sections" | "unknownsByOwner">, services?: JiraServices | null): JiraChecklistView {
  const v: JiraChecklistView = {
    header: { statusWord: null, statusText: null, severity: null, what: null, label: null, needsAttention: false },
    rows: [],
    notRequired: [],
    prs: [],
    approvals: [],
    notReleased: [],
    services: { deploy: [], restart: [], none: { deploy: false, restart: false }, downtime: [], sdk: [], notes: [] },
    configs: { rows: [], chips: [], none: null },
    kv: [],
    testing: { missed: [], owners: [], roles: [], other: [] },
    order: { steps: [], gates: [], rollback: [], undo: [], verify: [] },
    open: { groups: [], risks: [] },
    other: [],
    ...(services ? { serviceList: services } : {}),
  };
  const noApproval = new Set<string>();
  for (const s of cl.sections) for (const it of s.items) if (it.key.startsWith("noapproval:")) noApproval.add(it.key.slice(11));

  for (const s of cl.sections) {
    for (const it of s.items) {
      const k = it.key;
      const text = it.text;
      const sev = it.severity;
      const claimed = ((): boolean => {
        if (k.startsWith("row:")) {
          const r = parseRowItem(it);
          if (r) v.rows.push(r);
          return true;
        }
        if (k.startsWith("notreq:")) {
          v.notRequired.push(...after(text, "Not required: ").split(/,\s*/).filter(Boolean));
          return true;
        }
        switch (s.id) {
          case "header":
            if (k.startsWith("rec:union:") || (k.startsWith("rec:") && !v.header.what)) {
              const at = text.indexOf(": ");
              v.header.label = at > 0 ? text.slice(0, at) : null;
              v.header.what = at > 0 ? text.slice(at + 2) : text;
              return true;
            }
            if (k.startsWith("status:")) {
              v.header.statusText = after(text, "Review status: ");
              v.header.statusWord = STATUS_WORD.exec(text)?.[1].toUpperCase() ?? null;
              v.header.severity = sev ?? null;
              if (it.needsAttention) v.header.needsAttention = true;
              return true;
            }
            return k === "scope" || k.startsWith("override:"); // a one-Jira scope line adds nothing here
          case "branches": {
            if (k.startsWith("cover:")) {
              const p = parseCoverItem(it);
              if (p) v.prs.push({ ...p, noApproval: p.noApproval || noApproval.has(p.pr) });
              return true;
            }
            if (k.startsWith("noapproval:")) return true;
            if (k.startsWith("merged:")) {
              v.approvals.push(after(text, "Merged PRs: "));
              return true;
            }
            const kinds: Array<[string, NotReleased["kind"]]> = [["stillopen:", "open"], ["reverted:", "reverted"], ["stackonly:", "stack"]];
            for (const [prefix, kind] of kinds) {
              if (k.startsWith(prefix)) {
                v.notReleased.push({ kind, text, prs: k.slice(prefix.length).split(",").filter(Boolean) });
                return true;
              }
            }
            return false;
          }
          case "deploy":
            if (k.startsWith("svc:")) v.services.deploy.push(text);
            else if (k === "sdk") v.services.sdk.push(after(text, "Bundle SDK build: "));
            else if (k === "deploy:none") v.services.none.deploy = true;
            else if (k.startsWith("deploynote:")) v.services.notes.push(text);
            else return false;
            return true;
          case "restart":
            if (k.startsWith("restart:none")) v.services.none.restart = true;
            else if (k.startsWith("restart:")) v.services.restart.push(text);
            else if (k.startsWith("downtime:")) v.services.downtime.push(text);
            else if (k.startsWith("restartnote:")) v.services.notes.push(text);
            else return false;
            return true;
          case "appRelease":
            v.kv.push({ group: "App release", label: k.startsWith("app:") ? "App release" : "Note", value: text, severity: sev, key: k });
            return true;
          case "database":
            v.kv.push({ group: "Database", label: k.startsWith("sql:") ? "SQL to run" : k === "db:nosql" ? "SQL" : "Database", value: k.startsWith("sql:") ? after(text, "SQL to run: ") : text, severity: sev, key: k });
            return true;
          case "compat":
            if (k.startsWith("undo:")) v.order.undo.push(after(text, "Undo: "));
            else v.kv.push({ group: "Backward compatibility", label: "Compatibility", value: text, severity: sev, key: k });
            return true;
          case "configs":
            if (k.startsWith("cfg:") && it.config) {
              v.configs.rows.push({ key: it.config.key, aliases: it.config.aliases ?? [], store: it.config.store ?? null, default: it.config.default ?? null, env: it.env ?? null, needsAttention: !!it.needsAttention });
              return true;
            }
            if (k.startsWith("cfgnone:")) {
              v.configs.none = text;
              return true;
            }
            return false;
          case "roles":
            v.testing.roles.push(text);
            return true;
          case "testing":
            if (k.startsWith("missed:")) v.testing.missed.push(after(text, "Likely to be missed: "));
            else if (k.startsWith("owner:")) v.testing.owners.push({ text: after(text, "Test owners: "), warn: sev === "warn" });
            else v.testing.other.push(text);
            return true;
          case "order":
            if (k.startsWith("step:")) v.order.steps.push({ seq: it.seq ?? v.order.steps.length + 1, label: text, severity: sev });
            else if (k.startsWith("gate:")) v.order.gates.push(after(text, "Gate: "));
            else if (k.startsWith("rollback:")) v.order.rollback.push(after(text, "Rollback: "));
            else return false;
            return true;
          case "risks":
            if (k.startsWith("open:")) v.open.risks.push({ text: after(text, "Open: "), label: it.label, open: true });
            else v.open.risks.push({ text, label: it.label, severity: sev });
            return true;
          case "verify":
            v.order.verify.push(text);
            return true;
          default:
            return false;
        }
      })();
      if (!claimed) v.other.push({ section: s.title, text, severity: sev });
    }
  }
  v.rows.sort((a, b) => a.n - b.n);
  v.order.steps.sort((a, b) => a.seq - b.seq);
  // the config keys named by release-page row 11 are shown as chips next to the configs table
  v.configs.chips = [...new Set(v.rows.filter((r) => r.id === "configs_prod").flatMap((r) => r.chips))];
  v.open.groups = cl.unknownsByOwner.map((g) => ({ owner: g.owner, items: g.items.map((i) => i.text) }));
  return v;
}

/** Rows to show as the page's table, and the ones collapsed into the single muted "Not required" line. */
export function splitRows(rows: readonly RowEntry[], notRequiredLabels: readonly string[]): { shown: RowEntry[]; notRequired: string[] } {
  const shown = rows.filter((r) => r.state !== "na");
  return { shown, notRequired: [...rows.filter((r) => r.state === "na").map((r) => r.label), ...notRequiredLabels].filter((l, i, a) => a.indexOf(l) === i) };
}

/** Counts of the answered rows, for the strip above the table ("5 done, 2 not done, 1 unknown, 9 not required"). */
export function rowCounts(rows: readonly RowEntry[], notRequiredLabels: readonly string[]): string {
  const c = (s: RowStateKind) => rows.filter((r) => r.state === s).length;
  const parts: string[] = [];
  if (c("done")) parts.push(`${c("done")} done`);
  if (c("notdone")) parts.push(`${c("notdone")} not done`);
  if (c("unknown")) parts.push(`${c("unknown")} unknown`);
  if (c("yes") + c("no")) parts.push(`${c("yes")} yes, ${c("no")} no`);
  const na = splitRows(rows, notRequiredLabels).notRequired.length;
  if (na) parts.push(`${na} not required`);
  return parts.join(", ") || "no rows";
}

/** The whole Jira checklist as plain text for the clipboard (no markup): the same cards as on the screen, each headed with the Jira key. */
export function jiraChecklistText(key: string, environment: string, v: JiraChecklistView): string {
  return cardsText(key, environment, buildJiraCards(v));
}

/**
 * The services of ONE Jira (and the shared tidying of a service name and its note), from the parsed records' facts.deploy / facts.restart.
 *
 * Used by the movement roll-up (rollup.ts) and by the per-Jira checklist endpoint, so the board and the Jira card name the same services:
 * one entry per canonical service (Flutter app (SFA) for "App" / "Flutter app", Channelkart Bundle for "Bundle" ...), what is done to it
 * (deploy, restart) with a tidy note, what is not a service ("Then the salesrep syncs") as "also" lines, and what is left out
 * ("No bundle, no Slake") as one "not needed" list. Pure.
 */
import type { RecordFacts } from "../record";
import { canonicalService, isKnownService, tidy } from "./normalize";

/**
 * A stored service name that an older reader left untidy: "A · B" is two services, "KPI Dashboard UI: static deploy" is a service and what is done to it,
 * "no Slake" is not a service. New reads already give clean names; this keeps records stored before that clean too.
 */
export function serviceParts(s: { name: string; note?: string }): Array<{ name: string; note?: string }> {
  const out: Array<{ name: string; note?: string }> = [];
  const pieces = s.name.split(/\s+\u00b7\s+/);
  pieces.forEach((piece, i) => {
    const m = /^([^:()]{2,50}):\s*(\S.*)$/.exec(piece.trim());
    const name = (m ? m[1] : piece).trim().replace(/\s+only$/i, "");
    if (!name || /^(?:no|nothing|none|not|without)\b/i.test(name)) return;
    // "Users log out and in", "The app is an app-store release": a clause, not a service
    if (/^(?:users?|the app|app is|salesreps?|they|it)\b/i.test(name) || /\blog (?:in|out)\b|\bto pick up\b/i.test(name)) return;
    // "bundle reload" is the Channelkart Bundle being reloaded; "schedule / config / cache reload or clear" is something done to another service
    if (/^bundle\s+(?:reload|jar)$/i.test(name)) {
      out.push({ name: "Channelkart Bundle", note: [name.toLowerCase().includes("reload") ? "reload" : "", m?.[2], i === pieces.length - 1 ? s.note : undefined].filter(Boolean).join("; ") });
      return;
    }
    if (/^(?:schedules?|configs?|cache|report query cache|transformer registry)\b.*\b(?:reload|clear|refresh|restart)$/i.test(name) || /^cache clear\b/i.test(name)) return;
    // not a service name: a sentence ("cache clear. No Channel Kart restart"), an alternative ("UI or app"), a lower-case phrase ("in to pick up the setting")
    if (name.includes(". ") || /\sor\s/i.test(name) || (/^[a-z]/.test(name) && !/[-_.]/.test(name) && name.split(/\s+/).length >= 3)) return;
    const note = [m?.[2], i === pieces.length - 1 ? s.note : undefined].filter(Boolean).join("; ");
    out.push({ name, ...(note ? { note } : {}) });
  });
  return out;
}


const NEGATION_RE = /^(?:no|nothing|none|not|without)\b\s*(?:for\s+|to\s+|a\s+|any\s+)?/i;

/** "No bundle, no Slake" / "Nothing for Channel Kart, bundle, UI or app" -> ["bundle", "Slake"] / ["Channel Kart", "bundle", "UI", "app"]. */
export function negatedItems(clause: string): string[] {
  return clause
    .replace(NEGATION_RE, "")
    .split(/\s*(?:,|;|\bor\b|\band\b)\s*/i)
    .map((x) => x.replace(NEGATION_RE, "").replace(/[.\s]+$/, "").trim())
    // "(static UI deploy)" and the bare word "restart" say nothing about what is left out
    .filter((x) => x && !x.startsWith("(") && !/^(?:a\s+)?restart(?:s| needed)?$/i.test(x));
}

/** "bundle", "Slake", "jar", "Flutter": what a note may say is not needed. "backend change", "new network call" describe the deploy and stay in its note. */
const isLeftOutItem = (x: string): boolean => isKnownService(x) || /^(?:jars?|app|ui)$/i.test(x) || /^(?:slake|flutter|bundle|stock|app)\b/i.test(x);

/** Split a note at ";" and "," (outside brackets) to find the clauses that say what is NOT done. */
function noteClauses(note: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of note) {
    if (c === "(") depth++;
    else if (c === ")" && depth > 0) depth--;
    if (depth === 0 && (c === ";" || c === ",")) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

export interface SplitNote {
  /** The note without "extra line", "this PR" and the clauses that say what is left out. */
  note: string;
  /** What the note says is not needed ("no jar; no Slake" -> ["jar", "Slake"]). "no restart" is NOT here: it is `noRestart`. */
  negations: string[];
  /** The note says this service is not restarted ("static deploy, no restart", "no separate restart"). */
  noRestart: boolean;
}

export function splitNote(raw: string | undefined): SplitNote {
  const t = raw ? tidy(raw, 1000) : "";
  if (!t || /^(?:this pr|#\d+|extra line)$/i.test(t)) return { note: "", negations: [], noRestart: false };
  const kept: string[] = [];
  const negations: string[] = [];
  let noRestart = false;
  for (const c of noteClauses(t)) {
    if (/^extra line$/i.test(c)) continue;
    if (NEGATION_RE.test(c) && /\brestart\b/i.test(c)) {
      noRestart = true;
      continue;
    }
    const items = NEGATION_RE.test(c) && c.length < 60 ? negatedItems(c) : [];
    if (items.length && items.every(isLeftOutItem)) negations.push(...items);
    else kept.push(c);
  }
  // nothing was dropped: the note is returned exactly as written (commas stay commas)
  const dropped = kept.length < noteClauses(t).length;
  return { note: dropped ? kept.join("; ") : t, negations, noRestart };
}

/** True when a restart note says the service is not restarted. */
export const isNoRestart = (note: string | undefined): boolean => splitNote(note).noRestart;

export interface JiraService {
  /** Canonical name ("Flutter app (SFA)", "Channelkart Bundle", "KPI Dashboard - UI", ...). */
  name: string;
  deploy: boolean;
  restart: boolean;
  deployNote?: string;
  restartNote?: string;
}

export interface JiraServices {
  services: JiraService[];
  /** Lines of rows 2 / 12 that are not services ("Then the salesrep syncs", "Transformer registry and report query cache: refresh or restart"). */
  also: string[];
  /** What the answers leave out ("bundle", "Slake"): shown as one muted line. */
  notNeeded: string[];
}

type ServiceFacts = Pick<RecordFacts, "deploy" | "restart" | "deployNotes" | "restartNotes">;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The services of one Jira from all its records' facts. */
export function jiraServices(records: ReadonlyArray<{ facts: ServiceFacts }>): JiraServices {
  const byKey = new Map<string, JiraService & { rank: number }>();
  const also: string[] = [];
  const negated = new Map<string, string>();
  const get = (raw: string): JiraService & { rank: number } => {
    const c = canonicalService(raw);
    let e = byKey.get(c.key);
    if (!e) byKey.set(c.key, (e = { name: c.name, deploy: false, restart: false, rank: c.rank }));
    return e;
  };
  const addAlso = (t: string): void => {
    const x = tidy(t, 600);
    if (x && !also.some((a) => norm(a) === norm(x))) also.push(x);
  };
  const addNegated = (items: string[]): void => {
    for (const i of items) if (!negated.has(norm(i))) negated.set(norm(i), i);
  };
  const noteOf = (existing: string | undefined, add: string): string | undefined => {
    if (!add) return existing;
    if (!existing) return add;
    return norm(existing).includes(norm(add)) ? existing : `${existing}; ${add}`;
  };

  for (const { facts } of records) {
    for (const part of (facts.deploy ?? []).flatMap(serviceParts)) {
      const sn = splitNote(part.note);
      addNegated(sn.negations);
      const e = get(part.name);
      e.deploy = true;
      e.deployNote = noteOf(e.deployNote, sn.note);
    }
    for (const part of (facts.restart ?? []).flatMap(serviceParts)) {
      const sn = splitNote(part.note);
      addNegated(sn.negations);
      if (sn.noRestart) {
        // "Bundle: no separate restart": it is not restarted; it only appears when something else deploys it
        const c = canonicalService(part.name);
        const e = byKey.get(c.key);
        if (e && sn.note) e.deployNote = noteOf(e.deployNote, sn.note);
        continue;
      }
      const e = get(part.name);
      e.restart = true;
      e.restartNote = noteOf(e.restartNote, sn.note);
    }
    for (const n of [...(facts.deployNotes ?? []), ...(facts.restartNotes ?? [])]) {
      const t = tidy(n, 600);
      if (!t) continue;
      if (/^(?:none|nothing)\b/i.test(t) && /^(?:none|nothing)\s*(?:\(|$)/i.test(t)) continue; // "none (static UI deploy)": the answer "no restart", already said by the table
      if (NEGATION_RE.test(t)) addNegated(negatedItems(t));
      else addAlso(t);
    }
  }

  const services = [...byKey.values()]
    .map((e) => {
      const s: JiraService = { name: e.name, deploy: e.deploy, restart: e.restart, ...(e.deployNote ? { deployNote: e.deployNote } : {}), ...(e.restartNote ? { restartNote: e.restartNote } : {}) };
      // each fact once: a restart note that only repeats the deploy note is dropped
      if (s.restartNote && s.deployNote && norm(s.deployNote).includes(norm(s.restartNote))) delete s.restartNote;
      if (!s.deployNote) delete s.deployNote;
      if (!s.restartNote) delete s.restartNote;
      return s;
    })
    .sort((a, b) => (byKey.get(canonicalService(a.name).key)?.rank ?? 1000) - (byKey.get(canonicalService(b.name).key)?.rank ?? 1000) || (a.name < b.name ? -1 : 1));
  // what the answers leave out never names a service that this Jira does list
  const listed = new Set(services.map((s) => norm(s.name)));
  const notNeeded = [...negated.values()].filter((i) => {
    const c = canonicalService(i);
    return !listed.has(norm(c.name)) && !listed.has(norm(i));
  });
  return { services, also, notNeeded };
}

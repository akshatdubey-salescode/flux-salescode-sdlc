/** Test helpers: the 7 real parsed records as two Jiras of one movement. */
import { parseDeploymentRecord, type ParsedRecord } from "../record";
import { loadFixture, RECORD_FIXTURES, UNION_FIXTURE } from "../record/testkit";
import type { ChecklistJiraInput } from "./types";

export function realRecords(): Record<string, ParsedRecord> {
  const out: Record<string, ParsedRecord> = {};
  for (const n of RECORD_FIXTURES) {
    const r = parseDeploymentRecord(loadFixture(n));
    if (!r) throw new Error(`fixture ${n} did not parse`);
    out[n] = r;
  }
  return out;
}

/** CAV-7346 (3 PRs) and CAV-7304 (4 PRs), both ticked. */
export function realJiras(): ChecklistJiraInput[] {
  const r = realRecords();
  return [
    { key: "CAV-7346", summary: "Partner banner", included: true, readiness: "ready", records: [r["CAV-7346-81399"], r["CAV-7346-81400"], r["CAV-7346-81421"]] },
    {
      key: "CAV-7304",
      summary: "Account lock",
      included: true,
      readiness: "ready",
      signoffs: { dev: { by: "dev@example.com", at: "2026-11-18T10:00:00Z" } },
      records: [r["CAV-7304-81422"], r["CAV-7304-81423"], r["CAV-7304-81424"], r["CAV-7304-81425"]],
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// synthetic records
// ---------------------------------------------------------------------------------------------

type Facts = ParsedRecord["facts"];

export interface SynthOpts {
  repo?: string;
  pr?: number;
  key?: string;
  id?: number;
  status?: ParsedRecord["status"];
  facts?: Facts;
  unknowns?: ParsedRecord["unknowns"];
  sections?: ParsedRecord["sections"];
  json?: ParsedRecord["json"];
}

/** A hand-made record (the model is dynamic: every fact is optional). */
export function synth(o: SynthOpts = {}): ParsedRecord {
  const repo = o.repo ?? "channelkart";
  const pr = o.pr ?? 1;
  return {
    comment: { id: String(o.id ?? 1000 + pr), created: "2026-11-19T10:00:00.000+0000", updated: "2026-11-19T10:00:00.000+0000" },
    marker: { version: 1, key: o.key ?? "CAV-1", repo, pr, at: "2026-11-19T10:00:00.000Z", atRaw: "2026-11-19 10:00", agent: "test", supersedes: null },
    status: o.status ?? "READY",
    statusText: null,
    counts: null,
    preamble: "",
    sections: o.sections ?? [],
    facts: o.facts ?? {},
    unknowns: o.unknowns ?? [],
    json: o.json ?? null,
    warnings: [],
    truncated: false,
  };
}

export function jira(key: string, records: ParsedRecord[], extra: Partial<ChecklistJiraInput> = {}): ChecklistJiraInput {
  return { key, included: true, readiness: "ready", records, ...extra };
}

/**
 * A structurally real record with fresh content: a deep copy of `base` where the texts that
 * dedupe on (config keys, risks, roles, db items, verify, gates, unknowns, section texts, steps,
 * PR numbers) are made unique with `n`. Worst case for size: nothing collapses.
 */
export function uniqueClone(base: ParsedRecord, n: number, key: string): ParsedRecord {
  const r: ParsedRecord = JSON.parse(JSON.stringify(base));
  const prMap = new Map<number, number>();
  const u = (s: string) => `${s} [u${n}]`;
  const mapPr = (x: number) => {
    let v = prMap.get(x);
    if (v === undefined) {
      v = 100000 + n * 10 + prMap.size;
      prMap.set(x, v);
    }
    return v;
  };
  r.comment.id = String(1000000 + n);
  r.marker.key = key;
  if (r.marker.pr !== null) r.marker.pr = mapPr(r.marker.pr);
  const f = r.facts;
  f.configs?.forEach((c) => (c.key = u(c.key)));
  f.risks?.forEach((x) => (x.text = u(x.text)));
  f.roles?.forEach((x) => (x.what = u(x.what)));
  f.verification = f.verification?.map(u);
  if (f.database) f.database.items = f.database.items.map(u);
  if (f.order) {
    f.order.gates = f.order.gates.map(u);
    const re = (s: string) => s.replace(/#(\d+)/g, (_m, d) => `#${mapPr(Number(d))}`);
    f.order.steps.forEach((s) => {
      s.text = u(re(s.text));
      s.refs.forEach((x) => (x.pr = mapPr(x.pr)));
    });
    f.order.edges.forEach((e) => {
      e.before = re(e.before);
      e.after = re(e.after);
    });
    if (f.order.rollback) f.order.rollback = u(f.order.rollback);
  }
  f.siblings?.forEach((x) => (x.pr = mapPr(x.pr)));
  r.unknowns.forEach((x) => (x.text = u(x.text)));
  r.sections.forEach((s) => {
    s.text = u(s.text);
    s.unknowns = [];
    s.tables = [];
  });
  return r;
}

/** The real free-form union record of CAV-7280 (81643), as one Jira of a movement. */
export function unionRecord(): ParsedRecord {
  const r = parseDeploymentRecord(loadFixture(UNION_FIXTURE));
  if (!r) throw new Error("union fixture did not parse");
  return r;
}

export function unionJira(extra: Partial<ChecklistJiraInput> = {}): ChecklistJiraInput {
  return { key: "CAV-7280", summary: "Loadout filter", included: true, readiness: "ready", records: [unionRecord()], ...extra };
}
